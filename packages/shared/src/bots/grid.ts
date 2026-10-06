// The bots' navigation grid: the map's floor cut into BOT_TUNING.cell
// squares, a cell blocked when a player standing on its centre would touch a
// box or an outer wall (every box inflated by PLAYER_RADIUS plus a small
// margin, so paths keep the body clear of corners instead of rubbing on
// them). Built once per map (`navGrid`, cached by map id) and shared by
// every bot on it. A* (path.ts) and the flow field (flow.ts) run on it; the
// scratch arrays they need live here, so a search allocates nothing.

import type { Arena } from "../arena.ts";
import { PLAYER_RADIUS } from "../constants.ts";
import { circleOverlapsBox, segmentHitsBox, type Vec2 } from "../physics.ts";
import { BOT_TUNING } from "./tuning.ts";

/** A binary min-heap of cell indices by a float key, on typed arrays (grows as needed). Duplicates are allowed: stale entries are skipped by the caller. */
export class CellHeap {
  nodes: Int32Array;
  keys: Float64Array;
  size = 0;
  constructor(capacity: number) {
    this.nodes = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }
  clear() {
    this.size = 0;
  }
  push(node: number, key: number) {
    if (this.size === this.nodes.length) {
      const n = new Int32Array(this.nodes.length * 2);
      n.set(this.nodes);
      const k = new Float64Array(this.keys.length * 2);
      k.set(this.keys);
      this.nodes = n;
      this.keys = k;
    }
    let i = this.size++;
    const { nodes, keys } = this;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      nodes[i] = nodes[p];
      keys[i] = keys[p];
      i = p;
    }
    nodes[i] = node;
    keys[i] = key;
  }
  /** The key of the top entry (call only when size > 0). */
  topKey(): number {
    return this.keys[0];
  }
  /** Removes and returns the top cell (call only when size > 0). */
  pop(): number {
    const { nodes, keys } = this;
    const top = nodes[0];
    const n = --this.size;
    if (n === 0) return top;
    const node = nodes[n];
    const key = keys[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && keys[r] < keys[l] ? r : l;
      if (keys[c] >= key) break;
      nodes[i] = nodes[c];
      keys[i] = keys[c];
      i = c;
    }
    nodes[i] = node;
    keys[i] = key;
    return top;
  }
}

export interface NavGrid {
  /** The map's id (the cache key). */
  id: string;
  arena: Arena;
  /** Cell side, metres. */
  cell: number;
  cols: number;
  rows: number;
  /** World position of the grid's -x/-z corner. */
  ox: number;
  oz: number;
  /** 1: blocked (a body on that centre would touch cover or a wall). Index = row * cols + col. */
  blocked: Uint8Array;
  /** A* scratch: cost so far, parent cell, and the search a cell was last touched by. */
  g: Float64Array;
  parent: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  search: number;
  heap: CellHeap;
  /** Flow fields by zone key (flow.ts), shared by every bot on the map. */
  flows: Map<string, Float64Array>;
}

/** The 8 neighbours: column step, row step, cost (in cells). */
export const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Builds the grid of a map (uncached: use `navGrid`). */
export function buildNavGrid(id: string, arena: Arena, cell: number = BOT_TUNING.cell): NavGrid {
  const cols = Math.max(1, Math.round((2 * arena.halfX) / cell));
  const rows = Math.max(1, Math.round((2 * arena.halfZ) / cell));
  const ox = -arena.halfX;
  const oz = -arena.halfZ;
  const n = cols * rows;
  const blocked = new Uint8Array(n);
  const r = PLAYER_RADIUS + BOT_TUNING.gridMargin;
  const limX = arena.halfX - r;
  const limZ = arena.halfZ - r;
  // The outer walls.
  for (let j = 0; j < rows; j++) {
    const z = oz + (j + 0.5) * cell;
    for (let i = 0; i < cols; i++) {
      const x = ox + (i + 0.5) * cell;
      if (x < -limX || x > limX || z < -limZ || z > limZ) blocked[j * cols + i] = 1;
    }
  }
  // Each box, over the cells of its inflated footprint only.
  for (const b of arena.obstacles) {
    const i0 = Math.max(0, Math.floor((b.x - b.w / 2 - r - ox) / cell));
    const i1 = Math.min(cols - 1, Math.floor((b.x + b.w / 2 + r - ox) / cell));
    const j0 = Math.max(0, Math.floor((b.z - b.d / 2 - r - oz) / cell));
    const j1 = Math.min(rows - 1, Math.floor((b.z + b.d / 2 + r - oz) / cell));
    for (let j = j0; j <= j1; j++) {
      const z = oz + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        if (circleOverlapsBox(ox + (i + 0.5) * cell, z, r, b)) blocked[j * cols + i] = 1;
      }
    }
  }
  return {
    id,
    arena,
    cell,
    cols,
    rows,
    ox,
    oz,
    blocked,
    g: new Float64Array(n),
    parent: new Int32Array(n),
    seen: new Uint32Array(n),
    closed: new Uint32Array(n),
    search: 0,
    heap: new CellHeap(1024),
    flows: new Map(),
  };
}

const grids = new Map<string, NavGrid>();

/** The grid of a map, built on first use and cached by map id (maps are fixed data). */
export function navGrid(map: Arena & { id: string }): NavGrid {
  let g = grids.get(map.id);
  if (!g || g.arena !== map) {
    g = buildNavGrid(map.id, map);
    grids.set(map.id, g);
  }
  return g;
}

/** The cell under a world point (clamped onto the grid). */
export function cellAt(grid: NavGrid, x: number, z: number): number {
  const i = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.ox) / grid.cell)));
  const j = Math.min(grid.rows - 1, Math.max(0, Math.floor((z - grid.oz) / grid.cell)));
  return j * grid.cols + i;
}

/** A cell's centre. */
export function cellCentre(grid: NavGrid, c: number): Vec2 {
  const i = c % grid.cols;
  const j = (c - i) / grid.cols;
  return { x: grid.ox + (i + 0.5) * grid.cell, z: grid.oz + (j + 0.5) * grid.cell };
}

export function cellFree(grid: NavGrid, c: number): boolean {
  return c >= 0 && c < grid.blocked.length && grid.blocked[c] === 0;
}

/**
 * The free cell nearest to `c` (itself when free), searched in growing
 * square rings up to `radius` cells; -1 when there is none. Ties go to the
 * nearest centre, then the first met.
 */
export function nearestFree(grid: NavGrid, c: number, radius: number = BOT_TUNING.snapRadiusCells): number {
  if (cellFree(grid, c)) return c;
  const ci = c % grid.cols;
  const cj = (c - ci) / grid.cols;
  for (let k = 1; k <= radius; k++) {
    let best = -1;
    let bestD = Infinity;
    for (let dj = -k; dj <= k; dj++) {
      for (let di = -k; di <= k; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== k) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) continue;
        const n = j * grid.cols + i;
        if (grid.blocked[n]) continue;
        const d = di * di + dj * dj;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * Whether a body walking straight from `a` to `b` keeps PLAYER_RADIUS (plus
 * BOT_TUNING.smoothMargin) from every box. Boxes are inflated as rectangles,
 * which covers more than the round inflation the grid uses: a segment that
 * passes this never cuts an inflated corner.
 */
export function segmentClear(grid: NavGrid, a: Vec2, b: Vec2): boolean {
  const r = PLAYER_RADIUS + BOT_TUNING.smoothMargin;
  const minX = Math.min(a.x, b.x) - r;
  const maxX = Math.max(a.x, b.x) + r;
  const minZ = Math.min(a.z, b.z) - r;
  const maxZ = Math.max(a.z, b.z) + r;
  for (const o of grid.arena.obstacles) {
    // A cheap bounding box test first: most boxes are nowhere near.
    if (o.x + o.w / 2 < minX || o.x - o.w / 2 > maxX || o.z + o.d / 2 < minZ || o.z - o.d / 2 > maxZ) continue;
    if (segmentHitsBox(a, b, o, r)) return false;
  }
  const limX = grid.arena.halfX - PLAYER_RADIUS;
  const limZ = grid.arena.halfZ - PLAYER_RADIUS;
  return Math.abs(a.x) <= limX && Math.abs(b.x) <= limX && Math.abs(a.z) <= limZ && Math.abs(b.z) <= limZ;
}

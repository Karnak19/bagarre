// The flow field toward the zone: one Dijkstra from the zone's target circle
// over the navigation grid gives every free cell its walking distance to it,
// and a bot escaping the zone steps to its lowest neighbour. One field per
// zone target, cached on the grid (`flowField`) and shared by every bot on the
// map: a new zone (a new match, or a zone that moves its target) gets a new key and a
// new field.

import type { Vec2 } from "../physics.ts";
import type { ZoneView } from "../protocol.ts";
import { NEIGHBOURS, cellAt, cellCentre, nearestFree, type NavGrid } from "./grid.ts";

/** The circle a flow field leads into. */
export interface FlowTarget {
  x: number;
  z: number;
  r: number;
}

/** Fields kept per grid at most (the oldest goes first). */
const MAX_FLOWS = 8;
/** The goal region is at least this wide, so a zone that closes to a point still has one. */
const MIN_GOAL_RADIUS = 2;

/**
 * Where the zone ends up: its final circle (it moves in a straight line
 * toward it, so heading there is always heading in). Null with no zone.
 */
export function zoneFlowTarget(zone: ZoneView): FlowTarget | null {
  if (zone.end <= 0) return null;
  return { x: zone.x1, z: zone.z1, r: zone.r1 };
}

/** The cache key of a target (to a centimetre). */
export function flowKey(t: FlowTarget): string {
  return `${Math.round(t.x * 100)}:${Math.round(t.z * 100)}:${Math.round(t.r * 100)}`;
}

/**
 * Walking distance (metres) from every cell to the target circle, Infinity
 * for blocked cells and cells cut off from it. Built with Dijkstra on first
 * use for that target, then cached on the grid.
 */
export function flowField(grid: NavGrid, target: FlowTarget): Float64Array {
  const key = flowKey(target);
  const hit = grid.flows.get(key);
  if (hit) return hit;
  const field = buildFlowField(grid, target);
  if (grid.flows.size >= MAX_FLOWS) {
    const oldest = grid.flows.keys().next().value;
    if (oldest !== undefined) grid.flows.delete(oldest);
  }
  grid.flows.set(key, field);
  return field;
}

/** Dijkstra from the target circle (uncached: use `flowField`). */
export function buildFlowField(grid: NavGrid, target: FlowTarget): Float64Array {
  const { cols, rows, blocked, cell } = grid;
  const n = cols * rows;
  const dist = new Float64Array(n).fill(Infinity);
  const heap = grid.heap;
  heap.clear();
  const r = Math.max(MIN_GOAL_RADIUS, target.r);
  const r2 = r * r;
  for (let j = 0; j < rows; j++) {
    const dz = grid.oz + (j + 0.5) * cell - target.z;
    for (let i = 0; i < cols; i++) {
      const c = j * cols + i;
      const dx = grid.ox + (i + 0.5) * cell - target.x;
      if (blocked[c] === 0 && dx * dx + dz * dz <= r2) {
        dist[c] = 0;
        heap.push(c, 0);
      }
    }
  }
  if (heap.size === 0) {
    // The target circle is all cover: start from the free cell nearest its centre.
    const c = nearestFree(grid, cellAt(grid, target.x, target.z), Math.max(cols, rows));
    if (c < 0) return dist;
    dist[c] = 0;
    heap.push(c, 0);
  }
  const diag = Math.SQRT2 * cell;
  while (heap.size > 0) {
    const d = heap.topKey();
    const c = heap.pop();
    if (d > dist[c]) continue;
    const ci = c % cols;
    const cj = (c - ci) / cols;
    const w = ci > 0;
    const e = ci < cols - 1;
    const no = cj > 0;
    const so = cj < rows - 1;
    // The four sides, then the diagonals (no corner cutting: both sides free).
    const fw = w && blocked[c - 1] === 0;
    const fe = e && blocked[c + 1] === 0;
    const fn = no && blocked[c - cols] === 0;
    const fs = so && blocked[c + cols] === 0;
    if (fw) relax(c - 1, d + cell);
    if (fe) relax(c + 1, d + cell);
    if (fn) relax(c - cols, d + cell);
    if (fs) relax(c + cols, d + cell);
    if (fw && fn) relax(c - cols - 1, d + diag);
    if (fe && fn) relax(c - cols + 1, d + diag);
    if (fw && fs) relax(c + cols - 1, d + diag);
    if (fe && fs) relax(c + cols + 1, d + diag);
  }
  return dist;

  function relax(m: number, nd: number) {
    if (blocked[m] === 0 && nd < dist[m]) {
      dist[m] = nd;
      heap.push(m, nd);
    }
  }
}

/** The field's walking distance from a point (its nearest free cell), Infinity when cut off. */
export function flowDistance(grid: NavGrid, field: Float64Array, p: Vec2): number {
  const c = nearestFree(grid, cellAt(grid, p.x, p.z));
  return c < 0 ? Infinity : field[c];
}

/**
 * Which way to walk from `from` to follow the field: a unit vector toward the
 * lowest neighbouring cell (no corner cutting), or toward the nearest free
 * cell when `from` stands on a blocked one. Null inside the target or when
 * cut off from it.
 */
export function flowDirection(grid: NavGrid, field: Float64Array, from: Vec2): Vec2 | null {
  const own = cellAt(grid, from.x, from.z);
  const c = nearestFree(grid, own);
  if (c < 0) return null;
  const toward = (t: Vec2): Vec2 | null => {
    const dx = t.x - from.x;
    const dz = t.z - from.z;
    const len = Math.hypot(dx, dz);
    return len > 1e-6 ? { x: dx / len, z: dz / len } : null;
  };
  if (c !== own) return toward(cellCentre(grid, c));
  if (field[c] === 0 || field[c] === Infinity) return null;
  const { cols, rows, blocked } = grid;
  const ci = c % cols;
  const cj = (c - ci) / cols;
  let best = -1;
  let bestD = field[c];
  for (const [di, dj] of NEIGHBOURS) {
    const i = ci + di;
    const j = cj + dj;
    if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
    const m = j * cols + i;
    if (blocked[m]) continue;
    if (di !== 0 && dj !== 0 && (blocked[cj * cols + i] || blocked[j * cols + ci])) continue;
    if (field[m] < bestD) {
      bestD = field[m];
      best = m;
    }
  }
  return best < 0 ? null : toward(cellCentre(grid, best));
}

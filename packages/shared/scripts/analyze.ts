// Geometry and analysis shared by validate.ts and preview.ts. Mirrors the
// rules of src/physics.ts: players are circles of PLAYER_RADIUS,
// bullets circles of BULLET_RADIUS, and every obstacle box blocks both.

import { BULLET_RADIUS, PLAYER_RADIUS, PLAYER_SPEED } from "../src/constants.ts";
import { bodiesSee, clearShot, segHitsBox } from "../src/sight.ts";
import { FLAT_DECOR, type MapDef, type Obstacle, type Spawn } from "../src/maps/types.ts";

export const R = PLAYER_RADIUS;
/** Narrowest gap allowed between two boxes (or a box and a wall), unless closed (0). */
export const MIN_GAP = 1.6;
/** Thinnest box allowed (bullets are checked every 0.25 m). */
export const MIN_THICKNESS = 0.5;
/** Time-to-contact window, seconds (both players walk toward each other). */
export const CONTACT_MIN = 2.5;
export const CONTACT_MAX = 6.5;
/** Soft target inside that window; outside it is a warning. */
export const CONTACT_TARGET: [number, number] = [3, 6];
/** Warn when a spawn can be shot from more than this share of the floor. */
export const MAX_SPAWN_EXPOSURE = 0.3;
/** Chest height used for the camera occlusion metric. */
export const CHEST = 1.0;

const EPS = 1e-6;

export interface Pt {
  x: number;
  z: number;
}

// --- Line of sight (shared with the server's respawn rule) --------------------

export { bodiesSee, clearShot, segHitsBox };

export function circleHitsBox(x: number, z: number, r: number, b: Obstacle): boolean {
  const cx = Math.max(b.x - b.w / 2, Math.min(b.x + b.w / 2, x));
  const cz = Math.max(b.z - b.d / 2, Math.min(b.z + b.d / 2, z));
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}

/** Where a player's centre may stand. */
export function standable(m: MapDef, x: number, z: number): boolean {
  if (Math.abs(x) > m.halfX - R + EPS || Math.abs(z) > m.halfZ - R + EPS) return false;
  for (const o of m.obstacles) if (circleHitsBox(x, z, R, o)) return false;
  return true;
}

// --- Walk grid and flood fill -------------------------------------------------

export interface Grid {
  cell: number;
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  walk: Uint8Array;
}

export function walkGrid(m: MapDef, cell = 0.1): Grid {
  const nx = Math.round((2 * m.halfX) / cell);
  const nz = Math.round((2 * m.halfZ) / cell);
  const x0 = -m.halfX + cell / 2;
  const z0 = -m.halfZ + cell / 2;
  const walk = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) walk[j * nx + i] = standable(m, x0 + i * cell, z0 + j * cell) ? 1 : 0;
  return { cell, nx, nz, x0, z0, walk };
}

export function cellOf(g: Grid, p: Pt): number {
  const i = Math.max(0, Math.min(g.nx - 1, Math.round((p.x - g.x0) / g.cell)));
  const j = Math.max(0, Math.min(g.nz - 1, Math.round((p.z - g.z0) / g.cell)));
  return j * g.nx + i;
}

/** 4-connected flood fill from `start`; returns the reached mask. */
export function flood(g: Grid, start: number): Uint8Array {
  const seen = new Uint8Array(g.walk.length);
  if (!g.walk[start]) return seen;
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const i = c % g.nx;
    const j = (c - i) / g.nx;
    const nb = [i > 0 ? c - 1 : -1, i < g.nx - 1 ? c + 1 : -1, j > 0 ? c - g.nx : -1, j < g.nz - 1 ? c + g.nx : -1];
    for (const n of nb) {
      if (n >= 0 && g.walk[n] && !seen[n]) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return seen;
}

// --- Shortest path (visibility graph over player-inflated boxes) --------------

function walkSegClear(m: MapDef, a: Pt, b: Pt): boolean {
  for (const o of m.obstacles) if (segHitsBox(a, b, o, R)) return false;
  return true;
}

export function shortestPath(m: MapDef, a: Pt, b: Pt): { length: number; points: Pt[] } | null {
  const k = R + 0.02;
  const nodes: Pt[] = [a, b];
  for (const o of m.obstacles) {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const p = { x: o.x + sx * (o.w / 2 + k), z: o.z + sz * (o.d / 2 + k) };
        if (standable(m, p.x, p.z)) nodes.push(p);
      }
  }
  const n = nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    if (u === 1) break;
    done[u] = 1;
    for (let v = 0; v < n; v++) {
      if (done[v]) continue;
      const d = Math.hypot(nodes[v].x - nodes[u].x, nodes[v].z - nodes[u].z);
      if (dist[u] + d >= dist[v]) continue;
      if (!walkSegClear(m, nodes[u], nodes[v])) continue;
      dist[v] = dist[u] + d;
      prev[v] = u;
    }
  }
  if (dist[1] === Infinity) return null;
  const pts: Pt[] = [];
  for (let c = 1; c >= 0; c = prev[c]) pts.unshift(nodes[c]);
  return { length: dist[1], points: pts };
}

/** Point at distance `s` along a polyline. */
export function along(pts: Pt[], s: number): Pt {
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (s <= L) {
      const t = L > 0 ? s / L : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t };
    }
    s -= L;
  }
  return pts[pts.length - 1];
}

/**
 * Both players leave their spawns at the same time and walk the shortest path
 * toward each other. Returns when they would meet, and when they first get a
 * clear shot at each other.
 */
export function contact(m: MapDef, a: Spawn, b: Spawn) {
  const path = shortestPath(m, a, b);
  if (!path) return null;
  const meet = path.length / (2 * PLAYER_SPEED);
  let sight = meet;
  let sightDist = 0;
  for (let t = 0; t <= meet; t += 1 / 30) {
    const s = t * PLAYER_SPEED;
    const pa = along(path.points, s);
    const pb = along(path.points, path.length - s);
    if (bodiesSee(m, pa, pb)) {
      sight = t;
      sightDist = Math.hypot(pa.x - pb.x, pa.z - pb.z);
      break;
    }
  }
  return { path, meet, sight, sightDist };
}

// --- Sightlines ---------------------------------------------------------------

export interface Sightlines {
  /** Sample points (standable, on a `step` grid). */
  pts: Pt[];
  /** How many other samples each sample can see. */
  exposure: Int32Array;
  longest: { a: Pt; b: Pt; len: number }[];
  /** Share of sample pairs farther than 18 m apart that have a clear shot. */
  longShare: number;
  /** Share of all sample pairs with a clear shot. */
  openness: number;
}

export function sightlines(m: MapDef, step = 1): Sightlines {
  const pts: Pt[] = [];
  for (let z = -m.halfZ + step / 2; z < m.halfZ; z += step)
    for (let x = -m.halfX + step / 2; x < m.halfX; x += step) if (standable(m, x, z)) pts.push({ x, z });
  const exposure = new Int32Array(pts.length);
  const lines: { a: Pt; b: Pt; len: number }[] = [];
  let far = 0;
  let farSeen = 0;
  let seen = 0;
  let pairs = 0;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const len = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
      const ok = clearShot(m, pts[i], pts[j]);
      pairs++;
      if (len > 18) far++;
      if (!ok) continue;
      seen++;
      exposure[i]++;
      exposure[j]++;
      if (len > 18) farSeen++;
      if (len > 14) lines.push({ a: pts[i], b: pts[j], len });
    }
  lines.sort((p, q) => q.len - p.len);
  // Keep a few distinct ones (endpoints not all near an already kept line).
  const longest: typeof lines = [];
  const near = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.z - q.z) < 5;
  for (const l of lines) {
    if (longest.some((k) => (near(k.a, l.a) && near(k.b, l.b)) || (near(k.a, l.b) && near(k.b, l.a)))) continue;
    longest.push(l);
    if (longest.length >= 6) break;
  }
  return { pts, exposure, longest, longShare: far ? farSeen / far : 0, openness: pairs ? seen / pairs : 0 };
}

// --- Camera occlusion ---------------------------------------------------------

/**
 * Is a point at height `y` above (x, z) hidden from the iso camera? The camera
 * looks down (-1, -1, -1), so the ray back to it is (x + t, y + t, z + t).
 * Only boxes taller than `minH` count.
 */
export function hiddenFromCamera(m: MapDef, x: number, z: number, y = CHEST, minH = 0): boolean {
  for (const o of m.obstacles) {
    if (o.h <= y || o.h <= minH) continue;
    const lo = Math.max(0, o.x - o.w / 2 - x, o.z - o.d / 2 - z);
    const hi = Math.min(o.h - y, o.x + o.w / 2 - x, o.z + o.d / 2 - z);
    if (hi > lo) return true;
  }
  return false;
}

/** Tall cover for the camera metrics: a box taller than this hides at least a player's waist right behind it. */
export const TALL = 1.2;
/** Waist height, for the `tallShadow` metrics: floor where a tall box hides a player's waist from the camera. */
export const WAIST = 0.5;

export interface CamFlags {
  /** Per cell of the grid: the chest (CHEST) is hidden from the camera. */
  chest: Uint8Array;
  /** Per cell: a tall box (> TALL) hides the waist (WAIST) from the camera. */
  tall: Uint8Array;
}

export function cameraFlags(m: MapDef, g: Grid): CamFlags {
  const chest = new Uint8Array(g.walk.length);
  const tall = new Uint8Array(g.walk.length);
  for (let c = 0; c < g.walk.length; c++) {
    if (!g.walk[c]) continue;
    const p = cellPt(g, c);
    chest[c] = hiddenFromCamera(m, p.x, p.z, CHEST) ? 1 : 0;
    tall[c] = hiddenFromCamera(m, p.x, p.z, WAIST, TALL) ? 1 : 0;
  }
  return { chest, tall };
}

// --- Cover ----------------------------------------------------------------------

/** A player hugging cover has its centre at most this far from the box surface (0.5 m radius + a step). */
export const COVER_HUG = 1.0;

/** Distance from a point to the nearest box surface (outer walls don't count: nobody shoots from beyond them). */
export function nearestCover(m: MapDef, p: Pt): number {
  let best = Infinity;
  for (const o of m.obstacles) {
    const dx = Math.max(0, Math.abs(p.x - o.x) - o.w / 2);
    const dz = Math.max(0, Math.abs(p.z - o.z) - o.d / 2);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/**
 * Is `p` a cover spot against `threat`: hugging a box (within COVER_HUG of
 * its surface) that blocks the shot from `threat`?
 */
export function coverFacing(m: MapDef, p: Pt, threat: Pt): boolean {
  for (const o of m.obstacles) {
    const dx = Math.max(0, Math.abs(p.x - o.x) - o.w / 2);
    const dz = Math.max(0, Math.abs(p.z - o.z) - o.d / 2);
    if (dx * dx + dz * dz > COVER_HUG * COVER_HUG) continue;
    if (segHitsBox(p, threat, o, BULLET_RADIUS)) return true;
  }
  return false;
}

// --- Walking distance field -------------------------------------------------------

export function cellPt(g: Grid, c: number): Pt {
  return { x: g.x0 + (c % g.nx) * g.cell, z: g.z0 + Math.floor(c / g.nx) * g.cell };
}

/** The closest standable point to `p` (itself if standable), searched in rings up to 10 m. */
export function nearestStandable(m: MapDef, p: Pt): Pt {
  if (standable(m, p.x, p.z)) return p;
  for (let r = 0.25; r < 10; r += 0.25)
    for (let a = 0; a < 16; a++) {
      const q = { x: p.x + r * Math.cos((a * Math.PI) / 8), z: p.z + r * Math.sin((a * Math.PI) / 8) };
      if (standable(m, q.x, q.z)) return q;
    }
  return p;
}

/**
 * Walking distance (metres) from the nearest of `sources` to every walkable
 * cell of `g`: Dijkstra, 8-connected, a diagonal step only when both
 * orthogonal cells are walkable. Infinity where unreachable or farther than
 * `max`. Overestimates straight-line walks by up to 8 %, the same for every
 * source, so it is fine for comparing two sides.
 */
export function walkField(g: Grid, sources: readonly Pt[], max = Infinity): Float64Array {
  const dist = new Float64Array(g.walk.length).fill(Infinity);
  // Binary heap of cells keyed by dist (lazy deletion).
  let heapC = new Int32Array(1024);
  let heapD = new Float64Array(1024);
  let n = 0;
  const push = (c: number, d: number) => {
    if (n === heapC.length) {
      const c2 = new Int32Array(n * 2);
      c2.set(heapC);
      heapC = c2;
      const d2 = new Float64Array(n * 2);
      d2.set(heapD);
      heapD = d2;
    }
    let i = n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapD[p] <= d) break;
      heapC[i] = heapC[p];
      heapD[i] = heapD[p];
      i = p;
    }
    heapC[i] = c;
    heapD[i] = d;
  };
  const pop = () => {
    const c = heapC[0];
    const lc = heapC[--n];
    const ld = heapD[n];
    let i = 0;
    for (;;) {
      let k = 2 * i + 1;
      if (k >= n) break;
      if (k + 1 < n && heapD[k + 1] < heapD[k]) k++;
      if (heapD[k] >= ld) break;
      heapC[i] = heapC[k];
      heapD[i] = heapD[k];
      i = k;
    }
    heapC[i] = lc;
    heapD[i] = ld;
    return c;
  };
  // Seed the walkable cells around each source at their straight-line
  // distance (not just the nearest cell: rounding would favour one side).
  for (const s of sources) {
    const c = cellOf(g, s);
    const ci = c % g.nx;
    const cj = (c - ci) / g.nx;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
        const v = j * g.nx + i;
        const d = Math.hypot(g.x0 + i * g.cell - s.x, g.z0 + j * g.cell - s.z);
        if (g.walk[v] && d < dist[v]) {
          dist[v] = d;
          push(v, d);
        }
      }
  }
  const h = g.cell;
  const dg = g.cell * Math.SQRT2;
  while (n > 0) {
    const d0 = heapD[0];
    const c = pop();
    if (d0 > dist[c]) continue;
    const i = c % g.nx;
    const j = (c - i) / g.nx;
    const l = i > 0 && g.walk[c - 1];
    const r = i < g.nx - 1 && g.walk[c + 1];
    const u = j > 0 && g.walk[c - g.nx];
    const dn = j < g.nz - 1 && g.walk[c + g.nx];
    const relax = (v: number, w: number) => {
      const nd = d0 + w;
      if (nd < dist[v] && nd <= max) {
        dist[v] = nd;
        push(v, nd);
      }
    };
    if (l) relax(c - 1, h);
    if (r) relax(c + 1, h);
    if (u) relax(c - g.nx, h);
    if (dn) relax(c + g.nx, h);
    if (l && u && g.walk[c - g.nx - 1]) relax(c - g.nx - 1, dg);
    if (r && u && g.walk[c - g.nx + 1]) relax(c - g.nx + 1, dg);
    if (l && dn && g.walk[c + g.nx - 1]) relax(c + g.nx - 1, dg);
    if (r && dn && g.walk[c + g.nx + 1]) relax(c + g.nx + 1, dg);
  }
  return dist;
}

/**
 * The walkable cells closest to `p`, plus a 1 m margin: where "walk to p"
 * ends when `p` itself is inside a box (a single nearest point would pick one
 * side's corner of that box).
 */
export function regionAround(g: Grid, p: Pt): Pt[] {
  let r0 = Infinity;
  for (let c = 0; c < g.walk.length; c++) if (g.walk[c]) r0 = Math.min(r0, Math.hypot(cellPt(g, c).x - p.x, cellPt(g, c).z - p.z));
  const out: Pt[] = [];
  for (let c = 0; c < g.walk.length; c++) {
    if (!g.walk[c]) continue;
    const q = cellPt(g, c);
    if (Math.hypot(q.x - p.x, q.z - p.z) <= r0 + 1) out.push(q);
  }
  return out;
}

/** Length of a polyline. */
export function polyLength(pts: readonly Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return L;
}

// --- Gaps ---------------------------------------------------------------------

/** Clear distance between two boxes (0 if touching or overlapping). */
export function boxGap(a: Obstacle, b: Obstacle): number {
  const gx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
  const gz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
  return Math.hypot(gx, gz);
}

function insideAny(bs: readonly Obstacle[], x: number, z: number): boolean {
  for (const b of bs) if (Math.abs(x - b.x) <= b.w / 2 + 1e-9 && Math.abs(z - b.z) <= b.d / 2 + 1e-9) return true;
  return false;
}

// --- Mirror detection -----------------------------------------------------------

/** A map "reads as mirrored" when more than this share of its box footprint has a twin under one mirror. */
export const MAX_MIRROR_SHARE = 0.45;
const MIRRORS: readonly [string, (x: number, z: number) => [number, number]][] = [
  ["point (x,z)->(-x,-z)", (x, z) => [-x, -z]],
  ["mirror across x = 0", (x, z) => [-x, z]],
  ["mirror across z = 0", (x, z) => [x, -z]],
  ["mirror across x = z", (x, z) => [z, x]],
  ["mirror across x = -z", (x, z) => [-z, -x]],
];

/**
 * For each mirror of the arena, the share of the floor under boxes (0.5 m
 * samples, height ignored) whose mirror image is also under a box. A
 * hand-made asymmetric map sits around 10-30 %; a mirrored one near 100 %.
 * Only the square-arena mirrors apply to x = z / x = -z.
 */
export function mirrorShares(m: MapDef): { name: string; share: number }[] {
  const step = 0.5;
  const pts: [number, number][] = [];
  for (let z = -m.halfZ + step / 2; z < m.halfZ; z += step)
    for (let x = -m.halfX + step / 2; x < m.halfX; x += step) if (insideAny(m.obstacles, x, z)) pts.push([x, z]);
  const square = m.halfX === m.halfZ;
  return MIRRORS.filter((_, i) => i < 3 || square).map(([name, f]) => {
    let twin = 0;
    for (const [x, z] of pts) {
      const [mx, mz] = f(x, z);
      if (insideAny(m.obstacles, mx, mz)) twin++;
    }
    return { name, share: pts.length ? twin / pts.length : 0 };
  });
}

/** The most mirrored reading of the map, and an error when it reads as mirrored. */
export function mirrorCheck(m: MapDef): { worst: { name: string; share: number }; error: string | null } {
  const worst = mirrorShares(m).reduce((a, b) => (b.share > a.share ? b : a));
  const error =
    worst.share > MAX_MIRROR_SHARE
      ? `reads as mirrored: ${(worst.share * 100).toFixed(0)} % of the box footprint has a twin under ${worst.name} (max ${MAX_MIRROR_SHARE * 100} %)`
      : null;
  return { worst, error };
}

/**
 * Is the free space between two boxes actually filled by other boxes (e.g. a
 * wall run split in three pieces by the ASCII merge)? Samples the gap region.
 */
export function gapFilled(m: MapDef, a: Obstacle, b: Obstacle): boolean {
  const others = m.obstacles.filter((o) => o !== a && o !== b);
  const lo = (o: Obstacle, ax: "x" | "z") => (ax === "x" ? o.x - o.w / 2 : o.z - o.d / 2);
  const hi = (o: Obstacle, ax: "x" | "z") => (ax === "x" ? o.x + o.w / 2 : o.z + o.d / 2);
  const range = (ax: "x" | "z"): [number, number] => {
    const l = Math.max(lo(a, ax), lo(b, ax));
    const h = Math.min(hi(a, ax), hi(b, ax));
    // Overlapping projection: the shared interval. Separated: the gap between.
    return l <= h ? [l, h] : [h, l];
  };
  const [x0, x1] = range("x");
  const [z0, z1] = range("z");
  const n = 12;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = z0 + ((z1 - z0) * j) / n;
      if (insideAny([a, b], x, z)) continue;
      if (!insideAny(others, x, z)) return false;
    }
  return true;
}

// --- Fairness (duel) --------------------------------------------------------------
//
// Maps are not mirrored, so each spawn pair (2k, 2k + 1) is measured side by
// side instead. Every metric is computed for both sides and the gap between
// them must stay within a tolerance: max(abs, rel x the larger value). The
// absolute floor keeps tiny values honest (0.2 % vs 0.4 % is no gap). The
// start pair (0/1) gets these tolerances; later pairs are respawn spots,
// picked by `respawnPoint` away from the opponent, so they rarely face each
// other from a standing start: RESPAWN_SLACK widens their tolerances.

export type FairKey =
  | "exposure"
  | "longExposure"
  | "nearestCover"
  | "coverNear"
  | "toCentre"
  | "retreat"
  | "territory"
  | "camHidden"
  | "camCover"
  | "tallShadow";

export interface Tolerance {
  /** Allowed gap, in the metric's unit (fractions for %). */
  abs: number;
  /** Or this share of the larger of the two values, whichever is bigger. */
  rel: number;
}

export interface FairDef {
  label: string;
  unit: "%" | "m" | "m2";
  tol: Tolerance;
  /** One line for the legend. */
  what: string;
}

/** Walk radius around a spawn for `coverNear`, metres (about 1.3 s). */
export const COVER_NEAR_WALK = 8;
/** Long sightline, metres (rifle range). */
export const LONG_LOS = 18;
/** Later pairs (respawn spots): tolerances times this. */
export const RESPAWN_SLACK = 1.5;
/** Grid for the territory and camera metrics, metres. Cell centres at .125/.375/... never sit exactly on a box edge + player radius. */
export const FAIR_CELL = 0.25;

export const FAIR: Record<FairKey, FairDef> = {
  // +-3 pp, or 15 % of the larger: 20 % vs 23 % passes, 20 % vs 24 % fails.
  exposure: { label: "spawn exposure", unit: "%", tol: { abs: 0.03, rel: 0.15 }, what: "share of the floor with a clear shot at the spawn" },
  longExposure: {
    label: "long-LOS exposure",
    unit: "%",
    tol: { abs: 0.03, rel: 0.2 },
    what: `of the floor more than ${LONG_LOS} m away, the share with a clear shot at the spawn (sniper lanes)`,
  },
  nearestCover: { label: "nearest cover", unit: "m", tol: { abs: 1, rel: 0 }, what: "spawn to the nearest box surface" },
  coverNear: {
    label: "cover spots near spawn",
    unit: "m2",
    tol: { abs: 2, rel: 0.25 },
    what: `floor within ${COVER_NEAR_WALK} m walk of the spawn hugging a box (<= ${COVER_HUG} m) that blocks the shot from the enemy spawn`,
  },
  toCentre: { label: "walk to centre", unit: "m", tol: { abs: 1.5, rel: 0.05 }, what: "walk from the spawn to the centre (floor within 1 m of the standable point closest to (0, 0))" },
  retreat: {
    label: "retreat at first sight",
    unit: "m",
    tol: { abs: 1, rel: 0 },
    what: "both walk the shortest path toward each other; at first sight, how far each is from a spot the other can't see",
  },
  territory: {
    label: "territory",
    unit: "%",
    tol: { abs: 0.06, rel: 0 },
    what: "share of the floor closer (walking) to this spawn than to the other",
  },
  camHidden: {
    label: "cam-hidden territory",
    unit: "%",
    tol: { abs: 0.015, rel: 0 },
    what: `share of the side's territory where a chest (${CHEST} m) is hidden from the camera`,
  },
  camCover: {
    label: "cam-hidden cover spots",
    unit: "%",
    tol: { abs: 0.08, rel: 0 },
    what: "of the cover spots in the territory (hugging a box that blocks the enemy spawn), the share where the chest is hidden from the camera",
  },
  tallShadow: {
    label: "tall-box camera shadow",
    unit: "%",
    tol: { abs: 0.02, rel: 0 },
    what: `share of the territory where a box taller than ${TALL} m hides the waist (${WAIST} m) from the camera`,
  },
};

export const FAIR_KEYS = Object.keys(FAIR) as FairKey[];

export interface FairMetric {
  key: FairKey;
  a: number;
  b: number;
  gap: number;
  /** Allowed gap for this pair. */
  tol: number;
  /** gap / tol: over 1 fails. */
  score: number;
}

export interface PairFairness {
  /** Pair index k: spawns 2k and 2k + 1. */
  k: number;
  metrics: FairMetric[];
  worst: FairMetric;
}

export function allowedGap(t: Tolerance, a: number, b: number, slack = 1): number {
  return slack * Math.max(t.abs, t.rel * Math.max(Math.abs(a), Math.abs(b)));
}

export function fairMetric(key: FairKey, def: FairDef, a: number, b: number, slack = 1): FairMetric {
  const gap = Math.abs(a - b);
  const tol = allowedGap(def.tol, a, b, slack);
  return { key, a, b, gap, tol, score: tol > 0 ? gap / tol : gap > 0 ? Infinity : 0 };
}

/** Formats a metric value in its unit. */
export function fairValue(unit: FairDef["unit"], v: number): string {
  if (!Number.isFinite(v)) return "inf";
  return unit === "%" ? `${(v * 100).toFixed(1)}%` : unit === "m" ? `${v.toFixed(1)} m` : `${v.toFixed(1)} m²`;
}

/** Distance from `p` to the nearest sample of `cands` that `other` can't see (bodiesSee), within 12 m. */
function retreatDist(m: MapDef, cands: readonly Pt[], p: Pt, other: Pt): number {
  if (!bodiesSee(m, p, other)) return 0;
  let best = Infinity;
  for (const q of cands) {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d >= best || d > 12) continue;
    if (!bodiesSee(m, q, other)) best = d;
  }
  return best;
}

/**
 * Side-by-side metrics for every spawn pair. `exposure` is the per-spawn
 * share of `sl.pts` with a clear shot (from `check`), `contacts[k]` the walk
 * of pair k (null when there is no path).
 */
export function fairness(m: MapDef, sl: Sightlines, exposure: readonly number[], contacts: readonly (ReturnType<typeof contact> | null)[]): PairFairness[] {
  const g = walkGrid(m, FAIR_CELL);
  const cam = cameraFlags(m, g);
  const cellArea = g.cell * g.cell;
  const centre = regionAround(g, { x: 0, z: 0 });
  const retreatCands: Pt[] = [];
  for (let z = -m.halfZ + 0.25; z < m.halfZ; z += 0.5)
    for (let x = -m.halfX + 0.25; x < m.halfX; x += 0.5) if (standable(m, x, z)) retreatCands.push({ x, z });
  // Walk from the centre region to every cell: read at each spawn.
  const dCentre = walkField(g, centre);
  const out: PairFairness[] = [];
  for (let k = 0; 2 * k + 1 < m.spawns.length; k++) {
    const A = m.spawns[2 * k];
    const B = m.spawns[2 * k + 1];
    const dA = walkField(g, [A]);
    const dB = walkField(g, [B]);
    const side = (me: Pt, foe: Pt, dMe: Float64Array, dFoe: Float64Array, exp: number, c: ReturnType<typeof contact> | null, first: boolean) => {
      let far = 0;
      let farSeen = 0;
      for (const p of sl.pts) {
        if (Math.hypot(p.x - me.x, p.z - me.z) <= LONG_LOS) continue;
        far++;
        if (clearShot(m, me, p)) farSeen++;
      }
      let terr = 0;
      let reach = 0;
      let hid = 0;
      let tall = 0;
      let spots = 0;
      let spotsHid = 0;
      let near = 0;
      for (let cI = 0; cI < g.walk.length; cI++) {
        if (!g.walk[cI]) continue;
        const a = dMe[cI];
        const b = dFoe[cI];
        if (a === Infinity && b === Infinity) continue;
        reach++;
        const w = a < b ? 1 : a === b ? 0.5 : 0;
        const p = cellPt(g, cI);
        const hugs = w > 0 || a <= COVER_NEAR_WALK ? coverFacing(m, p, foe) : false;
        if (a <= COVER_NEAR_WALK && hugs) near += cellArea;
        if (!w) continue;
        terr += w;
        hid += w * cam.chest[cI];
        tall += w * cam.tall[cI];
        if (hugs) {
          spots += w;
          spotsHid += w * cam.chest[cI];
        }
      }
      let retreat = 0;
      if (c && c.sightDist > 0) {
        const s = c.sight * PLAYER_SPEED;
        const pa = along(c.path.points, first ? s : c.path.length - s);
        const pb = along(c.path.points, first ? c.path.length - s : s);
        retreat = retreatDist(m, retreatCands, pa, pb);
      }
      const toC = dCentre[cellOf(g, me)];
      const v: Record<FairKey, number> = {
        exposure: exp,
        longExposure: far ? farSeen / far : 0,
        nearestCover: nearestCover(m, me),
        coverNear: near,
        toCentre: toC,
        retreat,
        territory: reach ? terr / reach : 0,
        camHidden: terr ? hid / terr : 0,
        camCover: spots ? spotsHid / spots : 0,
        tallShadow: terr ? tall / terr : 0,
      };
      return v;
    };
    const c = contacts[k] ?? null;
    const va = side(A, B, dA, dB, exposure[2 * k], c, true);
    const vb = side(B, A, dB, dA, exposure[2 * k + 1], c, false);
    const slack = k === 0 ? 1 : RESPAWN_SLACK;
    const metrics = FAIR_KEYS.map((key) => fairMetric(key, FAIR[key], va[key], vb[key], slack));
    const worst = metrics.reduce((w, x) => (x.score > w.score ? x : w));
    out.push({ k, metrics, worst });
  }
  return out;
}

// --- Checks -------------------------------------------------------------------

export interface Report {
  errors: string[];
  warnings: string[];
  stats: {
    size: string;
    obstacles: number;
    density: number;
    longest: number;
    longShare: number;
    openness: number;
    path: number;
    meet: number;
    sight: number;
    sightDist: number;
    hidden: number;
    spawnExposure: number;
    /** Highest share of the box footprint with a twin under one mirror (see `mirrorShares`). */
    mirror: number;
  };
  sl: Sightlines;
  pathPts: Pt[];
  /** Per spawn pair, side by side (see `fairness`). */
  fair: PairFairness[];
  /** Worst fairness score over all pairs (gap / tolerance; over 1 fails). */
  worstFair: number;
}

const f = (n: number, d = 1) => n.toFixed(d);

export function check(m: MapDef): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = (o: Obstacle) => `${o.kind}@(${o.x},${o.z})`;

  // Size.
  for (const [ax, h] of [["X", m.halfX], ["Z", m.halfZ]] as const)
    if (h < 12 || h > 20) errors.push(`half${ax} ${h} outside 12..20 (24..40 m arena)`);

  // Bounds, thickness, heights.
  for (const o of m.obstacles) {
    if (o.x - o.w / 2 < -m.halfX - EPS || o.x + o.w / 2 > m.halfX + EPS || o.z - o.d / 2 < -m.halfZ - EPS || o.z + o.d / 2 > m.halfZ + EPS)
      errors.push(`${name(o)} pokes out of the arena`);
    if (Math.min(o.w, o.d) < MIN_THICKNESS - EPS) errors.push(`${name(o)} thinner than ${MIN_THICKNESS} m`);
    if (o.h > 2.0 + EPS) errors.push(`${name(o)} is ${o.h} m tall: over 2 m it can hide a whole player from the camera`);
    if (o.h < 0.8) errors.push(`${name(o)} is ${o.h} m tall: it blocks bullets but looks like you could shoot over it`);
  }
  for (const s of m.spawns) {
    if (Math.abs(s.x) > m.halfX - R || Math.abs(s.z) > m.halfZ - R) errors.push(`spawn (${s.x},${s.z}) out of bounds`);
    for (const o of m.obstacles) if (circleHitsBox(s.x, s.z, R + 0.25, o)) errors.push(`spawn (${s.x},${s.z}) overlaps ${name(o)}`);
  }
  for (const d of m.decor) {
    const inside = Math.abs(d.x) < m.halfX && Math.abs(d.z) < m.halfZ;
    if (inside && !(FLAT_DECOR as readonly string[]).includes(d.prop))
      errors.push(`decor ${d.prop} at (${d.x},${d.z}) is tall and inside the arena: it would look like cover`);
    if (Math.abs(d.x) > m.halfX + 6 || Math.abs(d.z) > m.halfZ + 6) warnings.push(`decor ${d.prop} at (${d.x},${d.z}) is far outside`);
  }

  if (m.spawns.length < 2 || m.spawns.length % 2) errors.push(`spawns must come in pairs (${m.spawns.length})`);

  // Narrow gaps.
  for (let i = 0; i < m.obstacles.length; i++)
    for (let j = i + 1; j < m.obstacles.length; j++) {
      const g = boxGap(m.obstacles[i], m.obstacles[j]);
      if (g > EPS && g < MIN_GAP - EPS && !gapFilled(m, m.obstacles[i], m.obstacles[j]))
        errors.push(`gap ${f(g, 2)} m between ${name(m.obstacles[i])} and ${name(m.obstacles[j])}`);
    }
  for (const o of m.obstacles) {
    for (const g of [m.halfX - (o.x + o.w / 2), o.x - o.w / 2 + m.halfX, m.halfZ - (o.z + o.d / 2), o.z - o.d / 2 + m.halfZ])
      if (g > EPS && g < MIN_GAP - EPS) errors.push(`gap ${f(g, 2)} m between ${name(o)} and the outer wall`);
  }

  // Reachability.
  const g = walkGrid(m);
  const reached = flood(g, cellOf(g, m.spawns[0]));
  let walkable = 0;
  let lost = 0;
  let lostAt: Pt | null = null;
  for (let c = 0; c < g.walk.length; c++) {
    if (!g.walk[c]) continue;
    walkable++;
    if (!reached[c]) {
      lost++;
      if (!lostAt) lostAt = { x: g.x0 + (c % g.nx) * g.cell, z: g.z0 + Math.floor(c / g.nx) * g.cell };
    }
  }
  if (lost > 0) errors.push(`${lost} walkable cells unreachable (sealed pocket near (${f(lostAt!.x)},${f(lostAt!.z)}))`);
  for (const s of m.spawns) if (!reached[cellOf(g, s)]) errors.push(`spawn (${s.x},${s.z}) unreachable`);

  // Spawn sightlines: no spawn may see any other.
  for (let i = 0; i < m.spawns.length; i++)
    for (let j = i + 1; j < m.spawns.length; j++)
      if (bodiesSee(m, m.spawns[i], m.spawns[j]))
        errors.push(`spawns ${i} (${m.spawns[i].x},${m.spawns[i].z}) and ${j} (${m.spawns[j].x},${m.spawns[j].z}) see each other`);

  // Time to contact, for every pair.
  let first: ReturnType<typeof contact> = null;
  const contacts: ReturnType<typeof contact>[] = [];
  for (let k = 0; k + 1 < m.spawns.length; k += 2) {
    const c = contact(m, m.spawns[k], m.spawns[k + 1]);
    contacts.push(c);
    if (!c) {
      errors.push(`no path between spawns ${k} and ${k + 1}`);
      continue;
    }
    if (k === 0) first = c;
    if (c.meet < CONTACT_MIN || c.meet > CONTACT_MAX)
      errors.push(`spawns ${k}/${k + 1}: time to contact ${f(c.meet, 2)} s outside ${CONTACT_MIN}..${CONTACT_MAX} s`);
    else if (c.meet < CONTACT_TARGET[0] || c.meet > CONTACT_TARGET[1])
      warnings.push(`spawns ${k}/${k + 1}: time to contact ${f(c.meet, 2)} s outside the ${CONTACT_TARGET[0]}..${CONTACT_TARGET[1]} s target`);
  }

  // Stats.
  const area = 4 * m.halfX * m.halfZ;
  const covered = m.obstacles.reduce((s, o) => s + o.w * o.d, 0);
  const sl = sightlines(m);
  let hidden = 0;
  let total = 0;
  for (let c = 0; c < g.walk.length; c += 7) {
    if (!g.walk[c]) continue;
    total++;
    if (hiddenFromCamera(m, g.x0 + (c % g.nx) * g.cell, g.z0 + Math.floor(c / g.nx) * g.cell)) hidden++;
  }
  const hiddenShare = total ? hidden / total : 0;
  if (hiddenShare > 0.08) warnings.push(`${f(hiddenShare * 100)} % of the floor hides a player's chest from the camera`);
  const longest = sl.longest[0]?.len ?? 0;
  // Spawn exposure: share of the floor samples that have a clear shot at a spawn.
  let spawnExposure = 0;
  const exposure = m.spawns.map((sp, i) => {
    let seen = 0;
    for (const p of sl.pts) if (clearShot(m, sp, p)) seen++;
    const e = sl.pts.length ? seen / sl.pts.length : 0;
    spawnExposure = Math.max(spawnExposure, e);
    if (e > MAX_SPAWN_EXPOSURE) warnings.push(`spawn ${i} (${sp.x},${sp.z}) is visible from ${f(e * 100)} % of the floor`);
    return e;
  });

  // Fairness: each pair's two sides, metric by metric.
  const fair = fairness(m, sl, exposure, contacts);
  for (const pr of fair)
    for (const x of pr.metrics)
      if (x.score > 1) {
        const d = FAIR[x.key];
        errors.push(
          `unfair spawns ${2 * pr.k}/${2 * pr.k + 1}: ${d.label} ${fairValue(d.unit, x.a)} vs ${fairValue(d.unit, x.b)}, gap ${fairValue(d.unit, x.gap)} > ${fairValue(d.unit, x.tol)}`,
        );
      }
  const worstFair = fair.reduce((w, p) => Math.max(w, p.worst.score), 0);
  const mirror = mirrorCheck(m);
  if (mirror.error) errors.push(mirror.error);

  return {
    errors,
    warnings,
    stats: {
      size: `${2 * m.halfX}x${2 * m.halfZ}`,
      obstacles: m.obstacles.length,
      density: covered / area,
      longest,
      longShare: sl.longShare,
      openness: sl.openness,
      path: first?.path.length ?? 0,
      meet: first?.meet ?? 0,
      sight: first?.sight ?? 0,
      sightDist: first?.sightDist ?? 0,
      hidden: hiddenShare,
      spawnExposure,
      mirror: mirror.worst.share,
    },
    sl,
    pathPts: first?.path.points ?? [],
    fair,
    worstFair,
  };
}

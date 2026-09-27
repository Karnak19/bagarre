// Geometry and analysis shared by validate.ts and preview.ts. Mirrors the
// rules of src/physics.ts: players are circles of PLAYER_RADIUS,
// bullets circles of BULLET_RADIUS, and every obstacle box blocks both.

import { BULLET_RADIUS, PLAYER_RADIUS, PLAYER_SPEED } from "../src/constants.ts";
import { FLAT_DECOR, mirrorBox, mirrorPoint, type MapDef, type Obstacle, type Spawn } from "../src/maps/types.ts";

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

// --- Segments against boxes ---------------------------------------------------

/** True if segment a-b passes through the open interior of `b` inflated by `r`. */
export function segHitsBox(a: Pt, c: Pt, b: Obstacle, r: number): boolean {
  const minX = b.x - b.w / 2 - r;
  const maxX = b.x + b.w / 2 + r;
  const minZ = b.z - b.d / 2 - r;
  const maxZ = b.z + b.d / 2 + r;
  let t0 = 0;
  let t1 = 1;
  const dx = c.x - a.x;
  const dz = c.z - a.z;
  const axes: [number, number, number, number][] = [
    [a.x, dx, minX, maxX],
    [a.z, dz, minZ, maxZ],
  ];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (p <= lo + EPS || p >= hi - EPS) return false;
      continue;
    }
    let u0 = (lo - p) / d;
    let u1 = (hi - p) / d;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t1 - t0 <= 1e-9) return false;
  }
  return t1 - t0 > 1e-9;
}

/** Bullet line of sight between two centres. */
export function clearShot(m: MapDef, a: Pt, b: Pt): boolean {
  for (const o of m.obstacles) if (segHitsBox(a, b, o, BULLET_RADIUS)) return false;
  return true;
}

/**
 * Can either body see (and shoot) any part of the other? Checks the centre
 * line and two parallel lines along the edges of the bodies. Stricter than a
 * single ray: a spawn pair passes only if both bodies are fully hidden.
 */
export function bodiesSee(m: MapDef, a: Pt, b: Pt): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const L = Math.hypot(dx, dz) || 1;
  const nx = (-dz / L) * R * 0.9;
  const nz = (dx / L) * R * 0.9;
  for (const s of [0, 1, -1]) {
    if (clearShot(m, { x: a.x + nx * s, z: a.z + nz * s }, { x: b.x + nx * s, z: b.z + nz * s })) return true;
  }
  return false;
}

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
 */
export function hiddenFromCamera(m: MapDef, x: number, z: number, y = CHEST): boolean {
  for (const o of m.obstacles) {
    if (o.h <= y) continue;
    const lo = Math.max(0, o.x - o.w / 2 - x, o.z - o.d / 2 - z);
    const hi = Math.min(o.h - y, o.x + o.w / 2 - x, o.z + o.d / 2 - z);
    if (hi > lo) return true;
  }
  return false;
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
  };
  sl: Sightlines;
  pathPts: Pt[];
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
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

  // Symmetry: geometry and height must mirror; the kind (the look) may differ.
  let reskinned = 0;
  for (const o of m.obstacles) {
    const t = mirrorBox(m.symmetry, o);
    const hit = m.obstacles.find((p) => near(p.x, t.x) && near(p.z, t.z) && near(p.w, t.w) && near(p.d, t.d) && near(p.h, t.h));
    if (!hit) errors.push(`${name(o)} has no ${m.symmetry} mirror`);
    else if (hit.kind !== o.kind) reskinned++;
  }
  if (reskinned) warnings.push(`note: ${reskinned / 2} mirrored pairs are dressed as different kinds (same collision)`);
  if (m.spawns.length < 2 || m.spawns.length % 2) errors.push(`spawns must come in pairs (${m.spawns.length})`);
  for (let k = 0; k + 1 < m.spawns.length; k += 2) {
    const t = mirrorPoint(m.symmetry, m.spawns[k].x, m.spawns[k].z);
    if (!near(t.x, m.spawns[k + 1].x) || !near(t.z, m.spawns[k + 1].z)) errors.push(`spawn ${k + 1} is not the mirror of spawn ${k}`);
  }

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

  // Time to contact, for every mirrored pair.
  let first: ReturnType<typeof contact> = null;
  for (let k = 0; k + 1 < m.spawns.length; k += 2) {
    const c = contact(m, m.spawns[k], m.spawns[k + 1]);
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
  m.spawns.forEach((sp, i) => {
    let seen = 0;
    for (const p of sl.pts) if (clearShot(m, sp, p)) seen++;
    const e = sl.pts.length ? seen / sl.pts.length : 0;
    spawnExposure = Math.max(spawnExposure, e);
    if (e > MAX_SPAWN_EXPOSURE) warnings.push(`spawn ${i} (${sp.x},${sp.z}) is visible from ${f(e * 100)} % of the floor`);
  });

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
    },
    sl,
    pathPts: first?.path.points ?? [],
  };
}

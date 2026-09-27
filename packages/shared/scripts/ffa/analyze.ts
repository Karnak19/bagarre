// FFA map analysis, shared by ffa/validate.ts and ffa/preview.ts. The geometry
// (standable, walk grid, flood fill, gaps, shortest path, camera occlusion,
// line of sight) comes from ../analyze.ts and src/sight.ts; this file adds the
// checks that only make sense with 3-6 players on a big map.

import { PLAYER_SPEED, WEAPONS } from "../../src/constants.ts";
import { ffaRespawnPoint, ffaStartSpawns, type FfaMapDef } from "../../src/maps/ffa/index.ts";
import { FLAT_DECOR, type Obstacle } from "../../src/maps/types.ts";
import {
  along,
  bodiesSee,
  boxGap,
  cellOf,
  circleHitsBox,
  clearShot,
  flood,
  gapFilled,
  hiddenFromCamera,
  MIN_GAP,
  MIN_THICKNESS,
  R,
  shortestPath,
  standable,
  walkGrid,
  type Pt,
} from "../analyze.ts";

// --- Thresholds ----------------------------------------------------------------

/** Side length window, metres. */
export const SIZE: [number, number] = [50, 64];
/** Box budget per map (collision loops over every box, per player and per bullet sub-step). */
export const MAX_BOXES = 90;
export const MIN_SPAWNS = 16;
/** Longest weapon range (sniper): past this a sightline can't be used, so "sees" means within it. */
export const SHOT_RANGE = Math.max(...WEAPONS.map((w) => w.range));
/**
 * No camping spot: no standable point may see more than this share of the
 * floor within SHOT_RANGE. 25 %: with 6 players spread over the floor, a
 * camper on such a spot has on average 5 x 0.25 = 1.25 opponents in view, a
 * fair fight; at a third (1.7 in view, often 2+) the spot stops being a place
 * to fight from and becomes a place to farm third parties from. Duel maps are
 * much more open (Yard: 51 % of point pairs) because two players must find
 * each other; here the map is 3-4 times bigger and there are more players.
 */
export const MAX_CAMP = 0.25;
/**
 * First contact means on screen and in rifle range: a clear centre-line shot
 * within 20 m (the camera shows ~19 m along the screen axes, the rifle reaches 18 m).
 */
export const CONTACT_RANGE = 20;
/** Spawn balance: most exposed / least exposed spawn (least floored at EXPOSURE_FLOOR). */
export const MAX_EXPOSURE_RATIO = 3;
export const EXPOSURE_FLOOR = 0.02;
/** And no spawn visible from more than this share of the floor within SHOT_RANGE. */
export const MAX_SPAWN_EXPOSURE = 0.15;
/** Cover within a short dash of every spawn; balance on the nearest-cover distance too. */
export const MAX_COVER_DIST = 3;
export const MAX_COVER_RATIO = 3;
/** Two spawns closer than this must not see each other (the respawn rule can't always avoid it). */
export const SPAWN_LOS_MIN = 20;
export const MIN_SPAWN_SPACING = 8;
/**
 * Every standable point within this of some spawn (a 3.3 s walk). The hub is
 * kept free of spawns on purpose, so the rule is about the edges and corners
 * of the map not being left empty, not about the centre.
 */
export const MAX_SPAWN_REACH = 20;
/** First contact with 4 players, seconds: median window and p90 ceiling. */
export const CONTACT_MEDIAN: [number, number] = [3, 8];
export const CONTACT_P90 = 10;
/** Share of respawns (5 random opponents) that find a spawn nobody sees. */
export const MIN_HIDDEN_RESPAWN = 0.95;
/**
 * Mixed ranges: floor share that is "tight" (sees less than TIGHT_M2 of floor
 * within SHOT_RANGE: a room or a lane, shotgun and SMG ground) and "open"
 * (sees at least OPEN_M2 of floor lying beyond rifle range, 18..30 m: where
 * only the sniper reaches).
 */
export const TIGHT_M2 = 250;
export const OPEN_M2 = 150;
export const MIN_TIGHT_SHARE = 0.1;
export const MIN_OPEN_SHARE = 0.1;
/** Past this, the longest sightline is a warning (the camera shows ~27 m at most). */
export const WARN_LONGEST = 45;

const EPS = 1e-6;
const f = (n: number, d = 1) => n.toFixed(d);

// --- Sight pass ----------------------------------------------------------------

export interface FfaSight {
  pts: Pt[];
  /** Per sample: share of all samples it can shoot within SHOT_RANGE. */
  camp: Float32Array;
  /** Per sample: how many samples it can shoot between 18 m and SHOT_RANGE (sniper only). */
  far: Int32Array;
  longest: { a: Pt; b: Pt; len: number }[];
  longShare: number;
  openness: number;
}

/** Seen-within-range share for every sample on a `step` grid, plus the longest lines. */
export function ffaSight(m: FfaMapDef, step = 1): FfaSight {
  const pts: Pt[] = [];
  for (let z = -m.halfZ + step / 2; z < m.halfZ; z += step)
    for (let x = -m.halfX + step / 2; x < m.halfX; x += step) if (standable(m, x, z)) pts.push({ x, z });
  const n = pts.length;
  const seen = new Int32Array(n);
  const farSeenAt = new Int32Array(n);
  let far = 0;
  let farSeen = 0;
  let open = 0;
  let pairs = 0;
  const lines: { a: Pt; b: Pt; len: number }[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const len = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
      pairs++;
      if (len > 18) far++;
      if (!clearShot(m, pts[i], pts[j])) continue;
      open++;
      if (len > 18) farSeen++;
      if (len <= SHOT_RANGE) {
        seen[i]++;
        seen[j]++;
        if (len > 18) {
          farSeenAt[i]++;
          farSeenAt[j]++;
        }
      }
      if (len > 30) lines.push({ a: pts[i], b: pts[j], len });
    }
  lines.sort((p, q) => q.len - p.len);
  const longest: typeof lines = [];
  const near = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.z - q.z) < 6;
  for (const l of lines) {
    if (longest.some((k) => (near(k.a, l.a) && near(k.b, l.b)) || (near(k.a, l.b) && near(k.b, l.a)))) continue;
    longest.push(l);
    if (longest.length >= 6) break;
  }
  const camp = new Float32Array(n);
  for (let i = 0; i < n; i++) camp[i] = seen[i] / n;
  return { pts, camp, far: farSeenAt, longest, longShare: far ? farSeen / far : 0, openness: pairs ? open / pairs : 0 };
}

/** Share of the samples within SHOT_RANGE with a clear shot at `p`. */
function exposureAt(m: FfaMapDef, sl: FfaSight, p: Pt): number {
  let seen = 0;
  for (const q of sl.pts) if (Math.hypot(q.x - p.x, q.z - p.z) <= SHOT_RANGE && clearShot(m, p, q)) seen++;
  return seen / sl.pts.length;
}

/** Distance from a point to the nearest box surface (outer walls don't count: nobody shoots from beyond them). */
export function nearestCover(m: FfaMapDef, p: Pt): number {
  let best = Infinity;
  for (const o of m.obstacles) {
    const dx = Math.max(0, Math.abs(p.x - o.x) - o.w / 2);
    const dz = Math.max(0, Math.abs(p.z - o.z) - o.d / 2);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

// --- First contact -------------------------------------------------------------

function nearestStandable(m: FfaMapDef, p: Pt): Pt {
  if (standable(m, p.x, p.z)) return p;
  for (let r = 0.25; r < 10; r += 0.25)
    for (let a = 0; a < 16; a++) {
      const q = { x: p.x + r * Math.cos((a * Math.PI) / 8), z: p.z + r * Math.sin((a * Math.PI) / 8) };
      if (standable(m, q.x, q.z)) return q;
    }
  return p;
}

export interface Contact {
  /** Per spawn: the walk to the hub. */
  paths: Pt[][];
  /** First-sight time for every spawn pair, Infinity if never before HORIZON. */
  pair: number[][];
  /** First contact per simulated match start, sorted, for 3, 4 and 6 players. */
  three: number[];
  four: number[];
  six: number[];
  /** Uniform draws of 4 distinct spawns (ignoring the start rule): share with two players in sight at t = 0. */
  uniformInSight: number;
}

const HORIZON = 20;
const DT = 1 / 15;
const STARTS = 300;

/**
 * "Roam" model: nobody knows where anyone is, so everyone walks the shortest
 * path from their spawn to the hub (the contested centre) at full speed, then
 * waits there. First contact is the first moment two of them get a clear
 * centre-line shot at each other within CONTACT_RANGE.
 *
 * Starts are drawn the way the room will place players (docs/ffa-maps.md):
 * ffaStartSpawns, STARTS seeded draws per player count.
 */
export function firstContact(m: FfaMapDef): Contact {
  const hub = nearestStandable(m, m.hub);
  const paths = m.spawns.map((s) => shortestPath(m, s, hub)?.points ?? [s]);
  const lens = paths.map((p) => p.reduce((acc, q, i) => (i ? acc + Math.hypot(q.x - p[i - 1].x, q.z - p[i - 1].z) : 0), 0));
  const steps = Math.ceil(HORIZON / DT);
  const pos = paths.map((p, i) => Array.from({ length: steps + 1 }, (_, k) => along(p, Math.min(lens[i], k * DT * PLAYER_SPEED))));
  const n = m.spawns.length;
  const pair = Array.from({ length: n }, () => Array.from({ length: n }, () => Infinity));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      for (let k = 0; k <= steps; k++) {
        const a = pos[i][k];
        const b = pos[j][k];
        if (Math.hypot(a.x - b.x, a.z - b.z) <= CONTACT_RANGE && clearShot(m, a, b)) {
          pair[i][j] = pair[j][i] = k * DT;
          break;
        }
      }
    }
  const r = rng(99);
  const starts = (size: number) => {
    const out: number[] = [];
    for (let t = 0; t < STARTS; t++) {
      const placed = ffaStartSpawns(m, m.spawns, size, r).map((s) => m.spawns.indexOf(s));
      let first = Infinity;
      for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) first = Math.min(first, pair[placed[a]][placed[b]]);
      out.push(first);
    }
    return out.sort((a, b) => a - b);
  };
  let inSight = 0;
  for (let t = 0; t < STARTS && n >= 4; t++) {
    const pick = new Set<number>();
    while (pick.size < 4) pick.add(Math.floor(r() * n));
    const p = [...pick];
    if (p.some((a, i) => p.some((b, j) => j > i && pair[a][b] === 0))) inSight++;
  }
  return { paths, pair, three: starts(3), four: starts(4), six: starts(6), uniformInSight: inSight / STARTS };
}

export const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

// --- Respawn simulation ----------------------------------------------------------

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 5 opponents on random standable samples; how often ffaRespawnPoint finds a hidden spawn, and how far it lands. */
function respawnSim(m: FfaMapDef, sl: FfaSight, trials = 1500) {
  const r = rng(1234);
  let hidden = 0;
  const dists: number[] = [];
  const use = new Int32Array(m.spawns.length);
  for (let t = 0; t < trials; t++) {
    const opp = Array.from({ length: 5 }, () => sl.pts[Math.floor(r() * sl.pts.length)]);
    const s = ffaRespawnPoint(m, m.spawns, opp, r);
    use[m.spawns.indexOf(s)]++;
    if (!opp.some((o) => bodiesSee(m, s, o))) hidden++;
    dists.push(Math.min(...opp.map((o) => Math.hypot(o.x - s.x, o.z - s.z))));
  }
  dists.sort((a, b) => a - b);
  return { hidden: hidden / trials, medianDist: quantile(dists, 0.5), use };
}

// --- Report ----------------------------------------------------------------------

export interface SpawnStat {
  exposure: number;
  cover: number;
  /** Other spawns it can see within SHOT_RANGE. */
  sees: number;
  zone: string;
}

export interface FfaReport {
  errors: string[];
  warnings: string[];
  sl: FfaSight;
  contact: Contact;
  spawns: SpawnStat[];
  stats: {
    size: string;
    boxes: number;
    density: number;
    longest: number;
    longShare: number;
    openness: number;
    camp: number;
    campAt: Pt;
    tight: number;
    open: number;
    minSpawnGap: number;
    spawnReach: number;
    expMin: number;
    expMax: number;
    coverMax: number;
    coverMin: number;
    c4: [number, number, number];
    c3: number;
    c6: number;
    uniformInSight: number;
    hiddenRespawn: number;
    respawnDist: number;
    hidden: number;
  };
}

export function zoneOf(m: FfaMapDef, p: Pt): string {
  const z = m.zones.find((z) => p.x >= z.x0 - EPS && p.x <= z.x1 + EPS && p.z >= z.z0 - EPS && p.z <= z.z1 + EPS);
  return z?.id ?? "-";
}

export function checkFfa(m: FfaMapDef): FfaReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = (o: Obstacle) => `${o.kind}@(${o.x},${o.z} ${o.w}x${o.d})`;

  // Size, box budget, box shapes.
  for (const [ax, h] of [["X", m.halfX], ["Z", m.halfZ]] as const)
    if (2 * h < SIZE[0] || 2 * h > SIZE[1]) errors.push(`${ax} side ${2 * h} m outside ${SIZE[0]}..${SIZE[1]} m`);
  if (m.mode !== "ffa") errors.push(`mode is not "ffa"`);
  if (m.obstacles.length > MAX_BOXES) errors.push(`${m.obstacles.length} boxes, budget ${MAX_BOXES}`);
  for (const o of m.obstacles) {
    if (o.x - o.w / 2 < -m.halfX - EPS || o.x + o.w / 2 > m.halfX + EPS || o.z - o.d / 2 < -m.halfZ - EPS || o.z + o.d / 2 > m.halfZ + EPS)
      errors.push(`${name(o)} pokes out of the arena`);
    if (Math.min(o.w, o.d) < MIN_THICKNESS - EPS) errors.push(`${name(o)} thinner than ${MIN_THICKNESS} m`);
    if (o.h > 2.0 + EPS) errors.push(`${name(o)} is ${o.h} m tall: over 2 m it can hide a whole player from the camera`);
    if (o.h < 0.8) errors.push(`${name(o)} is ${o.h} m tall: it blocks bullets but looks like you could shoot over it`);
    // Long thin walls stay low (docs/maps.md, "Readability"); 2 m deep blocks
    // (container rows, like Dockside's) may be taller.
    const long = Math.max(o.w, o.d);
    if (long >= 4 && Math.min(o.w, o.d) < 1.5 - EPS && (o.h < 1.1 - EPS || o.h > 1.4 + EPS))
      errors.push(`${name(o)} is a long wall (${long} m) at ${o.h} m: long walls stay at 1.1..1.4 m`);
    if (o.kind === "container" && Math.min(o.w, o.d) < 1.5 - EPS) warnings.push(`${name(o)}: a container thinner than 1.5 m reads as a maze wall`);
  }
  for (let i = 0; i < m.obstacles.length; i++)
    for (let j = i + 1; j < m.obstacles.length; j++) {
      const a = m.obstacles[i];
      const b = m.obstacles[j];
      const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
      const oz = Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
      if (ox > EPS && oz > EPS) warnings.push(`${name(a)} overlaps ${name(b)}`);
      const g = boxGap(a, b);
      if (g > EPS && g < MIN_GAP - EPS && !gapFilled(m, a, b)) errors.push(`gap ${f(g, 2)} m between ${name(a)} and ${name(b)}`);
    }
  for (const o of m.obstacles)
    for (const g of [m.halfX - (o.x + o.w / 2), o.x - o.w / 2 + m.halfX, m.halfZ - (o.z + o.d / 2), o.z - o.d / 2 + m.halfZ])
      if (g > EPS && g < MIN_GAP - EPS) errors.push(`gap ${f(g, 2)} m between ${name(o)} and the outer wall`);

  // Spawns and decor placement.
  if (m.spawns.length < MIN_SPAWNS) errors.push(`${m.spawns.length} spawns, need ${MIN_SPAWNS}`);
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
  for (const z of m.zones)
    if (z.x0 >= z.x1 || z.z0 >= z.z1 || z.x0 < -m.halfX - EPS || z.x1 > m.halfX + EPS || z.z0 < -m.halfZ - EPS || z.z1 > m.halfZ + EPS)
      errors.push(`zone ${z.id} is empty or pokes out`);
  for (const l of m.landmarks) if (Math.abs(l.x) > m.halfX || Math.abs(l.z) > m.halfZ) errors.push(`landmark ${l.name} out of bounds`);

  // Reachability.
  const g = walkGrid(m);
  const reached = flood(g, cellOf(g, m.spawns[0]));
  let lost = 0;
  let lostAt: Pt | null = null;
  for (let c = 0; c < g.walk.length; c++)
    if (g.walk[c] && !reached[c]) {
      lost++;
      lostAt ??= { x: g.x0 + (c % g.nx) * g.cell, z: g.z0 + Math.floor(c / g.nx) * g.cell };
    }
  if (lost > 0) errors.push(`${lost} walkable cells unreachable (sealed pocket near (${f(lostAt!.x)},${f(lostAt!.z)}))`);
  for (const s of m.spawns) if (!reached[cellOf(g, s)]) errors.push(`spawn (${s.x},${s.z}) unreachable`);

  // Sightlines and camping.
  const sl = ffaSight(m);
  let camp = 0;
  let campAt: Pt = { x: 0, z: 0 };
  let tight = 0;
  let open = 0;
  sl.pts.forEach((p, i) => {
    if (sl.camp[i] > camp) {
      camp = sl.camp[i];
      campAt = p;
    }
    if (sl.camp[i] * sl.pts.length < TIGHT_M2) tight++;
    if (sl.far[i] >= OPEN_M2) open++;
  });
  tight /= sl.pts.length;
  open /= sl.pts.length;
  if (camp > MAX_CAMP) errors.push(`camping spot at (${f(campAt.x)},${f(campAt.z)}) sees ${f(camp * 100)} % of the floor within ${SHOT_RANGE} m (max ${MAX_CAMP * 100} %)`);
  if (tight < MIN_TIGHT_SHARE) errors.push(`only ${f(tight * 100)} % of the floor is tight (sees < ${TIGHT_M2} m²): nothing for the shotgun`);
  if (open < MIN_OPEN_SHARE) errors.push(`only ${f(open * 100)} % of the floor is open (sees >= ${OPEN_M2} m² beyond 18 m): nothing for the sniper`);
  const longest = sl.longest[0]?.len ?? 0;
  if (longest > WARN_LONGEST) warnings.push(`longest sightline ${f(longest)} m (warn over ${WARN_LONGEST} m)`);

  // Spawn balance.
  const spawns: SpawnStat[] = m.spawns.map((s) => ({ exposure: exposureAt(m, sl, s), cover: nearestCover(m, s), sees: 0, zone: zoneOf(m, s) }));
  let minSpawnGap = Infinity;
  for (let i = 0; i < m.spawns.length; i++)
    for (let j = i + 1; j < m.spawns.length; j++) {
      const a = m.spawns[i];
      const b = m.spawns[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      minSpawnGap = Math.min(minSpawnGap, d);
      if (d <= SHOT_RANGE && bodiesSee(m, a, b)) {
        spawns[i].sees++;
        spawns[j].sees++;
        if (d < SPAWN_LOS_MIN) errors.push(`spawns ${i} (${a.x},${a.z}) and ${j} (${b.x},${b.z}) see each other at ${f(d)} m`);
      }
    }
  if (minSpawnGap < MIN_SPAWN_SPACING) errors.push(`two spawns only ${f(minSpawnGap)} m apart (min ${MIN_SPAWN_SPACING})`);
  const exps = spawns.map((s) => s.exposure);
  const covers = spawns.map((s) => s.cover);
  const expMax = Math.max(...exps);
  const expMin = Math.min(...exps);
  const coverMax = Math.max(...covers);
  const coverMin = Math.min(...covers);
  if (expMax / Math.max(expMin, EXPOSURE_FLOOR) > MAX_EXPOSURE_RATIO)
    errors.push(`spawn exposure ratio ${f(expMax / Math.max(expMin, EXPOSURE_FLOOR), 2)} (${f(expMax * 100)} % / ${f(expMin * 100)} %), max ${MAX_EXPOSURE_RATIO}`);
  spawns.forEach((s, i) => {
    if (s.exposure > MAX_SPAWN_EXPOSURE) errors.push(`spawn ${i} (${m.spawns[i].x},${m.spawns[i].z}) seen from ${f(s.exposure * 100)} % of the floor (max ${MAX_SPAWN_EXPOSURE * 100} %)`);
    if (s.cover > MAX_COVER_DIST) errors.push(`spawn ${i} (${m.spawns[i].x},${m.spawns[i].z}): nearest cover ${f(s.cover)} m (max ${MAX_COVER_DIST})`);
    if (s.zone === "-") warnings.push(`spawn ${i} is in no zone`);
  });
  if (coverMax / Math.max(coverMin, 0.5) > MAX_COVER_RATIO) errors.push(`nearest-cover ratio ${f(coverMax / Math.max(coverMin, 0.5), 2)}, max ${MAX_COVER_RATIO}`);
  // Coverage: how far any standable point is from its nearest spawn.
  let spawnReach = 0;
  for (const p of sl.pts) spawnReach = Math.max(spawnReach, Math.min(...m.spawns.map((s) => Math.hypot(s.x - p.x, s.z - p.z))));
  if (spawnReach > MAX_SPAWN_REACH) errors.push(`some floor is ${f(spawnReach)} m from the nearest spawn (max ${MAX_SPAWN_REACH})`);
  // Quadrant spread.
  const quads = [0, 0, 0, 0];
  for (const s of m.spawns) quads[(s.x < 0 ? 0 : 1) + (s.z < 0 ? 0 : 2)]++;
  if (Math.min(...quads) < Math.floor(m.spawns.length / 4) - 1) errors.push(`spawns per quadrant uneven: ${quads.join("/")}`);

  // First contact.
  const contact = firstContact(m);
  const c4: [number, number, number] = [quantile(contact.four, 0.1), quantile(contact.four, 0.5), quantile(contact.four, 0.9)];
  if (c4[1] < CONTACT_MEDIAN[0] || c4[1] > CONTACT_MEDIAN[1]) errors.push(`4-player first contact median ${f(c4[1], 2)} s outside ${CONTACT_MEDIAN.join("..")} s`);
  if (c4[2] > CONTACT_P90) errors.push(`4-player first contact p90 ${f(c4[2], 2)} s over ${CONTACT_P90} s`);

  // Respawns with 5 opponents.
  const rs = respawnSim(m, sl);
  if (rs.hidden < MIN_HIDDEN_RESPAWN) errors.push(`only ${f(rs.hidden * 100)} % of respawns out of every opponent's sight (min ${MIN_HIDDEN_RESPAWN * 100} %)`);
  const unused = [...rs.use].map((u, i) => (u ? -1 : i)).filter((i) => i >= 0);
  if (unused.length) warnings.push(`spawns never picked by the respawn rule in the simulation: ${unused.join(", ")}`);

  // Camera occlusion.
  let hid = 0;
  let tot = 0;
  for (let c = 0; c < g.walk.length; c += 7) {
    if (!g.walk[c]) continue;
    tot++;
    if (hiddenFromCamera(m, g.x0 + (c % g.nx) * g.cell, g.z0 + Math.floor(c / g.nx) * g.cell)) hid++;
  }
  const hidden = tot ? hid / tot : 0;
  if (hidden > 0.05) warnings.push(`${f(hidden * 100)} % of the floor hides a player's chest from the camera`);

  const area = 4 * m.halfX * m.halfZ;
  return {
    errors,
    warnings,
    sl,
    contact,
    spawns,
    stats: {
      size: `${2 * m.halfX}x${2 * m.halfZ}`,
      boxes: m.obstacles.length,
      density: m.obstacles.reduce((s, o) => s + o.w * o.d, 0) / area,
      longest,
      longShare: sl.longShare,
      openness: sl.openness,
      camp,
      campAt,
      tight,
      open,
      minSpawnGap,
      spawnReach,
      expMin,
      expMax,
      coverMin,
      coverMax,
      c4,
      c3: quantile(contact.three, 0.5),
      c6: quantile(contact.six, 0.5),
      uniformInSight: contact.uniformInSight,
      hiddenRespawn: rs.hidden,
      respawnDist: rs.medianDist,
      hidden,
    },
  };
}


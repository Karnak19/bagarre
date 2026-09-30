// Self-check of the battle royale maps' layout (src/maps/royale/): the map rules the
// mode relies on, so a broken spot fails here and not in a play test.
// Run with `bun run check` (in packages/shared). Exits non-zero on a failure.
//
// For every map in ROYALE_MAPS:
// 1. size 80..100 m a side; box heights and the thin-long rule; no narrow gaps;
// 2. at least 10 start spots; every start and crate spot standable and in bounds;
// 3. no two start spots see each other (any distance);
// 4. 15..25 crate spots, none within 3 m of a start, none on top of each other;
// 5. everything reachable on foot, and the whole floor one connected region;
// 6. the final zone's rectangle well inside the map;
// 7. endgame cover: the real zone 30 s before it closes, for every final
//    centre it may close on, has cover and room to stand in;
// 8. tall decor (trees) outside the walls, and hiding no floor from the camera.
//
// The geometry comes from scripts/analyze.ts (the duel validator's helpers).
// scripts/royale.check.ts checks the same maps against the mode's rules
// (crates clear of cover and 3 m from spawns, the zone's limits).

import { PLAYER_RADIUS, ROYALE, ZONE, ticks } from "../src/constants.ts";
import { ROYALE_MAPS, type RoyaleMapDef } from "../src/maps/royale/index.ts";
import type { ZoneView } from "../src/protocol.ts";
import { zoneAt, type Circle } from "../src/royale.ts";
import { WALL_THICKNESS } from "../src/arena.ts";
import { TALL_DECOR, type Obstacle, type Spawn } from "../src/maps/types.ts";
import { ffaSight, OPEN_M2, TIGHT_M2, type FfaSight } from "./ffa/analyze.ts";
import { bodiesSee, boxGap, cellOf, cellPt, circleHitsBox, flood, gapFilled, hiddenFromCamera, MIN_GAP, MIN_THICKNESS, R, walkGrid } from "./analyze.ts";

/** Side of the map, metres. */
const SIZE: [number, number] = [80, 100];
const MIN_STARTS = 10;
const CRATE_COUNT: [number, number] = [15, 25];
/** A crate this close to a start spot would hand that player a free crate (royale.check.ts's rule too). */
const CRATE_START_MIN = 3;
/** A crate spot keeps its crate and a player touching it clear of every box (royale.check.ts's rule too). */
const CRATE_CLEAR = ROYALE.crateRadius + PLAYER_RADIUS;
const CRATE_CRATE_MIN = 1.5;
/** A spot must clear every box by this much on top of the player radius (like the duel validator's spawns). */
const SPOT_CLEAR = 0.25;
/** The final zone's rectangle keeps at least this far from every edge. */
const FINAL_MARGIN = 12;
/**
 * The endgame the cover check looks at: the zone this many seconds before it
 * closes. The real zone (pickZone, ZONE) shrinks linearly from a circle round
 * the whole map (r ~65.6 m on a 90 m map) to nothing over ZONE.close -
 * ZONE.wait = 240 s, about 0.27 m/s, while its centre slides from the map's
 * centre to the final one. 30 s before the end it is about 8.2 m across the
 * radius (16 m wide, the issue's "last 10 to 15 m"), and it is the last
 * circle two or three players still fight in: 20 s before, 5.5 m, is a
 * shootout at arm's length.
 */
export const LATE_SECONDS = 30;

/** The real zone's circle LATE_SECONDS before it closes, on a match whose final centre is (x, z) (pickZone's circles, zoneAt's shrink). */
export function lateCircle(m: RoyaleMapDef, x: number, z: number): Circle {
  const shrink = ZONE.close - ZONE.wait;
  const zone: ZoneView = { x0: 0, z0: 0, x1: x, z1: z, r0: Math.hypot(m.halfX, m.halfZ) + ZONE.margin, r1: 0, start: 0, end: ticks(shrink) };
  return zoneAt(zone, ticks(shrink - LATE_SECONDS))!;
}

/** The late circle's radius on a map (the same for every centre). */
export const lateRadius = (m: RoyaleMapDef) => lateCircle(m, 0, 0).r;
/** Every possible final circle has at least this many boxes in it... */
const FINAL_MIN_BOXES = 2;
/** ...and at least this share of it is floor a player can stand on. */
const FINAL_MIN_FLOOR = 0.5;
/** Walk grid cell for the flood fill and the floor share, metres. */
const CELL = 0.2;
const EPS = 1e-6;
/**
 * Tall decor as the camera sees it, at scale 1: a square column of half-side
 * `r` and height `h` round its origin. The trees' numbers are the largest of
 * each family in the Ultimate Nature Pack (PineTree_Snow_3 is 2.2 m wide,
 * PineTree_Snow_2 3.6 m tall; CommonTree_Dead_Snow_1 2.1 m wide,
 * CommonTree_Dead_Snow_3 3.0 m tall); the kit's small props are about 1 m.
 */
const DECOR_COLUMN: Record<string, { r: number; h: number }> = {
  PineTree: { r: 1.1, h: 3.6 },
  CommonTree: { r: 1.1, h: 3.0 },
  other: { r: 0.6, h: 1.2 },
};
const columnOf = (prop: string) => DECOR_COLUMN[prop.split("_")[0]] ?? DECOR_COLUMN.other;
/** Sight samples every this many metres for the tight/open shares (1 m, as on the FFA maps, takes ~25 s at 90 m; 2 m is within 0.2 pp of it). */
const SIGHT_STEP = 2;

/**
 * Tight and open floor, as the FFA validator defines them (scripts/ffa/analyze.ts):
 * tight floor sees less than TIGHT_M2 of floor within the longest weapon's
 * range (shotgun and SMG ground); open floor sees at least OPEN_M2 of floor
 * beyond rifle range (sniper lanes). Reported, not checked.
 */
export function tightOpen(m: RoyaleMapDef): { sl: FfaSight; tight: Uint8Array; tightShare: number; openShare: number } {
  const sl = ffaSight(m, SIGHT_STEP);
  const n = sl.pts.length;
  const cell = SIGHT_STEP * SIGHT_STEP;
  const tight = new Uint8Array(n);
  let t = 0;
  let o = 0;
  for (let i = 0; i < n; i++) {
    if (sl.camp[i] * n * cell < TIGHT_M2) {
      tight[i] = 1;
      t++;
    }
    if (sl.far[i] * cell >= OPEN_M2) o++;
  }
  return { sl, tight, tightShare: n ? t / n : 0, openShare: n ? o / n : 0 };
}

const failures: string[] = [];
function check(cond: boolean, label: string, detail: string[] = []) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) {
    failures.push(label);
    for (const d of detail.slice(0, 12)) console.log(`        ${d}`);
    if (detail.length > 12) console.log(`        ... and ${detail.length - 12} more`);
  }
}

const f = (n: number, d = 1) => n.toFixed(d);
const at = (p: Spawn) => `(${p.x}, ${p.z})`;
const name = (o: Obstacle) => `${o.kind}@(${o.x},${o.z})`;

function checkMap(m: RoyaleMapDef) {
  const t0 = performance.now();
  console.log(`\n${m.name} (${m.id})`);

  // 1. Size, boxes, gaps.
  const sx = 2 * m.halfX;
  const sz = 2 * m.halfZ;
  check(sx >= SIZE[0] && sx <= SIZE[1] && sz >= SIZE[0] && sz <= SIZE[1], `size ${sx} x ${sz} m within ${SIZE[0]}..${SIZE[1]} m a side`);
  const boxErrors: string[] = [];
  for (const o of m.obstacles) {
    if (o.x - o.w / 2 < -m.halfX - EPS || o.x + o.w / 2 > m.halfX + EPS || o.z - o.d / 2 < -m.halfZ - EPS || o.z + o.d / 2 > m.halfZ + EPS)
      boxErrors.push(`${name(o)} pokes out of the map`);
    if (Math.min(o.w, o.d) < MIN_THICKNESS - EPS) boxErrors.push(`${name(o)} thinner than ${MIN_THICKNESS} m`);
    if (o.h < 0.8 - EPS || o.h > 2.0 + EPS) boxErrors.push(`${name(o)} is ${o.h} m tall (0.8..2.0)`);
    if (Math.min(o.w, o.d) < 1.5 && Math.max(o.w, o.d) >= 4 - EPS && (o.h < 1.1 - EPS || o.h > 1.4 + EPS))
      boxErrors.push(`${name(o)} is a long thin wall ${o.h} m tall (1.1..1.4)`);
  }
  check(boxErrors.length === 0, `${m.obstacles.length} boxes in bounds, 0.8-2.0 m tall, long thin walls 1.1-1.4 m`, boxErrors);
  const gapErrors: string[] = [];
  for (let i = 0; i < m.obstacles.length; i++)
    for (let j = i + 1; j < m.obstacles.length; j++) {
      const a = m.obstacles[i];
      const b = m.obstacles[j];
      const g = boxGap(a, b);
      if (g > EPS && g < MIN_GAP - EPS && !gapFilled(m, a, b)) gapErrors.push(`gap ${f(g, 2)} m between ${name(a)} and ${name(b)}`);
    }
  for (const o of m.obstacles)
    for (const g of [m.halfX - (o.x + o.w / 2), o.x - o.w / 2 + m.halfX, m.halfZ - (o.z + o.d / 2), o.z - o.d / 2 + m.halfZ])
      if (g > EPS && g < MIN_GAP - EPS) gapErrors.push(`gap ${f(g, 2)} m between ${name(o)} and the outer wall`);
  check(gapErrors.length === 0, `no gap under ${MIN_GAP} m between boxes or a box and the wall`, gapErrors);

  // 2. Spots clear of boxes and in bounds.
  const spotErrors = (kind: string, spots: readonly Spawn[], clear = R + SPOT_CLEAR) => {
    const out: string[] = [];
    for (const s of spots) {
      if (Math.abs(s.x) > m.halfX - clear || Math.abs(s.z) > m.halfZ - clear) out.push(`${kind} ${at(s)} too close to the edge`);
      for (const o of m.obstacles) if (circleHitsBox(s.x, s.z, clear, o)) out.push(`${kind} ${at(s)} in or against ${name(o)}`);
    }
    return out;
  };
  check(m.spawns.length >= MIN_STARTS, `${m.spawns.length} start spots (at least ${MIN_STARTS})`);
  check(spotErrors("start", m.spawns).length === 0, "every start spot clear of boxes and in bounds", spotErrors("start", m.spawns));
  check(
    spotErrors("crate", m.royale.crates, CRATE_CLEAR).length === 0,
    `every crate spot ${CRATE_CLEAR} m clear of boxes and in bounds`,
    spotErrors("crate", m.royale.crates, CRATE_CLEAR),
  );

  // 3. Starts out of each other's sight.
  const seen: string[] = [];
  let minStart = Infinity;
  for (let i = 0; i < m.spawns.length; i++)
    for (let j = i + 1; j < m.spawns.length; j++) {
      const a = m.spawns[i];
      const b = m.spawns[j];
      minStart = Math.min(minStart, Math.hypot(a.x - b.x, a.z - b.z));
      if (bodiesSee(m, a, b)) seen.push(`starts ${i} ${at(a)} and ${j} ${at(b)} see each other (${f(Math.hypot(a.x - b.x, a.z - b.z))} m)`);
    }
  check(seen.length === 0, "no two start spots see each other", seen);

  // 4. Crates.
  check(m.royale.crates.length >= CRATE_COUNT[0] && m.royale.crates.length <= CRATE_COUNT[1], `${m.royale.crates.length} crate spots (${CRATE_COUNT[0]}..${CRATE_COUNT[1]})`);
  const crateErrors: string[] = [];
  for (const c of m.royale.crates)
    for (const s of m.spawns) if (Math.hypot(c.x - s.x, c.z - s.z) < CRATE_START_MIN) crateErrors.push(`crate ${at(c)} within ${CRATE_START_MIN} m of start ${at(s)}`);
  for (let i = 0; i < m.royale.crates.length; i++)
    for (let j = i + 1; j < m.royale.crates.length; j++)
      if (Math.hypot(m.royale.crates[i].x - m.royale.crates[j].x, m.royale.crates[i].z - m.royale.crates[j].z) < CRATE_CRATE_MIN)
        crateErrors.push(`crates ${at(m.royale.crates[i])} and ${at(m.royale.crates[j])} closer than ${CRATE_CRATE_MIN} m`);
  check(crateErrors.length === 0, `crates at least ${CRATE_START_MIN} m from starts and ${CRATE_CRATE_MIN} m apart`, crateErrors);

  // 5. Reachability: one connected floor, every spot on it.
  const g = walkGrid(m, CELL);
  const reached = flood(g, cellOf(g, m.spawns[0]));
  let walkable = 0;
  let lost = 0;
  let lostAt = { x: 0, z: 0 };
  for (let c = 0; c < g.walk.length; c++) {
    if (!g.walk[c]) continue;
    walkable++;
    if (!reached[c]) {
      if (!lost) lostAt = cellPt(g, c);
      lost++;
    }
  }
  const unreached = [...m.spawns.map((s) => ["start", s] as const), ...m.royale.crates.map((s) => ["crate", s] as const)]
    .filter(([, s]) => !reached[cellOf(g, s)])
    .map(([k, s]) => `${k} ${at(s)} not reachable from start 0`);
  check(unreached.length === 0, "every start and crate spot reachable on foot from start 0", unreached);
  check(lost === 0, `the whole floor is one connected region (${walkable} cells of ${CELL} m)`, lost ? [`${lost} cells cut off, first near (${f(lostAt.x)}, ${f(lostAt.z)})`] : []);

  // 6. Final zone rectangle.
  const z = m.royale.zone;
  const margin = Math.min(z.x0 + m.halfX, m.halfX - z.x1, z.z0 + m.halfZ, m.halfZ - z.z1);
  check(z.x0 <= z.x1 && z.z0 <= z.z1 && margin >= FINAL_MARGIN - EPS, `final zone [${z.x0}, ${z.x1}] x [${z.z0}, ${z.z1}] at least ${FINAL_MARGIN} m from the edges (${f(margin)} m)`);

  // 7. Endgame cover: every final centre on a 1 m grid, and the real zone
  // LATE_SECONDS before it closes on it.
  const r = lateRadius(m);
  const rc = Math.ceil(r / g.cell) + 1;
  let worst = { x: 0, z: 0, boxes: Infinity, floor: Infinity, score: Infinity };
  const coverErrors: string[] = [];
  let centres = 0;
  for (let cz = Math.ceil(z.z0); cz <= z.z1 + EPS; cz++)
    for (let cx = Math.ceil(z.x0); cx <= z.x1 + EPS; cx++) {
      centres++;
      const late = lateCircle(m, cx, cz);
      let boxes = 0;
      for (const o of m.obstacles) if (circleHitsBox(late.x, late.z, r, o)) boxes++;
      const c0 = cellOf(g, late);
      const i0 = c0 % g.nx;
      const j0 = (c0 - i0) / g.nx;
      let cells = 0;
      let open = 0;
      for (let dj = -rc; dj <= rc; dj++)
        for (let di = -rc; di <= rc; di++) {
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
          const p = cellPt(g, j * g.nx + i);
          if ((p.x - late.x) ** 2 + (p.z - late.z) ** 2 > r * r) continue;
          cells++;
          if (g.walk[j * g.nx + i]) open++;
        }
      const floor = cells ? open / cells : 0;
      // How close to failing: the tighter of the two measures, as a share of its limit.
      const score = Math.min(boxes / FINAL_MIN_BOXES, floor / FINAL_MIN_FLOOR);
      if (score < worst.score) worst = { x: cx, z: cz, boxes, floor, score };
      if (boxes < FINAL_MIN_BOXES || floor < FINAL_MIN_FLOOR)
        coverErrors.push(`final centre (${cx}, ${cz}), circle at (${f(late.x)}, ${f(late.z)}): ${boxes} boxes, ${f(floor * 100, 0)} % floor`);
    }
  check(
    coverErrors.length === 0,
    `the zone ${LATE_SECONDS} s before it closes (r ${f(r)} m), for all ${centres} final centres, has ${FINAL_MIN_BOXES}+ boxes and ${FINAL_MIN_FLOOR * 100}%+ standable floor`,
    coverErrors,
  );

  // 8. Tall decor: outside the walls, and no floor hidden from the camera.
  // The camera looks down (-1, -1, -1) from the +x / +z side, so a tree just
  // outside the +x or +z wall stands between it and the floor near that wall.
  const tall = m.decor.filter((d) => (TALL_DECOR as readonly string[]).includes(d.prop));
  const inside = tall
    .filter((d) => Math.abs(d.x) - columnOf(d.prop).r * (d.scale ?? 1) < m.halfX + WALL_THICKNESS && Math.abs(d.z) - columnOf(d.prop).r * (d.scale ?? 1) < m.halfZ + WALL_THICKNESS)
    .map((d) => `${d.prop} at (${d.x}, ${d.z}) touches the arena or its walls`);
  check(inside.length === 0, `${tall.length} tall decor props all outside the walls`, inside);
  const columns = {
    ...m,
    obstacles: tall.map((d) => {
      const { r, h } = columnOf(d.prop);
      const k = d.scale ?? 1;
      return { kind: "crate" as const, x: d.x, z: d.z, w: 2 * r * k, d: 2 * r * k, h: h * k };
    }),
  };
  const shaded: string[] = [];
  for (let c = 0; c < g.walk.length; c += 3) {
    if (!g.walk[c]) continue;
    const p = cellPt(g, c);
    // Any part of a player (from the feet up) hidden by a tree counts.
    if (hiddenFromCamera(columns, p.x, p.z, 0.05)) shaded.push(`floor at (${f(p.x)}, ${f(p.z)}) hidden from the camera by tall decor`);
  }
  check(shaded.length === 0, "tall decor hides no floor from the camera", shaded);

  const { tightShare, openShare } = tightOpen(m);
  const ms = performance.now() - t0;
  return { m, minStart, worst, tightShare, openShare, ms };
}

if (import.meta.main) {
  const rows = ROYALE_MAPS.map(checkMap);

  console.log("\nmap        size   boxes  starts  crates  min start gap  worst endgame circle           tight  open   time");
  for (const { m, minStart, worst, tightShare, openShare, ms } of rows)
    console.log(
      [
        m.id.padEnd(10),
        `${2 * m.halfX}x${2 * m.halfZ}`.padEnd(6),
        String(m.obstacles.length).padEnd(6),
        String(m.spawns.length).padEnd(7),
        String(m.royale.crates.length).padEnd(7),
        `${f(minStart)} m`.padEnd(14),
        `(${worst.x}, ${worst.z}) ${worst.boxes} boxes ${f(worst.floor * 100, 0)}% floor`.padEnd(30),
        `${f(tightShare * 100)}%`.padEnd(6),
        `${f(openShare * 100)}%`.padEnd(6),
        `${f(ms / 1000, 2)} s`,
      ].join(" "),
    );

  if (failures.length > 0) {
    console.error(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log("\nroyale maps: all checks passed");
}

// Self-check of the battle royale maps (src/maps/royale/): the map rules the
// mode relies on, so a broken spot fails here and not in a play test.
// Run with `bun run check` (in packages/shared). Exits non-zero on a failure.
//
// For every map in ROYALE_MAPS:
// 1. size 80..100 m a side; box heights and the thin-long rule; no narrow gaps;
// 2. at least 10 start spots; every start and crate spot standable and in bounds;
// 3. no two start spots see each other (any distance);
// 4. 15..25 crate spots, none near a start, none on top of each other;
// 5. everything reachable on foot, and the whole floor one connected region;
// 6. the final zone's rectangle well inside the map;
// 7. endgame cover: every final circle centre has cover and room to stand;
// 8. tall decor (trees) outside the walls, and hiding no floor from the camera.
//
// The geometry comes from scripts/analyze.ts (the duel validator's helpers).

import { ROYALE_MAPS, type RoyaleMapDef } from "../src/maps/royale/index.ts";
import { WALL_THICKNESS } from "../src/arena.ts";
import { TALL_DECOR, type Obstacle, type Spawn } from "../src/maps/types.ts";
import { ffaSight, OPEN_M2, TIGHT_M2, type FfaSight } from "./ffa/analyze.ts";
import { bodiesSee, boxGap, cellOf, cellPt, circleHitsBox, flood, gapFilled, hiddenFromCamera, MIN_GAP, MIN_THICKNESS, R, walkGrid } from "./analyze.ts";

/** Side of the map, metres. */
const SIZE: [number, number] = [80, 100];
const MIN_STARTS = 10;
const CRATE_COUNT: [number, number] = [15, 25];
/** A crate this close to a start spot would hand that player a free crate. */
const CRATE_START_MIN = 2;
const CRATE_CRATE_MIN = 1.5;
/** A spot must clear every box by this much on top of the player radius (like the duel validator's spawns). */
const SPOT_CLEAR = 0.25;
/** The final zone's rectangle keeps at least this far from every edge. */
const FINAL_MARGIN = 12;
/**
 * Radius of the final circle the endgame cover check assumes. Placeholder
 * until #32 (the royale mode) fixes the final circle's size.
 */
export const FINAL_CIRCLE_RADIUS = 7;
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
  const spotErrors = (kind: string, spots: readonly Spawn[]) => {
    const out: string[] = [];
    for (const s of spots) {
      if (Math.abs(s.x) > m.halfX - R - SPOT_CLEAR || Math.abs(s.z) > m.halfZ - R - SPOT_CLEAR) out.push(`${kind} ${at(s)} too close to the edge`);
      for (const o of m.obstacles) if (circleHitsBox(s.x, s.z, R + SPOT_CLEAR, o)) out.push(`${kind} ${at(s)} in or against ${name(o)}`);
    }
    return out;
  };
  check(m.spawns.length >= MIN_STARTS, `${m.spawns.length} start spots (at least ${MIN_STARTS})`);
  check(spotErrors("start", m.spawns).length === 0, "every start spot clear of boxes and in bounds", spotErrors("start", m.spawns));
  check(spotErrors("crate", m.crates).length === 0, "every crate spot clear of boxes and in bounds", spotErrors("crate", m.crates));

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
  check(m.crates.length >= CRATE_COUNT[0] && m.crates.length <= CRATE_COUNT[1], `${m.crates.length} crate spots (${CRATE_COUNT[0]}..${CRATE_COUNT[1]})`);
  const crateErrors: string[] = [];
  for (const c of m.crates)
    for (const s of m.spawns) if (Math.hypot(c.x - s.x, c.z - s.z) < CRATE_START_MIN) crateErrors.push(`crate ${at(c)} within ${CRATE_START_MIN} m of start ${at(s)}`);
  for (let i = 0; i < m.crates.length; i++)
    for (let j = i + 1; j < m.crates.length; j++)
      if (Math.hypot(m.crates[i].x - m.crates[j].x, m.crates[i].z - m.crates[j].z) < CRATE_CRATE_MIN)
        crateErrors.push(`crates ${at(m.crates[i])} and ${at(m.crates[j])} closer than ${CRATE_CRATE_MIN} m`);
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
  const unreached = [...m.spawns.map((s) => ["start", s] as const), ...m.crates.map((s) => ["crate", s] as const)]
    .filter(([, s]) => !reached[cellOf(g, s)])
    .map(([k, s]) => `${k} ${at(s)} not reachable from start 0`);
  check(unreached.length === 0, "every start and crate spot reachable on foot from start 0", unreached);
  check(lost === 0, `the whole floor is one connected region (${walkable} cells of ${CELL} m)`, lost ? [`${lost} cells cut off, first near (${f(lostAt.x)}, ${f(lostAt.z)})`] : []);

  // 6. Final zone rectangle.
  const z = m.finalZone;
  const margin = Math.min(z.x0 + m.halfX, m.halfX - z.x1, z.z0 + m.halfZ, m.halfZ - z.z1);
  check(z.x0 <= z.x1 && z.z0 <= z.z1 && margin >= FINAL_MARGIN - EPS, `final zone [${z.x0}, ${z.x1}] x [${z.z0}, ${z.z1}] at least ${FINAL_MARGIN} m from the edges (${f(margin)} m)`);

  // 7. Endgame cover: every final circle centre on a 1 m grid.
  const r = FINAL_CIRCLE_RADIUS;
  const rc = Math.ceil(r / g.cell);
  let worst = { x: 0, z: 0, boxes: Infinity, floor: Infinity, score: Infinity };
  const coverErrors: string[] = [];
  let centres = 0;
  for (let cz = Math.ceil(z.z0); cz <= z.z1 + EPS; cz++)
    for (let cx = Math.ceil(z.x0); cx <= z.x1 + EPS; cx++) {
      centres++;
      let boxes = 0;
      for (const o of m.obstacles) if (circleHitsBox(cx, cz, r, o)) boxes++;
      const c0 = cellOf(g, { x: cx, z: cz });
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
          if ((p.x - cx) ** 2 + (p.z - cz) ** 2 > r * r) continue;
          cells++;
          if (g.walk[j * g.nx + i]) open++;
        }
      const floor = cells ? open / cells : 0;
      // How close to failing: the tighter of the two measures, as a share of its limit.
      const score = Math.min(boxes / FINAL_MIN_BOXES, floor / FINAL_MIN_FLOOR);
      if (score < worst.score) worst = { x: cx, z: cz, boxes, floor, score };
      if (boxes < FINAL_MIN_BOXES || floor < FINAL_MIN_FLOOR) coverErrors.push(`circle at (${cx}, ${cz}): ${boxes} boxes, ${f(floor * 100, 0)} % floor`);
    }
  check(
    coverErrors.length === 0,
    `every final circle (r ${r} m, ${centres} centres) has ${FINAL_MIN_BOXES}+ boxes and ${FINAL_MIN_FLOOR * 100}%+ standable floor`,
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
        String(m.crates.length).padEnd(7),
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

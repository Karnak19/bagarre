// Tests of the battle royale maps' layout (this folder): the map rules the
// mode relies on, so a broken spot fails here and not in a play test.
// Run with `bun run test` (or `bun test src/maps/royale` in packages/shared).
//
// For every map in ROYALE_MAPS:
// 1. size 80..160 m a side; box heights and the thin-long rule; no narrow gaps;
// 2. at least 10 start spots; every start and crate spot standable and in bounds;
// 3. no two start spots see each other (any distance);
// 4. 15..60 crate spots, none within 3 m of a start, none on top of each other;
// 5. everything reachable on foot, and the whole floor one connected region;
// 6. the final zone's rectangle well inside the map;
// 7. endgame cover: the real zone 30 s before it closes, for every final
//    centre it may close on, has cover and room to stand in;
// 8. tall decor (trees) outside the walls, and hiding no floor from the camera.
//
// The geometry comes from scripts/analyze.ts (the duel validator's helpers).
// src/royale.test.ts checks the same maps against the mode's rules (crates
// clear of cover and 3 m from spawns, the zone's limits).

import { beforeAll, describe, expect, test } from "bun:test";
import { cellOf, cellPt, bodiesSee, boxGap, circleHitsBox, flood, gapFilled, hiddenFromCamera, MIN_GAP, MIN_THICKNESS, R, walkGrid, type Grid } from "../../../scripts/analyze.ts";
import { CELL, endgameCover, FINAL_MIN_BOXES, FINAL_MIN_FLOOR, LATE_SECONDS, lateRadius } from "../../../scripts/royale-maps.ts";
import { WALL_THICKNESS } from "../../arena.ts";
import { PLAYER_RADIUS, ROYALE } from "../../constants.ts";
import { TALL_DECOR, type Obstacle, type Spawn } from "../types.ts";
import { ROYALE_MAPS, type RoyaleMapDef } from "./index.ts";

/** Side of the map, metres. */
const SIZE: [number, number] = [80, 160];
const MIN_STARTS = 10;
const CRATE_COUNT: [number, number] = [15, 60];
/** A crate this close to a start spot would hand that player a free crate (royale.test.ts's rule too). */
const CRATE_START_MIN = 3;
/** A crate spot keeps its crate and a player touching it clear of every box (royale.test.ts's rule too). */
const CRATE_CLEAR = ROYALE.crateRadius + PLAYER_RADIUS;
const CRATE_CRATE_MIN = 1.5;
/** A spot must clear every box by this much on top of the player radius (like the duel validator's spawns). */
const SPOT_CLEAR = 0.25;
/** The final zone's rectangle keeps at least this far from every edge. */
const FINAL_MARGIN = 12;
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
/** The walk-grid tests take about a second on a laptop: room for a slow CI runner. */
const HEAVY_MS = 30_000;

const f = (n: number, d = 1) => n.toFixed(d);
const at = (p: Spawn) => `(${p.x}, ${p.z})`;
const name = (o: Obstacle) => `${o.kind}@(${o.x},${o.z})`;

/** Problems with the spots of one kind: out of bounds, or in or against a box. */
function spotErrors(m: RoyaleMapDef, kind: string, spots: readonly Spawn[], clear = R + SPOT_CLEAR): string[] {
  const out: string[] = [];
  for (const s of spots) {
    if (Math.abs(s.x) > m.halfX - clear || Math.abs(s.z) > m.halfZ - clear) out.push(`${kind} ${at(s)} too close to the edge`);
    for (const o of m.obstacles) if (circleHitsBox(s.x, s.z, clear, o)) out.push(`${kind} ${at(s)} in or against ${name(o)}`);
  }
  return out;
}

describe.each(ROYALE_MAPS.map((m) => [`${m.name} (${m.id})`, m] as const))("%s", (_title, m) => {
  // The walk grid and its flood fill from start 0, shared by the reachability, cover and decor tests.
  let g: Grid;
  let reached: Uint8Array;
  beforeAll(() => {
    g = walkGrid(m, CELL);
    reached = flood(g, cellOf(g, m.spawns[0]));
  }, HEAVY_MS);

  // 1. Size, boxes, gaps.
  const sx = 2 * m.halfX;
  const sz = 2 * m.halfZ;
  test(`size ${sx} x ${sz} m within ${SIZE[0]}..${SIZE[1]} m a side`, () => {
    for (const side of [sx, sz]) {
      expect(side).toBeGreaterThanOrEqual(SIZE[0]);
      expect(side).toBeLessThanOrEqual(SIZE[1]);
    }
  });
  test(`${m.obstacles.length} boxes in bounds, 0.8-2.0 m tall, long thin walls 1.1-1.4 m`, () => {
    const boxErrors: string[] = [];
    for (const o of m.obstacles) {
      if (o.x - o.w / 2 < -m.halfX - EPS || o.x + o.w / 2 > m.halfX + EPS || o.z - o.d / 2 < -m.halfZ - EPS || o.z + o.d / 2 > m.halfZ + EPS)
        boxErrors.push(`${name(o)} pokes out of the map`);
      if (Math.min(o.w, o.d) < MIN_THICKNESS - EPS) boxErrors.push(`${name(o)} thinner than ${MIN_THICKNESS} m`);
      if (o.h < 0.8 - EPS || o.h > 2.0 + EPS) boxErrors.push(`${name(o)} is ${o.h} m tall (0.8..2.0)`);
      if (Math.min(o.w, o.d) < 1.5 && Math.max(o.w, o.d) >= 4 - EPS && (o.h < 1.1 - EPS || o.h > 1.4 + EPS))
        boxErrors.push(`${name(o)} is a long thin wall ${o.h} m tall (1.1..1.4)`);
    }
    expect(boxErrors).toEqual([]);
  });
  test(`no gap under ${MIN_GAP} m between boxes or a box and the wall`, () => {
    const gapErrors: string[] = [];
    for (let i = 0; i < m.obstacles.length; i++)
      for (let j = i + 1; j < m.obstacles.length; j++) {
        const a = m.obstacles[i];
        const b = m.obstacles[j];
        const gap = boxGap(a, b);
        if (gap > EPS && gap < MIN_GAP - EPS && !gapFilled(m, a, b)) gapErrors.push(`gap ${f(gap, 2)} m between ${name(a)} and ${name(b)}`);
      }
    for (const o of m.obstacles)
      for (const gap of [m.halfX - (o.x + o.w / 2), o.x - o.w / 2 + m.halfX, m.halfZ - (o.z + o.d / 2), o.z - o.d / 2 + m.halfZ])
        if (gap > EPS && gap < MIN_GAP - EPS) gapErrors.push(`gap ${f(gap, 2)} m between ${name(o)} and the outer wall`);
    expect(gapErrors).toEqual([]);
  });

  // 2. Spots clear of boxes and in bounds.
  test(`${m.spawns.length} start spots (at least ${MIN_STARTS})`, () => {
    expect(m.spawns.length).toBeGreaterThanOrEqual(MIN_STARTS);
  });
  test("every start spot clear of boxes and in bounds", () => {
    expect(spotErrors(m, "start", m.spawns)).toEqual([]);
  });
  test(`every crate spot ${CRATE_CLEAR} m clear of boxes and in bounds`, () => {
    expect(spotErrors(m, "crate", m.royale.crates, CRATE_CLEAR)).toEqual([]);
  });

  // 3. Starts out of each other's sight.
  test("no two start spots see each other", () => {
    const seen: string[] = [];
    for (let i = 0; i < m.spawns.length; i++)
      for (let j = i + 1; j < m.spawns.length; j++) {
        const a = m.spawns[i];
        const b = m.spawns[j];
        if (bodiesSee(m, a, b)) seen.push(`starts ${i} ${at(a)} and ${j} ${at(b)} see each other (${f(Math.hypot(a.x - b.x, a.z - b.z))} m)`);
      }
    expect(seen).toEqual([]);
  });

  // 4. Crates.
  test(`${m.royale.crates.length} crate spots (${CRATE_COUNT[0]}..${CRATE_COUNT[1]})`, () => {
    expect(m.royale.crates.length).toBeGreaterThanOrEqual(CRATE_COUNT[0]);
    expect(m.royale.crates.length).toBeLessThanOrEqual(CRATE_COUNT[1]);
  });
  test(`crates at least ${CRATE_START_MIN} m from starts and ${CRATE_CRATE_MIN} m apart`, () => {
    const crates = m.royale.crates;
    const crateErrors: string[] = [];
    for (const c of crates)
      for (const s of m.spawns) if (Math.hypot(c.x - s.x, c.z - s.z) < CRATE_START_MIN) crateErrors.push(`crate ${at(c)} within ${CRATE_START_MIN} m of start ${at(s)}`);
    for (let i = 0; i < crates.length; i++)
      for (let j = i + 1; j < crates.length; j++)
        if (Math.hypot(crates[i].x - crates[j].x, crates[i].z - crates[j].z) < CRATE_CRATE_MIN)
          crateErrors.push(`crates ${at(crates[i])} and ${at(crates[j])} closer than ${CRATE_CRATE_MIN} m`);
    expect(crateErrors).toEqual([]);
  });

  // 5. Reachability: one connected floor, every spot on it.
  test("every start and crate spot reachable on foot from start 0", () => {
    const unreached = [...m.spawns.map((s) => ["start", s] as const), ...m.royale.crates.map((s) => ["crate", s] as const)]
      .filter(([, s]) => !reached[cellOf(g, s)])
      .map(([k, s]) => `${k} ${at(s)} not reachable from start 0`);
    expect(unreached).toEqual([]);
  });
  test(`the whole floor is one connected region (cells of ${CELL} m)`, () => {
    let lost = 0;
    let lostAt = { x: 0, z: 0 };
    for (let c = 0; c < g.walk.length; c++) {
      if (!g.walk[c] || reached[c]) continue;
      if (!lost) lostAt = cellPt(g, c);
      lost++;
    }
    expect(lost ? `${lost} cells cut off, first near (${f(lostAt.x)}, ${f(lostAt.z)})` : "").toBe("");
  });

  // 6. Final zone rectangle.
  const z = m.royale.zone;
  const margin = Math.min(z.x0 + m.halfX, m.halfX - z.x1, z.z0 + m.halfZ, m.halfZ - z.z1);
  test(`final zone [${z.x0}, ${z.x1}] x [${z.z0}, ${z.z1}] at least ${FINAL_MARGIN} m from the edges (${f(margin)} m)`, () => {
    expect(z.x0).toBeLessThanOrEqual(z.x1);
    expect(z.z0).toBeLessThanOrEqual(z.z1);
    expect(margin).toBeGreaterThanOrEqual(FINAL_MARGIN - EPS);
  });

  // 7. Endgame cover: every final centre on a 1 m grid, and the real zone
  // LATE_SECONDS before it closes on it.
  const r = lateRadius(m);
  const centres = (Math.floor(z.x1 + EPS) - Math.ceil(z.x0) + 1) * (Math.floor(z.z1 + EPS) - Math.ceil(z.z0) + 1);
  test(
    `the zone ${LATE_SECONDS} s before it closes (r ${f(r)} m), for all ${centres} final centres, has ${FINAL_MIN_BOXES}+ boxes and ${FINAL_MIN_FLOOR * 100}%+ standable floor`,
    () => {
      const circles = endgameCover(m, g);
      expect(circles).toHaveLength(centres);
      const coverErrors = circles
        .filter((c) => c.boxes < FINAL_MIN_BOXES || c.floor < FINAL_MIN_FLOOR)
        .map((c) => `final centre (${c.cx}, ${c.cz}), circle at (${f(c.late.x)}, ${f(c.late.z)}): ${c.boxes} boxes, ${f(c.floor * 100, 0)} % floor`);
      expect(coverErrors).toEqual([]);
    },
    HEAVY_MS,
  );

  // 8. Tall decor: outside the walls, and no floor hidden from the camera.
  // The camera looks down (-1, -1, -1) from the +x / +z side, so a tree just
  // outside the +x or +z wall stands between it and the floor near that wall.
  const tall = m.decor.filter((d) => (TALL_DECOR as readonly string[]).includes(d.prop));
  test(`${tall.length} tall decor props all outside the walls`, () => {
    const inside = tall
      .filter((d) => Math.abs(d.x) - columnOf(d.prop).r * (d.scale ?? 1) < m.halfX + WALL_THICKNESS && Math.abs(d.z) - columnOf(d.prop).r * (d.scale ?? 1) < m.halfZ + WALL_THICKNESS)
      .map((d) => `${d.prop} at (${d.x}, ${d.z}) touches the arena or its walls`);
    expect(inside).toEqual([]);
  });
  test(
    "tall decor hides no floor from the camera",
    () => {
      const columns = {
        ...m,
        obstacles: tall.map((d) => {
          const { r: cr, h } = columnOf(d.prop);
          const k = d.scale ?? 1;
          return { kind: "crate" as const, x: d.x, z: d.z, w: 2 * cr * k, d: 2 * cr * k, h: h * k };
        }),
      };
      const shaded: string[] = [];
      for (let c = 0; c < g.walk.length; c += 3) {
        if (!g.walk[c]) continue;
        const p = cellPt(g, c);
        // Any part of a player (from the feet up) hidden by a tree counts.
        if (hiddenFromCamera(columns, p.x, p.z, 0.05)) shaded.push(`floor at (${f(p.x)}, ${f(p.z)}) hidden from the camera by tall decor`);
      }
      expect(shaded).toEqual([]);
    },
    HEAVY_MS,
  );
});

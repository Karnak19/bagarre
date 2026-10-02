// Tests of the bots' navigation grid and A* (grid.ts, path.ts): cells blocked
// round inflated cover, a path on open floor, a path round a wall that never
// cuts an inflated corner, a blocked target, a walled-off target, a blocked
// start, and random paths on every royale map.
// Run with `bun run test` (or `bun test src/bots` in packages/shared).

import { describe, expect, test } from "bun:test";
import type { Arena } from "../arena.ts";
import { PLAYER_RADIUS } from "../constants.ts";
import { ROYALE_MAPS } from "../maps/index.ts";
import { circleOverlapsBox, type Vec2 } from "../physics.ts";
import { buildNavGrid, cellAt, cellCentre, cellFree, navGrid, segmentClear } from "./grid.ts";
import { findPath } from "./path.ts";
import { createRng, rngRange } from "./rng.ts";

const box = (x: number, z: number, w: number, d: number) => ({ x, z, w, d, h: 1 });

/** 20 x 20 m, a wall across x = 0 from the -z wall to z = 4: the way round is past its +z end. */
const walled: Arena = { halfX: 10, halfZ: 10, obstacles: [box(0, -3, 1, 14)] };
/** A 4 x 4 m room with no door round (6, 6). */
const closed: Arena = { halfX: 10, halfZ: 10, obstacles: [box(6, 4, 5, 0.6), box(6, 8, 5, 0.6), box(4, 6, 0.6, 5), box(8, 6, 0.6, 5)] };
const open: Arena = { halfX: 10, halfZ: 10, obstacles: [] };

/** Every leg of `from` -> points keeps the body clear of every box, and the path ends near `to`. */
function walkable(arena: Arena, from: Vec2, pts: readonly Vec2[]) {
  const grid = buildNavGrid("check", arena);
  let a = from;
  pts.forEach((b, i) => {
    // The first leg may start off-grid (pressed against a box): it only needs to reach a free cell.
    if (i > 0) expect(segmentClear(grid, a, b)).toBe(true);
    a = b;
  });
}

describe("the grid", () => {
  test("a free cell's centre keeps a body clear of every box and wall", () => {
    const grid = buildNavGrid("walled", walled);
    let free = 0;
    for (let c = 0; c < grid.blocked.length; c++) {
      if (!cellFree(grid, c)) continue;
      free++;
      const p = cellCentre(grid, c);
      for (const b of walled.obstacles) expect(circleOverlapsBox(p.x, p.z, PLAYER_RADIUS, b)).toBe(false);
      expect(Math.abs(p.x)).toBeLessThan(walled.halfX - PLAYER_RADIUS);
    }
    expect(free).toBeGreaterThan(grid.blocked.length / 2);
  });
  test("cells round a box are blocked out to the player radius", () => {
    const grid = buildNavGrid("walled", walled);
    expect(cellFree(grid, cellAt(grid, 0.6, -3))).toBe(false);
    expect(cellFree(grid, cellAt(grid, 1.6, -3))).toBe(true);
  });
  test("one grid per map, cached by id", () => {
    const m = ROYALE_MAPS[0];
    expect(navGrid(m)).toBe(navGrid(m));
  });
});

describe("findPath", () => {
  test("open floor: one straight leg to the goal", () => {
    const p = findPath(buildNavGrid("open", open), { x: -5, z: -5 }, { x: 5, z: 4 })!;
    expect(p.complete).toBe(true);
    expect(p.points).toEqual([{ x: 5, z: 4 }]);
  });

  test("round a wall: past its end, never through it or its inflated corner", () => {
    const from = { x: -4, z: -6 };
    const to = { x: 4, z: -6 };
    const p = findPath(buildNavGrid("walled", walled), from, to)!;
    expect(p.complete).toBe(true);
    expect(p.points.length).toBeGreaterThan(1);
    expect(p.points[p.points.length - 1]).toEqual(to);
    // The way round goes past the wall's +z end (z = 4) plus a body.
    expect(Math.max(...p.points.map((q) => q.z))).toBeGreaterThan(4 + PLAYER_RADIUS);
    walkable(walled, from, p.points);
  });

  test("a target inside cover: the nearest free spot instead", () => {
    const grid = buildNavGrid("walled", walled);
    const p = findPath(grid, { x: -4, z: -6 }, { x: 0, z: -6 })!;
    expect(p.complete).toBe(true);
    const end = p.points[p.points.length - 1];
    expect(cellFree(grid, cellAt(grid, end.x, end.z))).toBe(true);
    expect(Math.hypot(end.x - 0, end.z + 6)).toBeLessThan(1.5);
  });

  test("a walled-off target: not complete, but as close as the search got", () => {
    const p = findPath(buildNavGrid("closed", closed), { x: -6, z: -6 }, { x: 6, z: 6 })!;
    expect(p.complete).toBe(false);
    const end = p.points[p.points.length - 1];
    expect(Math.hypot(end.x - 6, end.z - 6)).toBeLessThan(4);
  });

  test("a start pressed against cover snaps to the nearest free cell", () => {
    const from = { x: -0.5 - PLAYER_RADIUS, z: -6 };
    const p = findPath(buildNavGrid("walled", walled), from, { x: -6, z: -6 })!;
    expect(p.complete).toBe(true);
    walkable(walled, from, p.points);
  });

  for (const map of ROYALE_MAPS) {
    test(`${map.id}: random paths between free points are complete and clear`, () => {
      const grid = navGrid(map);
      const rng = createRng(42);
      const freePoint = (): Vec2 => {
        for (;;) {
          const x = rngRange(rng, -map.halfX, map.halfX);
          const z = rngRange(rng, -map.halfZ, map.halfZ);
          if (cellFree(grid, cellAt(grid, x, z))) return cellCentre(grid, cellAt(grid, x, z));
        }
      };
      for (let k = 0; k < 40; k++) {
        const a = freePoint();
        const b = freePoint();
        const p = findPath(grid, a, b)!;
        expect(p.complete).toBe(true);
        walkable(map, a, p.points);
        expect(p.points[p.points.length - 1]).toEqual(b);
      }
    });
  }
});

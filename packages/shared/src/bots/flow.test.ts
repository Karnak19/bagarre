// Tests of the zone's flow field (flow.ts): zero in the target circle,
// growing away from it, the way round a wall, one cached field per zone
// target, and on every royale map a body walking down the field (the real
// `walk`) gets into the circle from every start spot.
// Run with `bun run test` (or `bun test src/bots` in packages/shared).

import { describe, expect, test } from "bun:test";
import type { Arena } from "../arena.ts";
import { ROYALE_MAPS } from "../maps/index.ts";
import { walk, type Vec2 } from "../physics.ts";
import type { ZoneView } from "../protocol.ts";
import { flowDirection, flowDistance, flowField, buildFlowField, zoneFlowTarget } from "./flow.ts";
import { buildNavGrid, navGrid, type NavGrid } from "./grid.ts";

const box = (x: number, z: number, w: number, d: number) => ({ x, z, w, d, h: 1 });
/** A wall across x = 0 from the -z wall to z = 4. */
const walled: Arena = { halfX: 10, halfZ: 10, obstacles: [box(0, -3, 1, 14)] };

/** Walks down the field from `from` for at most `steps` ticks; returns where it ends and the highest z it reached. */
function follow(grid: NavGrid, field: Float64Array, from: Vec2, inside: (p: Vec2) => boolean, steps: number) {
  let p = from;
  let maxZ = p.z;
  for (let i = 0; i < steps && !inside(p); i++) {
    const d = flowDirection(grid, field, p);
    if (!d) break;
    p = walk(grid.arena, p, { mx: d.x, mz: d.z });
    maxZ = Math.max(maxZ, p.z);
  }
  return { p, maxZ };
}

describe("the flow field", () => {
  const grid = buildNavGrid("walled", walled);
  const target = { x: 5, z: -6, r: 1 };
  const field = buildFlowField(grid, target);

  test("zero in the target, growing with the walk away from it", () => {
    expect(flowDistance(grid, field, { x: 5, z: -6 })).toBe(0);
    const near = flowDistance(grid, field, { x: 5, z: 0 });
    const far = flowDistance(grid, field, { x: -5, z: -6 });
    expect(near).toBeGreaterThan(0);
    // Across the wall the walk goes round its end: much more than the 10 m straight line.
    expect(far).toBeGreaterThan(18);
  });

  test("following it goes round the wall and into the target", () => {
    const inside = (p: Vec2) => Math.hypot(p.x - target.x, p.z - target.z) <= 2;
    const r = follow(grid, field, { x: -5, z: -6 }, inside, 30 * 20);
    expect(inside(r.p)).toBe(true);
    expect(r.maxZ).toBeGreaterThan(4);
  });

  test("no direction inside the target", () => {
    expect(flowDirection(grid, field, { x: 5, z: -6 })).toBeNull();
  });

  test("cached per zone target: the same one twice, a new one when the target moves", () => {
    const g = navGrid(ROYALE_MAPS[0]);
    const zone: ZoneView = { x0: 0, z0: 0, x1: 10, z1: -5, r0: 60, r1: 0, start: 100, end: 1000 };
    const a = flowField(g, zoneFlowTarget(zone)!);
    expect(flowField(g, zoneFlowTarget({ ...zone })!)).toBe(a);
    expect(flowField(g, zoneFlowTarget({ ...zone, x1: -10 })!)).not.toBe(a);
    expect(zoneFlowTarget({ ...zone, end: 0 })).toBeNull();
  });
});

for (const map of ROYALE_MAPS) {
  test(`${map.id}: down the field into the final circle from every start spot`, () => {
    const grid = navGrid(map);
    const lim = map.royale.zone;
    for (const [tx, tz] of [
      [lim.x0, lim.z0],
      [lim.x1, lim.z1],
      [(lim.x0 + lim.x1) / 2, (lim.z0 + lim.z1) / 2],
    ]) {
      const target = { x: tx, z: tz, r: 3 };
      const field = flowField(grid, target);
      const inside = (p: Vec2) => Math.hypot(p.x - tx, p.z - tz) <= 3.5;
      for (const s of map.spawns) {
        // 60 s is more than any walk across a 90 m map needs.
        expect(inside(follow(grid, field, s, inside, 30 * 60).p)).toBe(true);
      }
    }
  });
}

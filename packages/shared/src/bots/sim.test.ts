// Whole bots in a small royale world (harness.ts: the rule brain, the
// control layer and the real `stepPlayer`, on the real maps): on every royale
// map, from every start spot, a bot never stays stuck for more than ~3 s; a
// bot outside the zone gets in; and the same seed gives the same inputs.
// Run with `bun run test` (or `bun test src/bots` in packages/shared).

import { describe, expect, test } from "bun:test";
import { TICK_RATE } from "../constants.ts";
import { ROYALE_MAPS } from "../maps/index.ts";
import type { InputMessage, ZoneView } from "../protocol.ts";
import { outsideZone } from "../royale.ts";
import { createBotSim, stepBotSim } from "./harness.ts";

/** A window this long in which the bot never gets STILL_DIST from where it was at its start counts as stuck. */
const STUCK_WINDOW = 3 * TICK_RATE;
const STILL_DIST = 1;

for (const map of ROYALE_MAPS) {
  describe(map.id, () => {
    test("a bot alone never stays stuck for 3 s, from every start spot (25 s each)", () => {
      for (let s = 0; s < map.spawns.length; s++) {
        const sim = createBotSim({ map, count: 1, seed: 100 + s, starts: [map.spawns[s]] });
        const xs: number[] = [];
        const zs: number[] = [];
        const p = sim.world.players.get("bot:0")!;
        for (let t = 0; t < 25 * TICK_RATE; t++) {
          stepBotSim(sim);
          xs.push(p.x);
          zs.push(p.z);
          // Stuck: every position of the last STUCK_WINDOW ticks within STILL_DIST of the first one.
          const k = xs.length - 1 - STUCK_WINDOW;
          if (k >= 0) {
            let far = 0;
            for (let j = k + 1; j < xs.length; j++) far = Math.max(far, Math.hypot(xs[j] - xs[k], zs[j] - zs[k]));
            if (far < STILL_DIST) throw new Error(`stuck on ${map.id} from spawn ${s} round tick ${t}: (${p.x.toFixed(2)}, ${p.z.toFixed(2)}), goal ${JSON.stringify(sim.bots[0].goal)}`);
          }
        }
        // It looted something on the way.
        expect([...sim.world.crates.values()].some((c) => c.open)).toBe(true);
      }
    });

    test("a bot outside the zone gets in, from every start spot", () => {
      const lim = map.royale.zone;
      const cx = lim.x1;
      const cz = lim.z1;
      // A small circle in a corner of the final zone's rectangle, barely shrinking.
      const zone: ZoneView = { x0: cx, z0: cz, x1: cx, z1: cz, r0: 8, r1: 7.9, start: 0, end: 1_000_000 };
      for (let s = 0; s < map.spawns.length; s++) {
        const sim = createBotSim({ map, count: 1, seed: 7 + s, starts: [map.spawns[s]], zone });
        const p = sim.world.players.get("bot:0")!;
        let inAt = -1;
        for (let t = 0; t < 40 * TICK_RATE && inAt < 0; t++) {
          stepBotSim(sim);
          if (!outsideZone(zone, sim.world.tick, p.x, p.z)) inAt = t;
        }
        expect(inAt).toBeGreaterThanOrEqual(0);
        expect(p.alive).toBe(true);
      }
    });
  });
}

describe("determinism", () => {
  const run = (seed: number): InputMessage[][] => {
    const sim = createBotSim({ map: ROYALE_MAPS[0], count: 4, seed });
    const out: InputMessage[][] = [];
    for (let t = 0; t < 600; t++) out.push(stepBotSim(sim));
    return out;
  };
  test("the same seed gives the same inputs, tick for tick", () => {
    expect(run(1234)).toEqual(run(1234));
  });
  test("another seed plays differently", () => {
    expect(run(1234)).not.toEqual(run(4321));
  });
});

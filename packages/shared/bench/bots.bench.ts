// CPU benchmark of the bots (#48): 9 bots on Ironvale, every tick their view,
// the rule brain (once a second per bot, staggered), the control layer (A*
// replans included) and the real `stepPlayer`, in the bots' harness world
// (src/bots/harness.ts: chests, floor items, the zone; no bullets). A manual
// tool like physics.bench.ts: run it before and after a bot change.
//
//   bun run bench                          # the physics bench, then this one
//   bun bench/bots.bench.ts --ticks 9000 --bots 9 --json
//
// Everything is seeded: the printed checksum only depends on the code.

import { TICK_MS, TICK_RATE } from "../src/constants.ts";
import { createBotSim, stepBotSim, type SimTiming } from "../src/bots/harness.ts";
import { buildNavGrid } from "../src/bots/grid.ts";
import { buildFlowField } from "../src/bots/flow.ts";
import { findMap } from "../src/maps/index.ts";
import type { ZoneView } from "../src/protocol.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const TICKS = Number(arg("ticks") ?? 5400);
const WARMUP = Number(arg("warmup") ?? 150);
const BOTS = Number(arg("bots") ?? 9);
const MAP_ID = arg("map") ?? "ironvale";
const SEED = 0xb075;
const JSON_OUT = process.argv.includes("--json");

const SECTIONS = ["view", "brain", "control", "step", "total"] as const;
type Section = (typeof SECTIONS)[number];

function stats(samples: Float64Array) {
  const s = Float64Array.from(samples).sort();
  const pct = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  let sum = 0;
  for (const v of s) sum += v;
  const mean = sum / s.length;
  return { mean, p50: pct(0.5), p99: pct(0.99), max: s[s.length - 1], budgetPct: (mean / TICK_MS) * 100 };
}

const map = findMap(MAP_ID);
if (!map) throw new Error(`unknown map "${MAP_ID}"`);

// One-off costs, paid once per map and once per zone.
let t = performance.now();
const grid = buildNavGrid(map.id, map);
const gridMs = performance.now() - t;
t = performance.now();
buildFlowField(grid, { x: 10, z: -10, r: 0 });
const flowMs = performance.now() - t;

// A real zone: it waits 10 s, then closes over the run on a seeded corner, so bots escape it, loot and fight.
const lim = map.royale?.zone ?? { x0: 0, z0: 0, x1: 0, z1: 0 };
const r0 = Math.hypot(map.halfX, map.halfZ) + 2;
const zone: ZoneView = { x0: 0, z0: 0, x1: lim.x1 * 0.7, z1: lim.z0 * 0.7, r0, r1: 6, start: 10 * TICK_RATE, end: WARMUP + TICKS };
const sim = createBotSim({ map, count: BOTS, seed: SEED, zone });

const times: Record<Section, Float64Array> = {
  view: new Float64Array(TICKS),
  brain: new Float64Array(TICKS),
  control: new Float64Array(TICKS),
  step: new Float64Array(TICKS),
  total: new Float64Array(TICKS),
};
const timing: SimTiming = { now: () => performance.now(), view: 0, brain: 0, control: 0, step: 0, replans: 0 };
let replans = 0;
let h = 0x811c9dc5;
for (let tick = 0; tick < WARMUP + TICKS; tick++) {
  timing.view = timing.brain = timing.control = timing.step = 0;
  timing.replans = 0;
  const t0 = performance.now();
  const inputs = stepBotSim(sim, timing);
  const t1 = performance.now();
  for (const i of inputs) h = Math.imul(h ^ ((i.mx * 1000) | 0) ^ ((i.mz * 1000) | 0) ^ (i.fire ? 1 : 0), 0x01000193) >>> 0;
  if (tick < WARMUP) continue;
  const m = tick - WARMUP;
  times.view[m] = timing.view;
  times.brain[m] = timing.brain;
  times.control[m] = timing.control;
  times.step[m] = timing.step;
  times.total[m] = t1 - t0;
  replans += timing.replans;
}

const alive = [...sim.world.players.values()].filter((p) => p.alive).length;
const opened = [...sim.world.crates.values()].filter((c) => c.open).length;
const result = {
  map: map.id,
  bots: BOTS,
  ticks: TICKS,
  warmup: WARMUP,
  gridMs,
  flowMs,
  sections: Object.fromEntries(SECTIONS.map((s) => [s, stats(times[s])])) as Record<Section, ReturnType<typeof stats>>,
  replansPerSecond: (replans / TICKS) * TICK_RATE,
  alive,
  chestsOpened: opened,
  checksum: h.toString(16).padStart(8, "0"),
};

if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
else {
  const f = (n: number) => n.toFixed(3).padStart(8);
  console.log(`\n=== bots on ${result.map}: ${BOTS} bots, ${TICKS} ticks (+${WARMUP} warmup), budget ${TICK_MS.toFixed(1)} ms ===`);
  console.log(`one-off: nav grid ${gridMs.toFixed(2)} ms, one flow field ${flowMs.toFixed(2)} ms`);
  console.log(`section       mean ms   p50 ms   p99 ms   max ms  budget`);
  for (const s of SECTIONS) {
    const x = result.sections[s];
    console.log(`${s.padEnd(10)} ${f(x.mean)} ${f(x.p50)} ${f(x.p99)} ${f(x.max)}  ${x.budgetPct.toFixed(2).padStart(5)}%`);
  }
  console.log(`replans/s (all bots)       ${result.replansPerSecond.toFixed(1)}   chests opened ${opened}/${sim.world.crates.size}   alive ${alive}/${BOTS}`);
  console.log(`checksum                   ${result.checksum}`);
}

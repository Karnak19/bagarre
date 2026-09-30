// CPU benchmark of the shared simulation's hot path: one server tick of
// player steps and bullets, plus the client's reconcile replay and line of
// sight checks, on a full 10-player map. A manual tool (not in CI, not in the
// tests): run it before and after a physics change and compare the timings.
//
//   bun run bench                      # ironvale, then crossroads
//   bun run bench --map ironvale       # one map
//   bun run bench --ticks 5000 --warmup 500 --json
//
// Everything is seeded (mulberry32, no Math.random, no clock in the sim), so
// the printed checksum only depends on the code under test. A change that must
// not change behaviour (e.g. a spatial grid over the obstacles) has to print
// the exact same checksum.
//
// What it simulates, per tick (like GameRoom.tick, minus the Colyseus parts):
// - movement: every player's input through the real `stepPlayer` (loadout
//   mode, armed), and `shotPellets` for each shot it fires;
// - bullets: every live bullet through `stepBullet`, with an onSubstep that
//   tests every other player's pose from HIT_REWIND_TICKS ago with
//   `circlesOverlap`, like GameRoom.stepBullets. A hit removes the bullet and
//   counts; nobody takes damage or dies (the sim has no HP loss here);
// - reconcile: one player's last RECONCILE_PENDING inputs replayed through
//   `stepPlayer` from its sim of that many ticks ago, like
//   prediction.ts' reconcile() on every snapshot;
// - LOS: LOS_PER_TICK `lineOfSight` calls between random pairs of players.

import { circlesOverlap, lineOfSight, stepBullet, type BulletSim } from "../src/physics.ts";
import { bulletLifeTicks, shotPellets, stepPlayer, spawnSim, weaponDef, type Can } from "../src/combat.ts";
import {
  BULLET_RADIUS,
  DASH_SPEED,
  HIT_REWIND_TICKS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  TICK_DT,
  TICK_MS,
  WEAPONS,
} from "../src/constants.ts";
import { findMap, type MapDef } from "../src/maps/index.ts";
import type { InputMessage, PlayerSim } from "../src/protocol.ts";

// --- Options -----------------------------------------------------------------

const PLAYERS = 10;
const RECONCILE_PENDING = 6;
const LOS_PER_TICK = 20;
const SEED = 0xbadc0de;
/**
 * Copy of movePlayer's MOVE_SUBSTEP in physics.ts, which does not export it and the
 * benchmark must not change. Only feeds the obstacleTestsPerTick upper bound; it never
 * affects the simulation or the checksum. Keep in sync by hand.
 */
const MOVE_SUBSTEP = 0.25;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const TICKS = Number(arg("ticks") ?? 3000);
const WARMUP = Number(arg("warmup") ?? 300);
const JSON_OUT = process.argv.includes("--json");
const MAP_IDS = arg("map") ? [arg("map")!] : ["ironvale", "crossroads"];

/** The gun mix, one per player: the real weapon table, by key. */
const LOADOUT = ["shotgun", "smg", "rifle", "sniper", "shotgun", "smg", "rifle", "dmr", "burst-pistol", "revolver"].map((key) => {
  const i = WEAPONS.findIndex((w) => w.key === key);
  if (i < 0) throw new Error(`no weapon ${key}`);
  return i;
});

// --- Seeded RNG --------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Checksum (FNV-1a over the float bits) ------------------------------------

const scratch = new DataView(new ArrayBuffer(8));
function hashNum(h: number, v: number): number {
  scratch.setFloat64(0, v);
  for (let i = 0; i < 8; i++) h = Math.imul(h ^ scratch.getUint8(i), 0x01000193);
  return h >>> 0;
}

// --- Stats -------------------------------------------------------------------

const SECTIONS = ["movement", "bullets", "reconcile", "los", "total"] as const;
type Section = (typeof SECTIONS)[number];

interface SectionStats {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Mean as a share of the 33.3 ms tick budget, percent. */
  budgetPct: number;
}

function stats(samples: Float64Array): SectionStats {
  const s = Float64Array.from(samples).sort();
  const pct = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  let sum = 0;
  for (const v of s) sum += v;
  const mean = sum / s.length;
  return { mean, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: s[s.length - 1], budgetPct: (mean / TICK_MS) * 100 };
}

interface Result {
  map: string;
  obstacles: number;
  players: number;
  ticks: number;
  warmup: number;
  sections: Record<Section, SectionStats>;
  counts: {
    bulletsAlive: number;
    bulletsFiredPerTick: number;
    bulletSubstepsPerTick: number;
    playerCircleTestsPerTick: number;
    moveSubstepsPerTick: number;
    reconcileMoveSubstepsPerTick: number;
    losCallsPerTick: number;
    /** Upper bounds: bulletBlocked and lineOfSight stop at the first box they hit. */
    obstacleTestsPerTick: { movement: number; bullets: number; reconcile: number; los: number; total: number };
    hits: number;
  };
  checksum: string;
}

// --- The scenario ------------------------------------------------------------

interface Bullet extends BulletSim {
  ticksLeft: number;
  owner: number;
}

/** Movement sub-steps movePlayer takes for this step (same formula as physics.ts). */
function moveSubsteps(input: InputMessage, dashing: boolean): number {
  let len: number;
  if (dashing) len = DASH_SPEED * TICK_DT;
  else {
    const m = Math.min(1, Math.hypot(input.mx, input.mz));
    len = m * PLAYER_SPEED * TICK_DT;
  }
  return Math.max(1, Math.ceil(len / MOVE_SUBSTEP));
}

function run(map: MapDef): Result {
  const rng = mulberry32(SEED);
  const can: Can = { act: true, armed: true };
  const nObs = map.obstacles.length;
  const total = WARMUP + TICKS;

  // Players on distinct spawns (a seeded shuffle of the map's spawns).
  const spawnOrder = map.spawns.map((_, i) => i);
  for (let i = spawnOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [spawnOrder[i], spawnOrder[j]] = [spawnOrder[j], spawnOrder[i]];
  }
  const sims: PlayerSim[] = [];
  for (let i = 0; i < PLAYERS; i++) {
    const sp = map.spawns[spawnOrder[i % spawnOrder.length]];
    sims.push(spawnSim(sp.x, sp.z, LOADOUT[i]));
  }

  // Per-player input state: a heading that changes every so often (drifting
  // towards the nearest player so fights happen), dash presses now and then.
  const heading = new Float64Array(PLAYERS);
  const headingLeft = new Int32Array(PLAYERS);
  const dashCount = new Int32Array(PLAYERS);
  const idle = new Uint8Array(PLAYERS);
  // Input objects are preallocated in a ring (reconcile replays old ones).
  const RING = RECONCILE_PENDING + 1;
  const inputs: InputMessage[][] = [];
  for (let r = 0; r < RING; r++) {
    const row: InputMessage[] = [];
    for (let i = 0; i < PLAYERS; i++) row.push({ seq: 0, mx: 0, mz: 0, aim: 0, fire: true, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0 });
    inputs.push(row);
  }
  // Player 0's sim before each of its inputs, and whether that input dashed, for the reconcile replay.
  const p0Before: PlayerSim[] = [];
  const p0Dashed = new Uint8Array(RING);

  // Lag-compensation poses: ring of HIT_REWIND_TICKS + 1 frames.
  const POSE_RING = HIT_REWIND_TICKS + 1;
  const poseX = new Float64Array(POSE_RING * PLAYERS);
  const poseZ = new Float64Array(POSE_RING * PLAYERS);
  let pastBase = 0;
  let poseValid = 0;

  const bullets: Bullet[] = [];
  let hits = 0;
  let losVisible = 0;

  const losA = new Int32Array(LOS_PER_TICK);
  const losB = new Int32Array(LOS_PER_TICK);

  // The onSubstep hit test, built once. It reads the bullet being stepped
  // from `curOwner` and the rewound poses from `pastBase`.
  let curOwner = 0;
  let circleTests = 0;
  let substepCalls = 0;
  let lastHit = false;
  const onSubstep = (bx: number, bz: number): boolean => {
    substepCalls++;
    if (poseValid < POSE_RING) return false; // no past pose yet, like a fresh join
    for (let t = 0; t < PLAYERS; t++) {
      if (t === curOwner) continue;
      circleTests++;
      if (circlesOverlap(bx, bz, BULLET_RADIUS, poseX[pastBase + t], poseZ[pastBase + t], PLAYER_RADIUS)) {
        lastHit = true;
        return true;
      }
    }
    return false;
  };

  const times: Record<Section, Float64Array> = {
    movement: new Float64Array(TICKS),
    bullets: new Float64Array(TICKS),
    reconcile: new Float64Array(TICKS),
    los: new Float64Array(TICKS),
    total: new Float64Array(TICKS),
  };
  let sumAlive = 0;
  let sumFired = 0;
  let sumBulletSubsteps = 0;
  let sumCircleTests = 0;
  let sumMoveSub = 0;
  let sumReconcileSub = 0;
  const fired = new Uint8Array(PLAYERS);
  const dashed = new Uint8Array(PLAYERS);

  for (let tick = 0; tick < total; tick++) {
    const measured = tick >= WARMUP;
    const m = tick - WARMUP;
    const row = inputs[tick % RING];

    // --- Inputs (untimed) ---
    for (let i = 0; i < PLAYERS; i++) {
      const me = sims[i];
      let best = -1;
      let bestD = Infinity;
      for (let j = 0; j < PLAYERS; j++) {
        if (j === i) continue;
        const d = (sims[j].x - me.x) ** 2 + (sims[j].z - me.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      const tx = sims[best].x;
      const tz = sims[best].z;
      const toTarget = Math.atan2(tz - me.z, tx - me.x);
      if (--headingLeft[i] <= 0) {
        heading[i] = toTarget + (rng() - 0.5) * Math.PI * 1.5;
        headingLeft[i] = 15 + Math.floor(rng() * 45);
        idle[i] = rng() < 0.1 ? 1 : 0;
      }
      if (rng() < 1 / 45) dashCount[i]++;
      const inp = row[i];
      inp.seq = tick + 1;
      inp.mx = idle[i] ? 0 : Math.cos(heading[i]);
      inp.mz = idle[i] ? 0 : Math.sin(heading[i]);
      inp.aim = toTarget + (rng() - 0.5) * 0.2;
      inp.fire = true;
      inp.gx = tx;
      inp.gz = tz;
      inp.dash = dashCount[i];
    }
    for (let k = 0; k < LOS_PER_TICK; k++) {
      const a = Math.floor(rng() * PLAYERS);
      losA[k] = a;
      losB[k] = (a + 1 + Math.floor(rng() * (PLAYERS - 1))) % PLAYERS;
    }
    p0Before[tick % RING] = sims[0];

    const t0 = performance.now();

    // --- Movement: stepPlayer + the shots it fires ---
    for (let i = 0; i < PLAYERS; i++) {
      const res = stepPlayer(map, sims[i], row[i], LOADOUT[i], can);
      sims[i] = res.sim;
      fired[i] = res.fired ? 1 : 0;
      dashed[i] = res.dashing ? 1 : 0;
      if (res.fired) {
        const life = bulletLifeTicks(weaponDef(LOADOUT[i]));
        for (const b of shotPellets(LOADOUT[i], res.sim.x, res.sim.z, row[i].aim, row[i].seq)) {
          (b as Bullet).ticksLeft = life;
          (b as Bullet).owner = i;
          bullets.push(b as Bullet);
        }
      }
    }

    const t1 = performance.now();

    // Record this tick's poses (GameRoom.recordHistory), then look back.
    // Bookkeeping, between the timed sections.
    const base = (tick % POSE_RING) * PLAYERS;
    for (let i = 0; i < PLAYERS; i++) {
      poseX[base + i] = sims[i].x;
      poseZ[base + i] = sims[i].z;
    }
    poseValid = Math.min(POSE_RING, poseValid + 1);
    pastBase = ((tick - HIT_REWIND_TICKS + POSE_RING * 4) % POSE_RING) * PLAYERS;
    const aliveBefore = bullets.length;
    circleTests = 0;
    substepCalls = 0;
    let blockedStops = 0;

    const t2 = performance.now();

    // --- Bullets: stepBullet + hit tests on rewound poses, stable removal ---
    let w = 0;
    for (let k = 0; k < bullets.length; k++) {
      const b = bullets[k];
      curOwner = b.owner;
      lastHit = false;
      const alive = stepBullet(map, b, onSubstep);
      if (!alive) {
        if (lastHit) hits++;
        else blockedStops++;
      }
      b.ticksLeft--;
      if (alive && b.ticksLeft > 0) bullets[w++] = b;
    }
    bullets.length = w;

    const t3 = performance.now();

    // --- Reconcile: replay player 0's pending inputs from its older sim ---
    // From the sim before input tick-5, inputs tick-5..tick: it must land
    // exactly on this tick's sims[0] (checked below, untimed).
    const pending = tick >= RECONCILE_PENDING - 1 ? RECONCILE_PENDING : 0;
    let rs = pending ? p0Before[(tick - (RECONCILE_PENDING - 1)) % RING] : sims[0];
    for (let k = pending - 1; k >= 0; k--) {
      rs = stepPlayer(map, rs, inputs[(tick - k) % RING][0], LOADOUT[0], can).sim;
    }

    const t4 = performance.now();

    // --- Line of sight between random pairs ---
    let vis = 0;
    for (let k = 0; k < LOS_PER_TICK; k++) {
      if (lineOfSight(map, sims[losA[k]], sims[losB[k]])) vis++;
    }

    const t5 = performance.now();

    p0Dashed[tick % RING] = dashed[0];
    if (rs.x !== sims[0].x || rs.z !== sims[0].z) throw new Error(`reconcile replay diverged at tick ${tick}`);
    losVisible += vis;

    if (measured) {
      times.movement[m] = t1 - t0;
      times.bullets[m] = t3 - t2;
      times.reconcile[m] = t4 - t3;
      times.los[m] = t5 - t4;
      times.total[m] = t1 - t0 + (t5 - t2);
      sumAlive += aliveBefore;
      let firedNow = 0;
      for (let i = 0; i < PLAYERS; i++) {
        if (fired[i]) firedNow += weaponDef(LOADOUT[i]).pellets;
        sumMoveSub += moveSubsteps(row[i], dashed[i] === 1);
      }
      sumFired += firedNow;
      sumBulletSubsteps += substepCalls + blockedStops;
      sumCircleTests += circleTests;
      // The replay takes the same steps as the live run did.
      for (let k = 0; k < pending; k++) sumReconcileSub += moveSubsteps(inputs[(tick - k) % RING][0], p0Dashed[(tick - k) % RING] === 1);
    }
  }

  // --- Checksum ---
  let h = 0x811c9dc5;
  for (const s of sims) {
    h = hashNum(h, s.x);
    h = hashNum(h, s.z);
  }
  h = hashNum(h, bullets.length);
  for (const b of bullets) {
    h = hashNum(h, b.x);
    h = hashNum(h, b.z);
  }
  h = hashNum(h, hits);
  h = hashNum(h, losVisible);

  const perTick = (v: number) => v / TICKS;
  const moveSub = perTick(sumMoveSub);
  const recSub = perTick(sumReconcileSub);
  const bulletSub = perTick(sumBulletSubsteps);
  const obst = {
    movement: moveSub * 2 * nObs,
    bullets: bulletSub * nObs,
    reconcile: recSub * 2 * nObs,
    los: LOS_PER_TICK * nObs,
    total: 0,
  };
  obst.total = obst.movement + obst.bullets + obst.reconcile + obst.los;

  const sections = {} as Record<Section, SectionStats>;
  for (const s of SECTIONS) sections[s] = stats(times[s]);

  return {
    map: map.id,
    obstacles: nObs,
    players: PLAYERS,
    ticks: TICKS,
    warmup: WARMUP,
    sections,
    counts: {
      bulletsAlive: perTick(sumAlive),
      bulletsFiredPerTick: perTick(sumFired),
      bulletSubstepsPerTick: bulletSub,
      playerCircleTestsPerTick: perTick(sumCircleTests),
      moveSubstepsPerTick: moveSub,
      reconcileMoveSubstepsPerTick: recSub,
      losCallsPerTick: LOS_PER_TICK,
      obstacleTestsPerTick: obst,
      hits,
    },
    checksum: h.toString(16).padStart(8, "0"),
  };
}

// --- Output --------------------------------------------------------------------

function fmt(n: number, d = 3): string {
  return n.toFixed(d).padStart(8);
}

function print(r: Result) {
  const c = r.counts;
  const o = c.obstacleTestsPerTick;
  const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
  console.log(`\n=== ${r.map}: ${r.obstacles} obstacles, ${r.players} players, ${r.ticks} ticks (+${r.warmup} warmup) ===`);
  console.log(`section       mean ms   p50 ms   p95 ms   p99 ms   max ms  budget`);
  for (const s of SECTIONS) {
    const x = r.sections[s];
    console.log(`${s.padEnd(10)} ${fmt(x.mean)} ${fmt(x.p50)} ${fmt(x.p95)} ${fmt(x.p99)} ${fmt(x.max)}  ${x.budgetPct.toFixed(2).padStart(5)}%`);
  }
  console.log(`bullets alive (avg)        ${c.bulletsAlive.toFixed(1)}   fired/tick ${c.bulletsFiredPerTick.toFixed(2)}   hits ${c.hits}`);
  console.log(`bullet substeps/tick       ${c.bulletSubstepsPerTick.toFixed(1)}   player circle tests/tick ${c.playerCircleTestsPerTick.toFixed(1)}`);
  console.log(`move substeps/tick         ${c.moveSubstepsPerTick.toFixed(1)}   reconcile ${c.reconcileMoveSubstepsPerTick.toFixed(1)}   LOS calls ${c.losCallsPerTick}`);
  console.log(`obstacle tests/tick (max)  total ${k(o.total)} = movement ${k(o.movement)} + bullets ${k(o.bullets)} + reconcile ${k(o.reconcile)} + LOS ${k(o.los)}`);
  console.log(`checksum                   ${r.checksum}`);
}

const results: Result[] = [];
for (const id of MAP_IDS) {
  const map = findMap(id);
  if (!map) throw new Error(`unknown map "${id}"`);
  results.push(run(map));
}
if (JSON_OUT) console.log(JSON.stringify(results, null, 2));
else {
  console.log(`bun ${process.versions.bun}, tick budget ${TICK_MS.toFixed(1)} ms, seed 0x${SEED.toString(16)}`);
  results.forEach(print);
}

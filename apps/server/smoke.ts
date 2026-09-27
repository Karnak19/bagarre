// Headless smoke test: boots the real server, connects SDK clients and checks
// the game loop end to end. Run with `bun run smoke` (from the repo root).
//
// Part 1 is the original duel (join, move, predict, shoot, kill, leave,
// rejoin) plus dash and weapon-pick checks. Part 2 runs several extra rooms in
// parallel, one per scenario: each weapon's fire rate / damage / spread, the
// grenade, and the shield. Part 3 (smoke-accounts.ts, run alongside part 2)
// covers guest names, Clerk token checks and match stats in Convex. Part 4
// covers game pages (private rooms, the open games list, joins by id, room
// metadata, guest names) and part 5 the scoreboard counters and ping. Part 6
// covers reconnection (a dropped client keeps its seat for a grace period),
// malformed messages and the message rate limit, and part 7 a SIGTERM on a
// server running in a child process. Part 8 (smoke-ffa.ts) is the free for
// all: countdown, drop-in, kill credit, the end conditions, seats,
// reconnection and the recorded placements.

import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { matchMaker } from "@colyseus/core";
import { Client, CloseCode, type Room } from "@colyseus/sdk";
import {
  BULLET_RADIUS,
  DASH,
  DASH_COOLDOWN_TICKS,
  DASH_TICKS,
  GRENADE,
  INPUT_BURST,
  KILLS_TO_WIN,
  MATCH_END_DELAY,
  MAX_HP,
  MSG_INPUT,
  MSG_PICK,
  MSG_PING,
  MSG_PONG,
  MAX_MESSAGES_PER_SECOND,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  GAMES_ROUTE,
  ROOM_NAME,
  SHIELD,
  TICK_DT,
  TICK_MS,
  TICK_RATE,
  MAPS,
  WEAPONS,
  bodiesSee,
  circleOverlapsBox,
  grenadeDamage,
  grenadeTarget,
  mapById,
  muzzle,
  readSim,
  respawnPoint,
  shotPellets,
  spawnSim,
  stepBullet,
  stepPlayer,
  ticks,
  type Arena,
  type InputMessage,
  type MapDef,
  type OpenGame,
  type PlayerSim,
  type PlayerView,
  type RoomStateView,
  type Vec2,
} from "@bagarre/shared";
import { createServer, openGames } from "./src/app.ts";
import { DuelRoom } from "./src/GameRoom.ts";
import { accountChecks, liveConvexChecks, setupTestAccounts } from "./smoke-accounts.ts";
import { ffaChecks, registerFfaRooms } from "./smoke-ffa.ts";

const PORT = 2599;
const URL = `http://localhost:${PORT}`;
const failures: string[] = [];
/** The main server pins every room to Yard: the duel checks depend on its geometry. */
const YARD = mapById("yard");

function check(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures.push(label);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await sleep(20);
  }
  return cond();
}

const state = (room: Room) => room.state as unknown as RoomStateView;
const me = (room: Room): PlayerView | undefined => state(room)?.players?.get(room.sessionId);
const other = (room: Room): PlayerView | undefined => {
  let out: PlayerView | undefined;
  state(room).players.forEach((p, id) => {
    if (id !== room.sessionId) out = p;
  });
  return out;
};

type Ability = "dash" | "grenade" | "shield" | "reload";
type Controls = Pick<InputMessage, "mx" | "mz" | "aim" | "fire" | "gx" | "gz">;

/**
 * Sends one input per tick, like the real client does, and predicts its own
 * state with the shared step function so we can compare with the server.
 * `spam` > 1 sends that many inputs per tick instead (a cheating client).
 */
function driver(room: Room, map: MapDef = YARD) {
  let seq = 0;
  let current: Controls = { mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0 };
  const presses = { dash: 0, grenade: 0, shield: 0, reload: 0 };
  let sim: PlayerSim = readSim(me(room)!);
  let target: Vec2 | null = null;
  let arrived: (() => void) | null = null;
  let fireOnce = false;
  const history = new Map<number, PlayerSim>();
  const sent = new Map<number, InputMessage>();

  const d = {
    history,
    sent,
    spam: 1,
    get seq() {
      return seq;
    },
    get sim() {
      return sim;
    },
    set(next: Partial<Controls>) {
      current = { ...current, ...next };
    },
    press(kind: Ability) {
      presses[kind]++;
    },
    fireOnce() {
      fireOnce = true;
    },
    /** Walks in a straight line to (x, z), landing on it exactly. */
    goTo(x: number, z: number, timeoutMs = 8000): Promise<boolean> {
      target = { x, z };
      return Promise.race([
        new Promise<boolean>((r) => (arrived = () => r(true))),
        sleep(timeoutMs).then(() => false),
      ]);
    },
    stop() {
      clearInterval(timer);
    },
  };

  const tick = () => {
    const p = me(room);
    if (!p) return;
    for (let k = 0; k < d.spam; k++) {
      let { mx, mz } = current;
      if (target) {
        const dx = target.x - sim.x;
        const dz = target.z - sim.z;
        const dist = Math.hypot(dx, dz);
        const f = dist > 1e-12 ? Math.min(1, dist / (PLAYER_SPEED * TICK_DT)) / dist : 0;
        mx = dx * f;
        mz = dz * f;
      }
      const input: InputMessage = { seq: ++seq, ...current, mx, mz, ...presses };
      if (fireOnce) {
        input.fire = true;
        fireOnce = false;
      }
      sim = stepPlayer(map, sim, input, p.weapon, p.alive && state(room).phase !== "ended").sim;
      history.set(seq, sim);
      sent.set(seq, input);
      room.send(MSG_INPUT, input);
      if (target && Math.hypot(target.x - sim.x, target.z - sim.z) < 1e-6) {
        target = null;
        arrived?.();
        arrived = null;
      }
    }
  };
  // One input right away, before any press: a fresh seat takes the first
  // input's counters as its baseline (DuelRoom.applyInput), like a real
  // client's first input after joining.
  tick();
  const timer = setInterval(tick, TICK_MS);
  return d;
}
type Driver = ReturnType<typeof driver>;

/** Waits until the server has applied everything this driver sent. */
const caughtUp = (room: Room, d: Driver, ms = 1500) => {
  const upTo = d.seq; // not the live value: the driver keeps sending
  return waitFor(() => (me(room)?.lastSeq ?? 0) >= upTo, ms);
};

/** Records every bullet of `slot` the room sees: per shot seq, the tick it appeared and each pellet's first position. */
function watchShots(room: Room, slot: number) {
  const shots = new Map<number, { tick: number; pellets: Map<number, Vec2> }>();
  const cb = (raw: unknown) => {
    const s = raw as RoomStateView;
    s.bullets.forEach((b, id) => {
      const [sl, sq, pi] = id.split(":").map(Number);
      if (sl !== slot) return;
      let shot = shots.get(sq);
      if (!shot) {
        shot = { tick: s.tick, pellets: new Map() };
        shots.set(sq, shot);
      }
      if (!shot.pellets.has(pi)) shot.pellets.set(pi, { x: b.x, z: b.z });
    });
  };
  room.onStateChange(cb);
  return { shots, stop: () => room.onStateChange.remove(cb) };
}

/** Records HP drops of the player `id` as seen by `room` (only drops that don't kill). */
function watchHpDrops(room: Room, id: string) {
  const drops: number[] = [];
  let prev = state(room).players.get(id)?.hp ?? MAX_HP;
  const cb = (raw: unknown) => {
    const hp = (raw as RoomStateView).players.get(id)?.hp ?? prev;
    if (hp < prev && hp > 0) drops.push(prev - hp);
    prev = hp;
  };
  room.onStateChange(cb);
  return { drops, stop: () => room.onStateChange.remove(cb) };
}

/** A fresh private duel room. `pick` is player 1's weapon, chosen while waiting. */
async function duel(label: string, pick: number | null) {
  const r1 = await new Client(URL).create(ROOM_NAME);
  if (pick !== null) {
    r1.send(MSG_PICK, { weapon: pick });
    await waitFor(() => me(r1)?.pick === pick, 1000);
    r1.send(MSG_PICK, { weapon: 99 }); // invalid, must be ignored
    await sleep(100);
  }
  const r2 = await new Client(URL).joinById(r1.roomId);
  const started = await waitFor(() => state(r1).phase === "playing" && !!me(r1) && !!me(r2), 3000);
  if (!started) throw new Error(`${label}: match did not start`);
  return { r1, r2, d1: driver(r1), d2: driver(r2) };
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

// ---------------------------------------------------------------------------
// Pure checks on the shared code (no server involved).
// ---------------------------------------------------------------------------
function pureChecks() {
  // Dash into cover stops at the wall instead of tunnelling through it.
  // Obstacle at x=7 is 1 m thick (6.5..7.5); a player touches it at x=6.0.
  let s = spawnSim(5.9, 4, 0);
  const base: InputMessage = { seq: 1, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 1, grenade: 0, shield: 0, reload: 0 };
  let maxX = s.x;
  for (let i = 0; i < DASH_TICKS + 2; i++) {
    s = stepPlayer(YARD, s, { ...base, seq: i + 1 }, 0, true).sim;
    maxX = Math.max(maxX, s.x);
  }
  check(Math.abs(maxX - (6.5 - PLAYER_RADIUS)) < 1e-9, `dash into cover stops at the wall (x max ${maxX.toFixed(4)})`);

  const a = shotPellets(1, 0, 0, 0.3, 1234);
  const b = shotPellets(1, 0, 0, 0.3, 1234);
  const c = shotPellets(1, 0, 0, 0.3, 1235);
  const dirs = a.map((p) => Math.atan2(p.vz, p.vx));
  check(
    JSON.stringify(a) === JSON.stringify(b) &&
      JSON.stringify(a) !== JSON.stringify(c) &&
      new Set(dirs.map((x) => x.toFixed(6))).size === WEAPONS[1].pellets,
    "shotgun pellets: same seq gives identical pellets, another seq a different pattern",
  );
}

// ---------------------------------------------------------------------------
// Part 1: the original duel, plus dash and weapon pick.
// ---------------------------------------------------------------------------
async function mainDuel() {
  const c1 = new Client(URL);
  const c2 = new Client(URL);
  const r1 = await c1.joinOrCreate(ROOM_NAME);
  const r2 = await c2.joinOrCreate(ROOM_NAME);
  check(r1.roomId === r2.roomId, `both clients joined the same room (${r1.roomId})`);

  const started = await waitFor(() => state(r1).phase === "playing" && !!me(r1) && !!me(r2), 3000);
  check(started, "match switches to 'playing' with two players");

  // The loop must really run at TICK_RATE, or inputs pile up server-side.
  const tick0 = state(r1).tick;
  const wall0 = performance.now();
  await sleep(1000);
  const rate = (state(r1).tick - tick0) / ((performance.now() - wall0) / 1000);
  check(Math.abs(rate - TICK_RATE) < 2, `server ticks at ~${TICK_RATE} Hz (measured ${rate.toFixed(1)})`);

  const d1 = driver(r1);
  const d2 = driver(r2);

  // Player 2 dashes into the arena wall first: it stops at the wall.
  d2.set({ aim: 0 });
  d2.press("dash");
  await sleep(400);
  const wallX = YARD.halfX - PLAYER_RADIUS;
  check(Math.abs(me(r2)!.x - wallX) < 1e-9, `dash stops at the arena wall (x=${me(r2)!.x.toFixed(3)})`);

  // Player 1 walks right for one second.
  const start1 = { x: me(r1)!.x, z: me(r1)!.z };
  d1.set({ mx: 1, mz: 0 });
  // Player 2 walks down to the z = -12 row, a clear firing lane.
  d2.set({ mx: 0, mz: -1 });
  await sleep(1000);
  d1.set({ mx: 0 });
  const moved = await waitFor(() => Math.abs(me(r1)!.x - start1.x) > 3, 1000);
  const p1 = me(r1)!;
  check(moved, `player 1 moved after input (x ${start1.x.toFixed(2)} -> ${p1.x.toFixed(2)})`);
  check(p1.lastSeq > 0, `server acknowledges inputs (lastSeq=${p1.lastSeq})`);
  const predictedAtAck = d1.history.get(p1.lastSeq);
  check(
    !!predictedAtAck && predictedAtAck.x === p1.x && predictedAtAck.z === p1.z,
    `client-side prediction matches the server exactly at seq ${p1.lastSeq}`,
  );

  // Dash: standing still, facing +X.
  await caughtUp(r1, d1);
  const x0 = me(r1)!.x;
  d1.press("dash");
  await waitFor(() => me(r1)!.dashCd > 0 && me(r1)!.dashTicks === 0, 1000);
  await caughtUp(r1, d1);
  const x1 = me(r1)!.x;
  const walked = PLAYER_SPEED * DASH_TICKS * TICK_DT;
  check(
    Math.abs(x1 - x0 - DASH.distance) < 1e-9 && x1 - x0 > walked * 2,
    `dash covers ${(x1 - x0).toFixed(3)} m in ${DASH_TICKS} ticks (walking: ${walked.toFixed(2)} m)`,
  );
  const afterDash = me(r1)!;
  const predDash = d1.history.get(afterDash.lastSeq);
  check(
    !!predDash &&
      predDash.x === afterDash.x &&
      predDash.z === afterDash.z &&
      predDash.dashCd === afterDash.dashCd &&
      predDash.dashTicks === afterDash.dashTicks,
    `prediction matches the server exactly after a dash (seq ${afterDash.lastSeq}, cooldown ${afterDash.dashCd})`,
  );
  // A second press within the cooldown is received but does nothing.
  d1.press("dash");
  await sleep(300);
  await caughtUp(r1, d1);
  check(
    me(r1)!.x === x1 && me(r1)!.dashSeen === 2 && me(r1)!.dashCd > 0 && me(r1)!.dashCd < DASH_COOLDOWN_TICKS,
    `second dash within cooldown does nothing (x stays ${me(r1)!.x.toFixed(3)}, press seen=${me(r1)!.dashSeen}, ${me(r1)!.dashCd} ticks of cooldown left)`,
  );

  await waitFor(() => me(r2)!.z < -11.9, 5000);
  d2.set({ mz: 0 });
  await sleep(200);

  // Weapon pick is refused while alive during a match.
  r1.send(MSG_PICK, { weapon: 1 });
  await sleep(200);
  check(me(r1)!.pick === 0 && me(r1)!.weapon === 0, "weapon pick is refused while alive mid-match");

  // Player 1 aims at player 2 and holds fire.
  const target = state(r1).players.get(r2.sessionId)!;
  const hpBefore = target.hp;
  check(hpBefore === MAX_HP, `player 2 starts at full HP (${hpBefore})`);
  const shooter = me(r1)!;
  const aim = Math.atan2(target.z - shooter.z, target.x - shooter.x);
  d1.set({ aim, fire: true });
  const sawBullet = await waitFor(() => {
    let n = 0;
    state(r2).bullets.forEach(() => n++);
    return n > 0;
  }, 1000);
  check(sawBullet, "bullets are replicated to the other client");
  const hurt = await waitFor(() => (state(r2).players.get(r2.sessionId)?.hp ?? MAX_HP) < hpBefore, 3000);
  check(hurt, `player 2 HP dropped after being shot (hp=${me(r2)?.hp})`);

  const killed = await waitFor(() => me(r1)!.kills >= 1, 4000);
  check(killed, `player 1 scores a kill (kills=${me(r1)!.kills})`);
  d1.set({ fire: false });

  // Dead player 2 picks the sniper: accepted, but only in hand after respawn.
  r2.send(MSG_PICK, { weapon: 2 });
  await waitFor(() => me(r2)!.pick === 2, 1000);
  check(!me(r2)!.alive && me(r2)!.pick === 2 && me(r2)!.weapon === 0, "weapon pick accepted while dead, not applied yet");
  await waitFor(() => me(r2)!.alive, 3000);
  check(
    me(r2)!.alive && me(r2)!.weapon === 2 && me(r2)!.ammo === WEAPONS[2].magazine,
    `weapon pick applies on respawn (weapon=${me(r2)!.weapon}, ammo=${me(r2)!.ammo})`,
  );
  // The respawn follows the shared rule: out of the killer's sight first, then farthest.
  {
    const killer = me(r1)!;
    const back = me(r2)!;
    const want = respawnPoint(YARD, YARD.spawns, killer, YARD.spawns[back.slot]);
    check(
      Math.abs(back.x - want.x) < 1e-9 && Math.abs(back.z - want.z) < 1e-9,
      `respawn at (${back.x}, ${back.z}), the spawn the rule picks (${want.x}, ${want.z}; ${bodiesSee(YARD, want, killer) ? "in" : "out of"} the killer's sight)`,
    );
  }

  d1.stop();
  d2.stop();

  // Leaving puts the remaining player back into waiting.
  await r2.leave();
  const waiting = await waitFor(() => state(r1).phase === "waiting", 2000);
  check(waiting, "remaining player goes back to 'waiting' when the opponent leaves");

  // The freed seat can be taken again, and the match restarts.
  const c3 = new Client(URL);
  const r3 = await c3.joinOrCreate(ROOM_NAME);
  check(r3.roomId === r1.roomId, "a new client fills the freed seat in the same room");
  const restarted = await waitFor(() => state(r1).phase === "playing", 2000);
  check(restarted && me(r1)!.kills === 0, "match restarts with scores reset");
  await r3.leave();
  await r1.leave();
}

// ---------------------------------------------------------------------------
// Part 2a: one room per weapon.
// ---------------------------------------------------------------------------
async function weaponDuel(wid: number) {
  const w = WEAPONS[wid];
  const tag = `[${w.name}]`;
  const { r1, r2, d1, d2 } = await duel(tag, wid);
  const lines: [boolean, string][] = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  try {
    ok(me(r1)!.weapon === wid && me(r1)!.ammo === w.magazine, `picked while waiting, in hand at match start (invalid id ignored)`);

    // Shooter at (4, -12), target 4 m away at (8, -12): every weapon's ideal range or closer.
    const [a1, a2] = await Promise.all([d1.goTo(4, -12), d2.goTo(12, -12).then(() => d2.goTo(8, -12))]);
    if (!a1 || !a2) throw new Error(`${tag} players did not reach their spots`);
    await Promise.all([caughtUp(r1, d1), caughtUp(r2, d2)]);

    const slot = me(r1)!.slot;
    const hp = watchHpDrops(r2, r2.sessionId);

    // Phase A: a well-behaved client holding the trigger.
    const a = watchShots(r1, slot);
    d1.set({ aim: 0, fire: true });
    await sleep(5200);
    d1.set({ fire: false });
    await sleep(200);
    a.stop();
    hp.stop();

    const seqs = [...a.shots.keys()].sort((x, y) => x - y);
    const interval = ticks(w.fireInterval);
    const reload = ticks(w.reloadTime);
    const gaps = seqs.slice(1).map((s, i) => s - seqs[i]);
    ok(
      seqs.length >= 2 && Math.min(...gaps) === interval,
      `fire interval: ${seqs.length} shots, closest two ${Math.min(...gaps)} ticks apart (interval ${interval})`,
    );
    const reloadGaps = gaps.filter((_, i) => (i + 1) % w.magazine === 0);
    ok(
      reloadGaps.every((g) => g >= reload),
      `magazine of ${w.magazine} then reload: gaps after each magazine [${reloadGaps.join(", ")}] >= ${reload} ticks`,
    );
    ok(
      hp.drops.length > 0 && hp.drops.every((dmg) => dmg % w.damage === 0),
      `damage per hit is ${w.damage}: HP drops [${hp.drops.join(", ")}]`,
    );

    // Spread: the pellets the server spawned go exactly where the shared
    // function (what the shooter's client runs) says, for every shot.
    let worst = 0;
    let matched = 0;
    for (const sq of seqs) {
      const at = d1.history.get(sq)!;
      const input = d1.sent.get(sq)!;
      const predicted = shotPellets(wid, at.x, at.z, input.aim, sq);
      for (const [i, pos] of a.shots.get(sq)!.pellets) {
        const p = predicted[i];
        const serverDir = Math.atan2(pos.z - p.z, pos.x - p.x);
        worst = Math.max(worst, angleDiff(serverDir, Math.atan2(p.vz, p.vx)));
        matched++;
      }
    }
    ok(
      matched === seqs.length * w.pellets && worst < 1e-4,
      `server pellets match client-side shotPellets (${matched} pellets, worst ${worst.toExponential(1)} rad)`,
    );

    // Phase B: a cheating client sending 4 inputs per tick with fire held.
    await sleep(ticks(w.reloadTime) * TICK_MS + 100); // let a pending reload finish
    const b = watchShots(r1, slot);
    d1.spam = 4;
    d1.set({ fire: true });
    await sleep(2000);
    d1.set({ fire: false });
    d1.spam = 1;
    await sleep(700);
    b.stop();
    const bTicks = [...b.shots.values()].map((s) => s.tick).sort((x, y) => x - y);
    const span = bTicks[bTicks.length - 1] - bTicks[0];
    ok(
      bTicks.length >= 2 && (bTicks.length - 1) * interval <= span + INPUT_BURST,
      `spamming 4 inputs/tick: ${bTicks.length} shots over ${span} server ticks (cap ${Math.floor((span + INPUT_BURST) / interval) + 1})`,
    );
  } finally {
    d1.stop();
    d2.stop();
    await r2.leave();
    await r1.leave();
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Part 2b: grenade blast, range clamp, cooldown vs spam.
// ---------------------------------------------------------------------------
async function grenadeDuel() {
  const tag = "[grenade]";
  const { r1, r2, d1, d2 } = await duel(tag, null);
  const lines: [boolean, string][] = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  try {
    const [a1, a2] = await Promise.all([d1.goTo(0, -12), d2.goTo(12, -12).then(() => d2.goTo(6, -12))]);
    if (!a1 || !a2) throw new Error(`${tag} players did not reach their spots`);
    await Promise.all([caughtUp(r1, d1), caughtUp(r2, d2)]);

    const seen = new Map<string, { owner: string; tx: number; tz: number; exploded: boolean }>();
    const cb = (raw: unknown) =>
      (raw as RoomStateView).grenades.forEach((g, id) => {
        const prev = seen.get(id);
        seen.set(id, { owner: g.owner, tx: g.tx, tz: g.tz, exploded: (prev?.exploded ?? false) || g.exploded });
      });
    r1.onStateChange(cb);

    // P1 lobs one next to P2 (1 m away), then keeps hammering Q for a second.
    d1.set({ gx: 6, gz: -11 });
    d1.press("grenade");
    // P2 throws one absurdly far towards +Z: it must be pulled back to max range.
    d2.set({ gx: 6, gz: 1000 });
    d2.press("grenade");
    for (let i = 0; i < 30; i++) {
      await sleep(TICK_MS);
      d1.press("grenade");
    }
    const exploded = await waitFor(() => [...seen.values()].some((g) => g.owner === r1.sessionId && g.exploded), 3000);
    await sleep(150);
    r1.onStateChange.remove(cb);

    const mine = [...seen.values()].filter((g) => g.owner === r1.sessionId);
    const theirs = [...seen.values()].filter((g) => g.owner === r2.sessionId);
    const edge = Math.hypot(6 - 6, -11 - -12) - PLAYER_RADIUS;
    const expected = MAX_HP - grenadeDamage(edge, false)!;
    ok(exploded, "grenade lands and explodes");
    ok(me(r2)!.hp === expected, `player in radius takes blast damage (hp ${me(r2)!.hp}, expected ${expected})`);
    ok(me(r1)!.hp === MAX_HP, `player outside the radius is untouched (thrower 6 m away, hp ${me(r1)!.hp})`);
    ok(
      mine.length === 1 && me(r1)!.grenadeSeen > 10,
      `spamming Q during the cooldown gives no extra grenade (${mine.length} thrown, ${me(r1)!.grenadeSeen} presses seen)`,
    );
    const far = theirs[0];
    const reach = far ? Math.hypot(far.tx - 6, far.tz - -12) : -1;
    ok(!!far && Math.abs(reach - GRENADE.range) < 1e-3 && Math.abs(far.tx - 6) < 1e-3, `far target clamped to max range (${reach.toFixed(3)} m)`);
  } finally {
    d1.stop();
    d2.stop();
    await r2.leave();
    await r1.leave();
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Part 2c: self-damage, and the shield soaking a sniper shot.
// ---------------------------------------------------------------------------
async function shieldDuel() {
  const tag = "[shield]";
  const { r1, r2, d1, d2 } = await duel(tag, 2);
  const lines: [boolean, string][] = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  try {
    // P1 drops a grenade at its own feet while P2 walks into the firing lane.
    const walk = d2.goTo(12, -12);
    d1.set({ gx: me(r1)!.x, gz: me(r1)!.z });
    d1.press("grenade");
    await waitFor(() => me(r1)!.hp < MAX_HP, 3000);
    await sleep(100);
    const selfExpected = MAX_HP - grenadeDamage(0, true)!;
    ok(me(r1)!.hp === selfExpected, `own grenade hurts at the reduced rate (hp ${me(r1)!.hp}, expected ${selfExpected})`);

    if (!(await walk)) throw new Error(`${tag} player 2 did not reach its spot`);
    await caughtUp(r2, d2);
    d2.press("shield");
    await waitFor(() => other(r1)?.shieldHp === SHIELD.absorb, 1500);
    const shieldUp = other(r1)?.shieldHp === SHIELD.absorb && (other(r1)?.shieldTicks ?? 0) > 0;
    ok(shieldUp, "shield comes up and is visible to the other client");

    const p1 = me(r1)!;
    const p2 = other(r1)!;
    d1.set({ aim: Math.atan2(p2.z - p1.z, p2.x - p1.x) });
    await sleep(2 * TICK_MS);
    d1.fireOnce();
    await waitFor(() => (other(r1)?.shieldHp ?? SHIELD.absorb) < SHIELD.absorb, 2000);
    await sleep(100);
    const sniper = WEAPONS[2].damage;
    const hpExpected = MAX_HP - (sniper - SHIELD.absorb);
    ok(
      other(r1)!.shieldHp === 0 && other(r1)!.hp === hpExpected,
      `shield absorbs ${SHIELD.absorb} of a ${sniper} hit before HP (hp ${other(r1)!.hp}, expected ${hpExpected})`,
    );
  } finally {
    d1.stop();
    d2.stop();
    await r2.leave();
    await r1.leave();
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Part 4: maps. Collision and bullets follow the room's map, the map is synced,
// a random room changes map between matches, the dev `?map=` option.
// ---------------------------------------------------------------------------

/**
 * A known wall per map: from the last `path` point, walking +x stops against
 * the wall's -x face at `faceX`. The path is walkable in straight lines from
 * spawn 0.
 */
const WALL_CASES: { map: string; path: Vec2[]; faceX: number; what: string }[] = [
  { map: "runway", path: [{ x: -17.5, z: -11.5 }], faceX: -14, what: "bay sandbags" },
  { map: "trenchworks", path: [{ x: -12.5, z: -5 }], faceX: -7, what: "Long Trench" },
  { map: "fort", path: [{ x: -12, z: -2.5 }], faceX: -6, what: "fort west wall" },
];

const idle: InputMessage = { seq: 0, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0 };

/** Walks +x for `n` ticks on `arena` from `start`, returns the final x. */
function walkRight(arena: Arena, start: Vec2, n = 60): number {
  let s = spawnSim(start.x, start.z, 0);
  for (let i = 1; i <= n; i++) s = stepPlayer(arena, s, { ...idle, seq: i, mx: 1 }, 0, true).sim;
  return s.x;
}

/** A rifle bullet fired +x from a player at `from`: where it dies, or null if still flying after 1 s. */
function bulletEnd(arena: Arena, from: Vec2): number | null {
  const m = muzzle(from.x, from.z, 0);
  const b = { x: m.x, z: m.z, vx: WEAPONS[0].bulletSpeed, vz: 0 };
  for (let i = 0; i < TICK_RATE; i++) if (!stepBullet(arena, b)) return b.x;
  return null;
}

function pureMapChecks() {
  for (const c of WALL_CASES) {
    const map = mapById(c.map);
    const start = c.path[c.path.length - 1];
    const x = walkRight(map, start);
    const onYard = walkRight(YARD, start);
    check(
      Math.abs(x - (c.faceX - PLAYER_RADIUS)) < 1e-9 && Math.abs(onYard - x) > 0.1,
      `[maps] ${c.map}: walking into the ${c.what} stops at its face (x ${x.toFixed(4)}; the same walk on Yard ends at ${onYard.toFixed(2)})`,
    );
    const end = bulletEnd(map, { x: c.faceX - 3, z: start.z });
    check(
      end !== null && end >= c.faceX - BULLET_RADIUS && end < c.faceX + 0.3,
      `[maps] ${c.map}: a bullet fired into the ${c.what} dies at it (x ${end?.toFixed(3)}, face ${c.faceX})`,
    );
  }

  // Grenades clamp to the map's own rectangle.
  const runway = mapById("runway");
  const g = grenadeTarget(runway, 19, 13, 25, 20);
  check(
    Math.abs(g.x - (runway.halfX - BULLET_RADIUS)) < 1e-9 && Math.abs(g.z - (runway.halfZ - BULLET_RADIUS)) < 1e-9,
    `[maps] grenade target clamps to Runway's 40 x 28 floor (${g.x.toFixed(2)}, ${g.z.toFixed(2)})`,
  );

  // Respawn: wherever the opponent stands, if the farthest spawn is in their
  // sight but another one isn't, the hidden one wins (the farthest of those).
  let cases = 0;
  let bad = 0;
  for (const map of MAPS) {
    for (let x = -map.halfX + 1; x <= map.halfX - 1; x += 1)
      for (let z = -map.halfZ + 1; z <= map.halfZ - 1; z += 1) {
        const o = { x, z };
        if (map.obstacles.some((b) => circleOverlapsBox(x, z, PLAYER_RADIUS, b))) continue;
        const d2 = (s: Vec2) => (s.x - o.x) ** 2 + (s.z - o.z) ** 2;
        const farthest = [...map.spawns].sort((a, b) => d2(b) - d2(a))[0];
        const hidden = map.spawns.filter((s) => !bodiesSee(map, s, o));
        if (!bodiesSee(map, farthest, o) || hidden.length === 0) continue;
        cases++;
        const got = respawnPoint(map, map.spawns, o, map.spawns[0]);
        const best = Math.max(...hidden.map(d2));
        if (bodiesSee(map, got, o) || d2(got) !== best) bad++;
      }
  }
  check(
    cases > 0 && bad === 0,
    `[maps] respawn with the opponent in view of the farthest spawn picks a hidden one (${cases} positions over ${MAPS.length} maps, ${bad} wrong)`,
  );
}

const onSpawn = (p: PlayerView | undefined, map: MapDef) =>
  !!p && Math.abs(p.x - map.spawns[p.slot].x) < 1e-9 && Math.abs(p.z - map.spawns[p.slot].z) < 1e-9;

/** Records, per bullet id of `slot`, the largest x it was seen at and whether it is still there. */
function watchBulletsX(room: Room, slot: number) {
  const maxX = new Map<string, number>();
  const live = new Set<string>();
  const cb = (raw: unknown) => {
    live.clear();
    (raw as RoomStateView).bullets.forEach((b, id) => {
      if (Number(id.split(":")[0]) !== slot) return;
      live.add(id);
      maxX.set(id, Math.max(maxX.get(id) ?? -Infinity, b.x));
    });
  };
  room.onStateChange(cb);
  return { maxX, live, stop: () => room.onStateChange.remove(cb) };
}

/** A room pinned to one map: synced mapId, spawns, wall collision, prediction, a bullet into the wall. */
async function mapDuel(c: (typeof WALL_CASES)[number]) {
  const map = mapById(c.map);
  const tag = `[map ${c.map}]`;
  const r1 = await new Client(URL).create(`duel_${c.map}`);
  const r2 = await new Client(URL).joinById(r1.roomId);
  const lines: [boolean, string][] = [];
  const ok = (cond: boolean, l: string) => lines.push([cond, `${tag} ${l}`]);
  const started = await waitFor(() => state(r1).phase === "playing" && !!me(r1) && !!me(r2), 3000);
  if (!started) throw new Error(`${tag} match did not start`);
  const d1 = driver(r1, map);
  const d2 = driver(r2, map);
  try {
    ok(state(r1).mapId === c.map && state(r2).mapId === c.map, `mapId "${c.map}" synced to both clients`);
    ok(onSpawn(me(r1), map) && onSpawn(me(r2), map), "both players start on the map's own spawns");

    for (const p of c.path) if (!(await d1.goTo(p.x, p.z))) throw new Error(`${tag} did not reach (${p.x}, ${p.z})`);
    d1.set({ mx: 1, mz: 0 });
    await sleep(1500);
    d1.set({ mx: 0 });
    await caughtUp(r1, d1);
    const p = me(r1)!;
    ok(Math.abs(p.x - (c.faceX - PLAYER_RADIUS)) < 1e-9, `walking into the ${c.what} stops at its face on the server (x ${p.x.toFixed(4)})`);
    const pred = d1.history.get(p.lastSeq);
    ok(
      !!pred && JSON.stringify(pred) === JSON.stringify(readSim(p)),
      `client-side prediction matches the server exactly on ${map.name} (seq ${p.lastSeq}, x ${pred?.x})`,
    );

    // Back off 3 m and fire one rifle bullet into the wall.
    const from = { x: c.faceX - 3, z: p.z };
    if (!(await d1.goTo(from.x, from.z))) throw new Error(`${tag} did not back off`);
    await caughtUp(r1, d1);
    const w = watchBulletsX(r1, p.slot);
    d1.set({ aim: 0 });
    await sleep(2 * TICK_MS);
    d1.fireOnce();
    await sleep(700);
    w.stop();
    const xs = [...w.maxX.values()];
    ok(
      xs.length === 1 && w.live.size === 0 && xs[0] < c.faceX && xs[0] > from.x,
      `a bullet fired into the ${c.what} dies there (seen up to x ${xs[0]?.toFixed(2)}, face ${c.faceX}, ${w.live.size} still flying)`,
    );
  } finally {
    d1.stop();
    d2.stop();
    await r2.leave();
    await r1.leave();
  }
  return lines;
}

const localRoom = (roomId: string) => matchMaker.getLocalRoomById(roomId) as unknown as DuelRoom;

/**
 * An unpinned room: every match start after the first moves to another map,
 * synced to both clients, players on that map's spawns. The first switch is a
 * real match end (five kills), the others leave-and-rejoin.
 */
async function randomMaps() {
  const tag = "[random map]";
  const lines: [boolean, string][] = [];
  const ok = (cond: boolean, l: string) => lines.push([cond, `${tag} ${l}`]);
  const r1 = await new Client(URL).create("duel_random");
  let r2 = await new Client(URL).joinById(r1.roomId);
  const ids: string[] = [];
  let synced = true;
  let spawned = true;
  const record = async () => {
    const up = await waitFor(() => state(r1).phase === "playing" && !!me(r2) && state(r2).mapId === state(r1).mapId, 3000);
    const id = state(r1).mapId;
    const map = mapById(id);
    synced &&= up && MAPS.some((m) => m.id === id);
    spawned &&= onSpawn(me(r1), map) && onSpawn(me(r2), map);
    ids.push(id);
  };
  try {
    await record();

    // A real match end: the room's own damage path, five kills for player 1.
    const room = localRoom(r1.roomId) as unknown as {
      damage(a: string, t: string, target: unknown, n: number): void;
      state: { players: Map<string, { alive: boolean }> };
    };
    for (let k = 0; k < KILLS_TO_WIN; k++) {
      // Read the room itself: the clients' view lags a tick behind.
      await waitFor(() => !!room.state.players.get(r2.sessionId)?.alive, 4000);
      room.damage(r1.sessionId, r2.sessionId, room.state.players.get(r2.sessionId), MAX_HP);
    }
    const ended = await waitFor(() => state(r1).phase === "ended" && state(r2).phase === "ended", 2000);
    ok(ended && state(r1).mapId === ids[0], `five kills end the match, still on ${ids[0]}`);
    await waitFor(() => state(r1).phase === "playing", (MATCH_END_DELAY + 2) * 1000);
    await record();

    for (let i = 0; i < 4; i++) {
      await r2.leave();
      await waitFor(() => state(r1).phase === "waiting", 2000);
      r2 = await new Client(URL).joinById(r1.roomId);
      await record();
    }
    const changed = ids.every((id, i) => i === 0 || id !== ids[i - 1]);
    ok(changed, `each new match is on a different map than the last: ${ids.join(" -> ")}`);
    ok(synced, "every match's mapId is a known map, the same on both clients");
    ok(spawned, "every match starts both players on that map's spawns");
  } finally {
    await r2.leave();
    await r1.leave();
  }
  return lines;
}

/** The dev `?map=` join option: honoured in dev (from either player), ignored with NODE_ENV=production. */
async function devMapOption() {
  const saved = process.env.NODE_ENV;
  const matches = async (opt1: object, opt2: object, n: number) => {
    const r1 = await new Client(URL).create("duel_random", opt1);
    let r2 = await new Client(URL).joinById(r1.roomId, opt2);
    const ids: string[] = [];
    try {
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          await r2.leave();
          await waitFor(() => state(r1).phase === "waiting", 2000);
          r2 = await new Client(URL).joinById(r1.roomId, opt2);
        }
        await waitFor(() => state(r1).phase === "playing" && state(r2).phase === "playing", 3000);
        ids.push(state(r2).mapId);
      }
    } finally {
      await r2.leave();
      await r1.leave();
    }
    return ids;
  };
  try {
    delete process.env.NODE_ENV;
    const dev1 = await matches({ map: "nest" }, {}, 3);
    check(dev1.every((id) => id === "nest"), `[map option] dev: ?map=nest from the room's creator holds for every match (${dev1.join(", ")})`);
    const dev2 = await matches({}, { map: "dockside" }, 2);
    check(dev2.every((id) => id === "dockside"), `[map option] dev: ?map=dockside from the second player applies from the first match (${dev2.join(", ")})`);
    const bogus = await matches({ map: "nope" }, { map: 42 }, 2);
    check(bogus[0] !== bogus[1], `[map option] dev: an unknown map id is ignored (${bogus.join(", ")})`);
    process.env.NODE_ENV = "production";
    const prod = await matches({ map: "nest" }, { map: "nest" }, 2);
    check(prod[0] !== prod[1], `[map option] NODE_ENV=production: ?map=nest is ignored, matches still rotate (${prod.join(", ")})`);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
}


// ---------------------------------------------------------------------------
// Part 4: game pages. Private rooms, the open games list and joins by id.

async function listedOverHttp(): Promise<OpenGame[]> {
  const res = await fetch(`${URL}${GAMES_ROUTE}`, { headers: { origin: "http://localhost:5173" } });
  const body = (await res.json()) as { games: OpenGame[] };
  return body.games;
}

async function joinError(roomId: string): Promise<{ code?: number; message: string } | null> {
  try {
    const r = await new Client(URL).joinById(roomId);
    await r.leave();
    return null;
  } catch (err) {
    const e = err as { code?: number; message?: string };
    return { code: e.code, message: String(e.message ?? err) };
  }
}

async function lobbyChecks() {
  // Every earlier room has emptied (they auto-dispose), so quick match below
  // can only find the rooms made here.
  const idle = await waitFor(() => matchMaker.stats.local.roomCount === 0, 3000);
  check(idle, `[games] no rooms left over from the earlier checks (${matchMaker.stats.local.roomCount})`);

  // A private room: not listed, not quick-matched, joinable by id.
  const priv = await new Client(URL).create(ROOM_NAME, { private: true });
  await sleep(100);
  const [cache] = await matchMaker.query({ roomId: priv.roomId });
  check(cache?.private === true, "[games] create({ private: true }) makes a private room");
  check(!(await openGames()).some((g) => g.roomId === priv.roomId), "[games] a private room is not in the open games list");
  check(!(await listedOverHttp()).some((g) => g.roomId === priv.roomId), `[games] ...nor in GET ${GAMES_ROUTE}`);
  const quick = await new Client(URL).joinOrCreate(ROOM_NAME);
  check(quick.roomId !== priv.roomId, "[games] quick match (joinOrCreate) never lands in a private room");

  // The public room quick match just created is listed, with its metadata.
  await sleep(100);
  const listed = (await listedOverHttp()).find((g) => g.roomId === quick.roomId);
  const quickName = me(quick)?.name ?? "";
  check(
    !!listed && listed.hostName === quickName && listed.mapId === "yard" && Math.abs(Date.now() - listed.createdAt) < 10000,
    `[games] a public room waiting alone is listed with host, map and age (${JSON.stringify(listed)})`,
  );

  // A friend joins the private room by id (the invite link): the match starts.
  const friend = await new Client(URL).joinById(priv.roomId);
  const privStarted = await waitFor(() => state(priv).phase === "playing" && state(friend).phase === "playing", 3000);
  check(privStarted, "[games] joining a private room by id starts its match");
  const [privMeta] = await matchMaker.query({ roomId: priv.roomId });
  check(
    privMeta?.metadata?.players === 2 && privMeta.metadata.phase === "playing" && privMeta.locked === true,
    `[games] metadata follows the room: 2 players, playing, locked (${JSON.stringify(privMeta?.metadata)})`,
  );

  // A third player with the link: refused cleanly, the room goes on.
  const full = await joinError(priv.roomId);
  check(!!full && full.code === 522 && /locked/.test(full.message), `[games] joinById of a full room is rejected (${full?.code} ${full?.message})`);
  const gone = await joinError("doesnotexist");
  check(!!gone && gone.code === 522 && /not found/.test(gone.message), `[games] joinById of an unknown room is rejected (${gone?.code} ${gone?.message})`);
  await sleep(100);
  check(state(priv).phase === "playing" && !!other(priv), "[games] the full room is unaffected by the refused join");

  // A second player's join options can't make someone else's room private.
  const guest = await new Client(URL).joinById(quick.roomId, { private: true });
  await waitFor(() => state(quick).phase === "playing", 3000);
  const [quickMeta] = await matchMaker.query({ roomId: quick.roomId });
  check(quickMeta?.private === false, "[games] { private: true } from a joiner is ignored");
  check(!(await openGames()).some((g) => g.roomId === quick.roomId), "[games] a full room leaves the open games list");

  // The host leaves: the room is listed again, under the remaining player's name.
  const guestName = me(guest)?.name ?? "";
  await quick.leave();
  await waitFor(() => state(guest).phase === "waiting", 2000);
  await sleep(100);
  const again = (await openGames()).find((g) => g.roomId === quick.roomId);
  check(again?.hostName === guestName, `[games] after the host leaves, the room is listed under the remaining player (${again?.hostName})`);

  await Promise.all([guest.leave(), priv.leave(), friend.leave()]);

  // A guest keeps the name its menu shows, if it has the guest format.
  const named = await new Client(URL).create(ROOM_NAME, { guestName: "Guest-4242" });
  const twin = await new Client(URL).joinById(named.roomId, { guestName: "Guest-4242" });
  await waitFor(() => !!me(twin)?.name && !!other(twin)?.name, 2000);
  check(me(named)?.name === "Guest-4242", `[games] the guestName option is kept (${me(named)?.name})`);
  check(/^Guest-\d{4}$/.test(me(twin)?.name ?? "") && me(twin)?.name !== "Guest-4242", `[games] ...but never twice in one room (${me(twin)?.name})`);
  await Promise.all([named.leave(), twin.leave()]);
  const fake = await new Client(URL).create(ROOM_NAME, { guestName: "Admin" });
  await waitFor(() => !!me(fake)?.name, 2000);
  check(/^Guest-\d{4}$/.test(me(fake)?.name ?? ""), `[games] a guestName that isn't Guest-NNNN is ignored (${me(fake)?.name})`);
  await fake.leave();
  const cleaned = await waitFor(() => matchMaker.stats.local.roomCount === 0, 3000);
  check(cleaned, "[games] every room is disposed once its players left");
}

/** The scoreboard counters: counted by the server during a match, reset by the next one. Ping measured by the server. */
async function scoreboardChecks() {
  const r1 = await new Client(URL).create(ROOM_NAME);
  const r2 = await new Client(URL).joinById(r1.roomId);
  // r1 answers the latency probe 120 ms late; r2 never answers.
  r1.onMessage(MSG_PING, (m: unknown) => setTimeout(() => r1.send(MSG_PONG, m), 120));
  await waitFor(() => state(r1).phase === "playing" && !!me(r2), 3000);
  const d1 = driver(r1);
  const d2 = driver(r2);
  check(me(r1)!.shots === 0 && me(r1)!.hits === 0 && me(r1)!.damage === 0 && me(r2)!.deaths === 0, "[scoreboard] counters start at 0");
  // Face to face in the open (same lane as the weapon checks).
  await Promise.all([d1.goTo(4, -12), d2.goTo(12, -12).then(() => d2.goTo(8, -12))]);
  d1.set({ aim: 0, fire: true });
  await waitFor(() => me(r1)!.kills >= 1, 5000);
  d1.set({ fire: false });
  await sleep(300);
  const a = me(r1)!;
  const b = me(r2)!;
  check(
    a.shots >= a.hits && a.hits >= 5 && a.damage >= MAX_HP && a.damage <= a.hits * WEAPONS[0].damage,
    `[scoreboard] shots, hits and damage are counted by the server (shots ${a.shots}, hits ${a.hits}, damage ${a.damage})`,
  );
  check(b.deaths === 1 && b.shots === 0 && b.damage === 0, `[scoreboard] the victim has 1 death, 0 shots, 0 damage (${b.deaths}, ${b.shots}, ${b.damage})`);
  check(
    state(r1).tick > state(r1).startTick && state(r1).endTick === 0,
    `[scoreboard] the match start tick is synced (started ${state(r1).startTick}, now ${state(r1).tick})`,
  );
  await waitFor(() => me(r1)!.ping > 0, 5000);
  check(me(r1)!.ping >= 100 && me(r1)!.ping < 1000, `[scoreboard] ping is measured by the server (${me(r1)!.ping} ms for a 120 ms late answer)`);
  check(me(r2)!.ping === 0, "[scoreboard] a client that never answers keeps ping 0");

  // Finish the match through the room's own damage path, then wait for the rematch.
  const room = localRoom(r1.roomId) as unknown as {
    damage(a: string, t: string, target: unknown, n: number): void;
    state: { players: Map<string, { alive: boolean; kills: number }> };
  };
  while ((room.state.players.get(r1.sessionId)?.kills ?? 0) < KILLS_TO_WIN) {
    await waitFor(() => !!room.state.players.get(r2.sessionId)?.alive, 4000);
    room.damage(r1.sessionId, r2.sessionId, room.state.players.get(r2.sessionId), MAX_HP);
  }
  await waitFor(() => state(r1).phase === "ended", 2000);
  check(state(r1).endTick > state(r1).startTick, "[scoreboard] the match end tick is synced");
  await waitFor(() => state(r1).phase === "playing", (MATCH_END_DELAY + 2) * 1000);
  await sleep(100);
  const z = [me(r1)!, me(r2)!];
  check(
    z.every((p) => p.kills === 0 && p.deaths === 0 && p.shots === 0 && p.hits === 0 && p.damage === 0),
    "[scoreboard] every counter resets on the rematch",
  );
  d1.stop();
  d2.stop();
  await Promise.all([r1.leave(), r2.leave()]);
}


// ---------------------------------------------------------------------------
// Part 6: reconnection, malformed messages, rate limit.
// ---------------------------------------------------------------------------

/** What the smoke test pokes at on the server side of a room. */
type LocalDuel = {
  damage(a: string, t: string, target: unknown, n: number): void;
  state: { players: Map<string, PlayerView & { toJSON(): unknown }>; phase: string };
  clients: { sessionId: string; ref: { terminate(): void } }[];
};
const duelRoom = (roomId: string) => localRoom(roomId) as unknown as LocalDuel;

/**
 * Cuts a client's connection the way a network loss does: the server drops
 * the TCP socket without a close frame, so both sides see 1006.
 */
function cutConnection(room: Room) {
  duelRoom(room.roomId).clients.find((c) => c.sessionId === room.sessionId)?.ref.terminate();
}

/** Every SDK event of one room, in order, for the reconnection checks. */
function lifecycle(room: Room) {
  const events: string[] = [];
  room.onDrop((code) => events.push(`drop:${code}`));
  room.onReconnect(() => events.push("reconnect"));
  room.onLeave((code) => events.push(`leave:${code}`));
  return events;
}

/** A two-player private room in "playing". `name` picks another room type. */
async function playingDuel(name = ROOM_NAME) {
  const r1 = await new Client(URL).create(name);
  const r2 = await new Client(URL).joinById(r1.roomId);
  // The SDK only retries once a room has been up for 5 s (minUptime); the checks don't wait that long.
  for (const r of [r1, r2]) r.reconnection.minUptime = 0;
  const started = await waitFor(() => state(r1).phase === "playing" && !!me(r1) && !!me(r2), 3000);
  if (!started) throw new Error("match did not start");
  return { r1, r2 };
}

/** The SDK's own automatic reconnection: same seat, score and weapon. */
async function reconnectAuto() {
  const tag = "[reconnect]";
  const lines: [boolean, string][] = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const { r1, r2 } = await playingDuel();
  try {
    const room = duelRoom(r1.roomId);
    // Something worth keeping: player 1 scores on player 2, who picks the sniper while dead.
    room.damage(r1.sessionId, r2.sessionId, room.state.players.get(r2.sessionId), MAX_HP);
    r2.send(MSG_PICK, { weapon: 2 });
    await waitFor(() => me(r2)!.alive && me(r2)!.weapon === 2 && me(r1)!.kills === 1, 4000);
    const before = { slot: me(r2)!.slot, weapon: me(r2)!.weapon, kills: me(r1)!.kills, deaths: me(r2)!.deaths };
    ok(before.weapon === 2 && before.kills === 1, `setup: score 1-0, player 2 holds the sniper (${JSON.stringify(before)})`);

    const events = lifecycle(r2);
    const t0 = performance.now();
    cutConnection(r2);
    const seenDropped = await waitFor(() => other(r1)?.connected === false, 2000);
    ok(seenDropped, "the opponent sees the dropped player as not connected");
    const back = await waitFor(() => events.includes("reconnect"), 8000);
    ok(
      back && events[0]?.startsWith("drop:") && !events.some((e) => e.startsWith("leave")),
      `the SDK reconnects on its own within the grace period (${events.join(", ")}, ${Math.round(performance.now() - t0)} ms)`,
    );
    const resynced = await waitFor(() => other(r1)?.connected === true && me(r2)?.connected === true, 2000);
    const after = { slot: me(r2)!.slot, weapon: me(r2)!.weapon, kills: me(r1)!.kills, deaths: me(r2)!.deaths };
    ok(
      resynced && JSON.stringify(after) === JSON.stringify(before) && room.state.players.has(r2.sessionId) && room.state.players.size === 2,
      `same session, seat, score and weapon after the reconnect (${JSON.stringify(after)})`,
    );
    ok(state(r1).phase === "playing" && state(r2).phase === "playing", "the match goes on");
    const seq = me(r2)!.lastSeq + 1;
    r2.send(MSG_INPUT, { ...idle, seq });
    ok(await waitFor(() => me(r2)!.lastSeq === seq, 1500), "the reconnected client's inputs are applied again");
  } finally {
    await Promise.all([r1.leave(), r2.leave()]);
  }
  return lines;
}

/**
 * A page reload: the old Room is gone (no automatic retry), the page calls
 * `client.reconnect(token)`. Meanwhile, the dropped character stays put and
 * can be shot.
 */
async function reconnectReload() {
  const tag = "[reconnect: reload]";
  const lines: [boolean, string][] = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const { r1, r2 } = await playingDuel();
  const d1 = driver(r1);
  const d2 = driver(r2);
  let r2b: Room | null = null;
  try {
    const room = duelRoom(r1.roomId);
    // Face to face in the open, player 2 four metres right of player 1.
    const [a1, a2] = await Promise.all([d1.goTo(4, -12), d2.goTo(12, -12).then(() => d2.goTo(8, -12))]);
    if (!a1 || !a2) throw new Error(`${tag} players did not reach their spots`);
    await caughtUp(r2, d2);

    // The page dies with player 2 walking away: inputs are in flight.
    d2.set({ mx: 1 });
    await sleep(100);
    r2.reconnection.enabled = false;
    const token = r2.reconnectionToken;
    const events = lifecycle(r2);
    cutConnection(r2);
    d2.stop();
    const dropped = await waitFor(
      () => room.state.players.get(r2.sessionId)?.connected === false && events.some((e) => e.startsWith("leave")),
      3000,
    );
    ok(dropped, `the server holds the seat, the dead page's Room is gone (${events.join(", ")})`);
    await sleep(100);
    const p = room.state.players.get(r2.sessionId)!;
    const at = { x: p.x, z: p.z };
    await sleep(1000);
    ok(p.x === at.x && p.z === at.z, `the dropped character doesn't move (${at.x.toFixed(3)}, ${at.z.toFixed(3)} one second later)`);

    const hp0 = p.hp;
    d1.set({ aim: 0, fire: true });
    const hurt = await waitFor(() => !p.alive || p.hp < hp0, 3000);
    d1.set({ fire: false });
    ok(hurt, `the dropped character can be shot (hp ${hp0} -> ${p.hp})`);
    await caughtUp(r1, d1);
    await sleep(100);
    const hpNow = p.hp;

    r2b = await new Client(URL).reconnect(token);
    const rb = r2b;
    const resumed = await waitFor(() => !!me(rb) && other(r1)?.connected === true, 2000);
    ok(
      resumed && rb.sessionId === r2.sessionId && me(rb)!.slot === p.slot && me(rb)!.hp === hpNow,
      `client.reconnect(token) gets the same session back, with its state (hp ${me(rb)?.hp})`,
    );
    const seq = me(rb)!.lastSeq + 1;
    rb.send(MSG_INPUT, { ...idle, seq, mx: -1 });
    ok(await waitFor(() => me(rb)!.lastSeq === seq, 1500), "the resumed session's inputs are applied again");
  } finally {
    d1.stop();
    d2.stop();
    await Promise.all([r1.leave(), r2b?.leave()]);
  }
  return lines;
}

/** A room whose grace period is 2 s, for the expiry check. */
class ShortGraceRoom extends DuelRoom.pinnedTo("yard") {
  protected override reconnectGrace = 2;
}

/** After the grace period the drop is a leave: the seat is freed, the opponent goes back to waiting. */
async function reconnectExpired() {
  const tag = "[reconnect: expired]";
  const lines: [boolean, string][] = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const { r1, r2 } = await playingDuel("duel_short_grace");
  let r3: Room | null = null;
  try {
    r2.reconnection.enabled = false;
    const token = r2.reconnectionToken;
    const t0 = performance.now();
    cutConnection(r2);
    await waitFor(() => other(r1)?.connected === false, 2000);
    ok(state(r1).phase === "playing", "during the grace period the match is still on");
    const freed = await waitFor(() => state(r1).phase === "waiting" && state(r1).players.get(r2.sessionId) === undefined, 5000);
    const took = performance.now() - t0;
    ok(freed && took > 1800, `after the grace period the seat is freed and the opponent is back to waiting (${Math.round(took)} ms)`);
    const late = await new Client(URL).reconnect(token).then(
      (r) => r.leave().then(() => "reconnected"),
      (e: { code?: number }) => `refused ${e?.code ?? ""}`,
    );
    ok(late.startsWith("refused"), `a reconnect after the grace period is refused (${late})`);
    r3 = await new Client(URL).joinById(r1.roomId);
    const rb = r3;
    ok(await waitFor(() => state(r1).phase === "playing" && !!me(rb), 3000), "a new player takes the freed seat and the match starts");
  } finally {
    await Promise.all([r1.leave(), r3?.leave()]);
  }
  return lines;
}

/** Malformed and unknown messages are dropped: the room, the sender's connection and the state are untouched. */
async function malformedMessages() {
  const tag = "[messages]";
  const lines: [boolean, string][] = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const r1 = await new Client(URL).create(ROOM_NAME, { private: true });
  const events = lifecycle(r1);
  try {
    await waitFor(() => !!me(r1), 2000);
    const room = duelRoom(r1.roomId);
    const player = room.state.players.get(r1.sessionId)!;
    const before = JSON.stringify(player.toJSON());
    const valid = { ...idle, seq: 5, mx: 1 };
    const missingReload: Record<string, unknown> = { ...valid };
    delete missingReload.reload;
    const inputs: unknown[] = [
      undefined, null, 42, "input", [], [valid], {},
      { ...valid, seq: "5" }, { ...valid, seq: 1.5 }, { ...valid, seq: -1 }, { ...valid, seq: 0 }, { ...valid, seq: 2 ** 40 },
      { ...valid, mx: NaN }, { ...valid, mz: Infinity }, { ...valid, mx: 1e308 }, { ...valid, mx: "1" },
      { ...valid, aim: NaN }, { ...valid, aim: 1e9 }, { ...valid, gx: -Infinity }, { ...valid, gz: 1e12 },
      { ...valid, fire: "yes" }, { ...valid, fire: 1 },
      { ...valid, dash: -1 }, { ...valid, dash: 1.5 }, { ...valid, grenade: 2 ** 40 }, { ...valid, shield: "1" },
      missingReload,
    ];
    for (const m of inputs) r1.send(MSG_INPUT, m);
    for (const m of [undefined, null, 1, { weapon: "1" }, { weapon: 1.5 }, { weapon: -1 }, { weapon: 99 }, { weapon: NaN }, {}, [1]])
      r1.send(MSG_PICK, m);
    for (const m of [undefined, null, { n: "1" }, { n: NaN }, { n: -1 }, { n: 12345 }, { n: 2 ** 40 }]) r1.send(MSG_PONG, m);
    for (const type of ["hax", "__proto__", "constructor", "toString", MSG_PING, ""]) r1.send(type, { seq: 9, weapon: 1 });
    r1.send(99, { x: 1 });
    await sleep(400);
    ok(!!localRoom(r1.roomId) && events.length === 0, `the room and the sender's connection survive ${inputs.length + 25} bad messages`);
    ok(JSON.stringify(player.toJSON()) === before, "none of them changed the player's state");
    r1.send(MSG_INPUT, { ...valid, seq: 1 });
    r1.send(MSG_PICK, { weapon: 3 });
    ok(await waitFor(() => me(r1)?.lastSeq === 1 && me(r1)?.pick === 3, 1500), "valid messages right after are applied");
  } finally {
    await r1.leave();
  }
  return lines;
}

/** A fresh seat takes its first input's press counters as the baseline: nothing fires from them, the next press does. */
async function pressBaseline() {
  const tag = "[presses]";
  const lines: [boolean, string][] = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const r1 = await new Client(URL).create(ROOM_NAME, { private: true });
  try {
    await waitFor(() => !!me(r1), 2000);
    const room = duelRoom(r1.roomId);
    // Counters left over from earlier games in the same tab.
    r1.send(MSG_INPUT, { ...idle, seq: 1, dash: 7, grenade: 3, shield: 2, reload: 4 });
    await waitFor(() => me(r1)?.lastSeq === 1, 1500);
    await sleep(100);
    const p = me(r1)!;
    ok(
      p.dashCd === 0 && p.dashTicks === 0 && p.grenadeCd === 0 && p.shieldTicks === 0 && p.reloadTicks === 0 && room.state.players.size === 1,
      `a first input with counters {dash: 7, grenade: 3, shield: 2, reload: 4} triggers nothing (seen ${p.dashSeen}, ${p.grenadeSeen}, ${p.shieldSeen}, ${p.reloadSeen})`,
    );
    r1.send(MSG_INPUT, { ...idle, seq: 2, dash: 8, grenade: 3, shield: 2, reload: 4 });
    ok(await waitFor(() => me(r1)!.dashCd > 0, 1500), `the next increment does (dash 7 -> 8: dash cooldown ${me(r1)!.dashCd})`);
  } finally {
    await r1.leave();
  }
  return lines;
}

/** A client flooding the room is disconnected (4002) without a held seat; the room goes on. */
async function messageFlood() {
  const tag = "[messages]";
  const lines: [boolean, string][] = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const { r1, r2 } = await playingDuel();
  try {
    const events = lifecycle(r2);
    for (let i = 0; i < MAX_MESSAGES_PER_SECOND * 2; i++) r2.send(MSG_PONG, { n: i });
    const kicked = await waitFor(() => events.length > 0, 2000);
    ok(kicked && events[0] === `leave:${CloseCode.WITH_ERROR}`, `a flood of ${MAX_MESSAGES_PER_SECOND * 2} messages closes the sender's connection (${events.join(", ")})`);
    const freed = await waitFor(() => state(r1).phase === "waiting" && state(r1).players.get(r2.sessionId) === undefined, 2000);
    ok(freed, "no seat is held for it: the opponent is back to waiting at once");
  } finally {
    await r1.leave();
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Part 7: SIGTERM on a server with a live match (a child process, production mode).
// ---------------------------------------------------------------------------
async function shutdownCheck() {
  const tag = "[shutdown]";
  const port = 2598;
  const url = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["src/index.ts"], {
    cwd: dirname(fileURLToPath(import.meta.url)),
    env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
    stdio: "ignore",
  });
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      up = !!(await fetch(`${url}${GAMES_ROUTE}`).catch(() => null))?.ok;
      if (!up) await sleep(100);
    }
    if (!up) throw new Error(`${tag} the child server did not start`);
    const r1 = await new Client(url).joinOrCreate(ROOM_NAME);
    const r2 = await new Client(url).joinOrCreate(ROOM_NAME);
    await waitFor(() => state(r1).phase === "playing", 3000);
    const codes: number[] = [];
    const dropped: number[] = [];
    for (const r of [r1, r2]) {
      r.onLeave((code) => codes.push(code));
      r.onDrop((code) => dropped.push(code));
    }
    const t0 = performance.now();
    child.kill("SIGTERM");
    const exit = await Promise.race([exited, sleep(8000).then(() => "timeout")]);
    const took = Math.round(performance.now() - t0);
    await waitFor(() => codes.length === 2, 1000);
    check(
      codes.length === 2 && codes.every((c) => c === CloseCode.SERVER_SHUTDOWN) && dropped.length === 0,
      `${tag} SIGTERM with a live match: both clients get close code ${CloseCode.SERVER_SHUTDOWN} (server shutdown), no reconnect attempt (${codes.join(", ")})`,
    );
    check(exit === 0, `${tag} the process exits cleanly (exit code ${exit}, ${took} ms)`);
  } finally {
    child.kill("SIGKILL");
  }
}

// ---------------------------------------------------------------------------

const accounts = await setupTestAccounts();
const server = createServer({ gracefullyShutdown: false, mapId: "yard" });
await server.listen(PORT);
// Extra room types for the map checks: one unpinned (random maps), one pinned per wall case.
matchMaker.defineRoomType("duel_random", DuelRoom);
for (const c of WALL_CASES) matchMaker.defineRoomType(`duel_${c.map}`, DuelRoom.pinnedTo(c.map));
matchMaker.defineRoomType("duel_short_grace", ShortGraceRoom);
registerFfaRooms();

let exitCode = 0;
try {
  pureChecks();
  pureMapChecks();
  await mainDuel();

  console.log("\n-- parallel rooms: weapons, grenade, shield, accounts --");
  const accountLines: [boolean, string][] = [];
  const results = await Promise.allSettled([
    accountChecks(URL, accounts, (c, l) => accountLines.push([c, `[accounts] ${l}`])).then(() => accountLines),
    liveConvexChecks((c, l) => accountLines.push([c, `[accounts] ${l}`])).then(() => [] as [boolean, string][]),
    ...WEAPONS.map((_, i) => weaponDuel(i)),
    grenadeDuel(),
    shieldDuel(),
    ...WALL_CASES.map((c) => mapDuel(c)),
    randomMaps(),
  ]);
  for (const r of results) {
    if (r.status === "fulfilled") for (const [c, l] of r.value) check(c, l);
    else {
      console.error(r.reason);
      check(false, `scenario crashed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    }
  }

  console.log("\n-- game pages: private rooms, open games, join by id --");
  await lobbyChecks();
  console.log("\n-- scoreboard --");
  await scoreboardChecks();

  console.log("\n-- free for all --");
  for (const group of await ffaChecks(URL, accounts)) for (const [c, l] of group) check(c, l);

  console.log("\n-- reconnection, malformed messages, rate limit --");
  const netResults = await Promise.allSettled([reconnectAuto(), reconnectReload(), reconnectExpired(), malformedMessages(), messageFlood(), pressBaseline()]);
  for (const r of netResults) {
    if (r.status === "fulfilled") for (const [c, l] of r.value) check(c, l);
    else {
      console.error(r.reason);
      check(false, `scenario crashed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    }
  }
  console.log("\n-- SIGTERM --");
  await shutdownCheck();

  // Last and alone: it flips NODE_ENV for the whole process.
  console.log("\n-- dev ?map= option --");
  await devMapOption();
} catch (err) {
  console.error(err);
  failures.push("uncaught error");
} finally {
  exitCode = failures.length === 0 ? 0 : 1;
  console.log(failures.length === 0 ? "\nsmoke: all checks passed" : `\nsmoke: ${failures.length} failure(s)`);
  await server.gracefullyShutdown(false);
  process.exit(exitCode);
}

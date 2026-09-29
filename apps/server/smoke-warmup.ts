// Warmup checks for the smoke test (see smoke.ts): the phase every match
// spends between waiting and playing. Everyone is spawned and may move,
// dash and change their loadout (in hand at once), but nothing is fired,
// thrown or shielded, and no damage is dealt. The match clock, the time
// limit and the tiebreaks start when it ends. A mode with `warmup: 0` goes
// straight to playing.
//
// Every other smoke room is shortened to QUICK_WARMUP, so their checks don't
// wait 8 s; the real duel room type here keeps WARMUP_SECONDS.

import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  DUEL_RULES,
  FFA_RULES,
  MSG_INPUT,
  MSG_PICK,
  TEAM_RULES,
  TICK_MS,
  WARMUP_SECONDS,
  WEAPONS,
  equipSim,
  mapById,
  playerCan,
  spawnSim,
  stepPlayer,
  ticks,
  watchPath,
  type InputMessage,
  type PlayerView,
  type RoomStateView,
} from "@bagarre/shared";
import { DuelRoom, FfaRoom, TeamRoom } from "./src/GameRoom.ts";

/** Seconds of warmup in every other smoke room: short, but still a warmup (the phase order is the same). */
export const QUICK_WARMUP = 0.3;

type Lines = [boolean, string][];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await sleep(20);
  }
  return cond();
}
const state = (room: Room) =>
  room.state as unknown as RoomStateView & { players: Map<string, PlayerView>; bullets: Map<string, unknown>; grenades: Map<string, unknown> };
const me = (room: Room) => state(room)?.players?.get(room.sessionId);

type LocalRoom = {
  damage(a: string, t: string, target: unknown, n: number, weapon?: number): void;
  state: { players: Map<string, PlayerView>; phase: string };
  clients: { sessionId: string; ref: { terminate(): void } }[];
};
const local = (roomId: string) => matchMaker.getLocalRoomById(roomId) as unknown as LocalRoom;

/** Every phase a room goes through, in order, from this client's view (one entry per change). */
function phases(room: Room): string[] {
  const seen: string[] = [];
  const cb = () => {
    const p = state(room)?.phase;
    if (p && seen[seen.length - 1] !== p) seen.push(p);
  };
  cb();
  room.onStateChange(cb);
  return seen;
}

const leaveAll = (rooms: (Room | null)[]) =>
  Promise.all(rooms.map((r) => (r ? Promise.race([r.leave().catch(() => {}), sleep(1000)]) : null)));

/**
 * Sends one input per tick, `make(n)` building the n-th (from 0). A fresh
 * seat takes its first input's press counters as the baseline, so presses
 * should count from 0 at n = 0. Returns a stop function.
 */
function send(room: Room, make: (n: number) => Omit<InputMessage, "seq">): () => void {
  const state = { seq: me(room)?.lastSeq ?? 0, n: 0 };
  const timer = setInterval(() => room.send(MSG_INPUT, { seq: ++state.seq, ...make(state.n++) }), TICK_MS);
  return () => clearInterval(timer);
}

const idle = { mx: 0, mz: 0, aim: 0, fire: false, gx: 3, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0 };

export function registerWarmupRooms() {
  // The real duel rules: an 8 s warmup.
  matchMaker.defineRoomType("wu_duel", DuelRoom.pinnedTo("yard"));
  // A mode with no warmup (like a future gun game, where picks are off).
  matchMaker.defineRoomType("wu_none", DuelRoom.withRules({ warmup: 0 }).pinnedTo("yard"));
  // FFA: a short countdown, a 1.5 s warmup, then a 2 s limit that ends on a tie in 0.5 s of sudden death.
  matchMaker.defineRoomType(
    "wu_ffa_timed",
    FfaRoom.pinnedTo("crossroads").withRules({ countdown: 0.5, warmup: 1.5, timeLimit: 2, suddenDeathMax: 0.5, respawnDelay: 0.3 }),
  );
  // FFA with a long warmup: drop-ins during it, and leaves.
  matchMaker.defineRoomType("wu_ffa_long", FfaRoom.pinnedTo("crossroads").withRules({ countdown: 0.5, warmup: 30, respawnDelay: 0.3 }));
  matchMaker.defineRoomType("wu_tdm", TeamRoom.pinnedTo("crossroads").withRules({ countdown: 0.5, warmup: 30, respawnDelay: 0.3 }));
}

/** The shared rules and the step, with no server. */
function pureChecks(): Lines {
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `[warmup] ${l}`]);
  ok(WARMUP_SECONDS === 8, `WARMUP_SECONDS is 8 (${WARMUP_SECONDS})`);
  ok(
    [DUEL_RULES, FFA_RULES, TEAM_RULES].every((r) => r.warmup === WARMUP_SECONDS),
    "every mode warms up for WARMUP_SECONDS (ModeRules.warmup)",
  );
  const w = playerCan(true, "warmup");
  ok(w.act && !w.armed, "playerCan in warmup: can move, can't shoot");
  ok(playerCan(true, "playing").armed && playerCan(true, "waiting").armed, "playerCan: armed while waiting and playing");
  ok(!playerCan(true, "ended").act && !playerCan(false, "warmup").act, "playerCan: nothing after the end, nor while dead");

  // One step with the trigger held and every press: in warmup only the dash goes.
  const yard = mapById("yard");
  const sim = spawnSim(0, 0, 0);
  const input: InputMessage = { ...idle, seq: 1, fire: true, dash: 1, grenade: 1, shield: 1, reload: 1 };
  const res = stepPlayer(yard, sim, input, 0, playerCan(true, "warmup"));
  ok(
    !res.fired && !res.grenade && !res.shield && res.dashing && res.sim.ammo === WEAPONS[0].magazine,
    "stepPlayer in warmup: the dash goes, no shot, no grenade, no shield",
  );
  ok(
    res.sim.grenadeSeen === 1 && res.sim.shieldSeen === 1 && res.sim.grenadeCd === 0 && res.sim.shieldCd === 0,
    "stepPlayer in warmup: the presses are used up (none goes off when the match starts), no cooldown started",
  );
  const live = stepPlayer(yard, sim, input, 0, playerCan(true, "playing"));
  ok(live.fired && !!live.grenade && live.shield, "the same step while playing: shot, grenade and shield");

  // A live loadout change resets everything the gun (and the grenade) had going.
  const dirty = { ...spawnSim(2, 3, 0), ammo: 1, reloadTicks: 20, fireCd: 5, burstLeft: 2, grenadeCd: 100, dashCd: 50, dashSeen: 7 };
  const e = equipSim(dirty, 2);
  ok(
    e.ammo === WEAPONS[2].magazine && e.reloadTicks === 0 && e.fireCd === 0 && e.burstLeft === 0 && e.grenadeCd === 0,
    "equipSim: full magazine of the new gun, no reload, fire interval or burst left, grenade ready",
  );
  ok(e.x === 2 && e.z === 3 && e.dashCd === 50 && e.dashSeen === 7, "equipSim: position, dash cooldown and press counters kept");
  return lines;
}

/** A real duel: waiting -> warmup (8 s) -> playing, and everything warmup allows and refuses. */
async function realDuel(url: string): Promise<Lines> {
  const tag = "[warmup: duel]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const r1 = await new Client(url).create("wu_duel");
  const seen = phases(r1);
  let r2: Room | null = null;
  let spectator: Room | null = null;
  try {
    r1.reconnection.minUptime = 0;
    r2 = await new Client(url).joinById(r1.roomId);
    const warm = await waitFor(() => state(r1).phase === "warmup" && !!me(r1) && !!me(r2!), 2000);
    ok(warm, `the second player starts the warmup, not the match (phases ${seen.join(" > ")})`);
    const s = state(r1);
    const end = s.warmupEnd;
    const length = end - s.tick;
    ok(
      length <= ticks(WARMUP_SECONDS) && length >= ticks(WARMUP_SECONDS) - 6,
      `the warmup ends ${WARMUP_SECONDS} s after it starts, synced as a tick (ends on ${end}, ${length} ticks from now)`,
    );
    ok(s.startTick === 0, `the match clock hasn't started (startTick ${s.startTick})`);
    const yard = mapById("yard");
    const onSpawns = [r1, r2].every((r) => {
      const p = me(r)!;
      const sp = yard.spawns[p.slot % yard.spawns.length];
      return p.alive && p.x === sp.x && p.z === sp.z;
    });
    ok(onSpawns, "both players are spawned on their start spots");

    // A spectator arriving mid-warmup reads the same end tick.
    const client = new Client(url);
    const res = await client.http.post(watchPath(r1.roomId), { body: {} });
    spectator = await client.consumeSeatReservation(res.data as Parameters<Client["consumeSeatReservation"]>[0]);
    await waitFor(() => state(spectator!)?.phase === "warmup", 1000);
    ok(state(spectator).warmupEnd === end, `a spectator joining mid-warmup gets the same end tick (${state(spectator).warmupEnd})`);

    // A pick while alive goes in hand at once: sniper and smoke.
    r1.send(MSG_PICK, { weapon: 2, grenade: 1 });
    const equipped = await waitFor(() => me(r1)?.weapon === 2 && me(r1)?.grenade === 1, 1000);
    const p1 = me(r1)!;
    ok(
      equipped && p1.pick === 2 && p1.ammo === WEAPONS[2].magazine && p1.reloadTicks === 0 && p1.fireCd === 0 && p1.burstLeft === 0 && p1.grenadeCd === 0,
      `a pick in warmup is in hand at once, full magazine, no reload (weapon ${p1.weapon}, ammo ${p1.ammo}, grenade ${p1.grenade})`,
    );

    // Fire, throw, shield and dash for a second: only the dash does anything.
    const stop = send(r1, (n) => ({ ...idle, fire: true, dash: n > 0 ? 1 : 0, grenade: n, shield: n }));
    let fired = false;
    const watchBullets = () => (fired ||= state(r1).bullets.size > 0 || state(r1).grenades.size > 0);
    r1.onStateChange(watchBullets);
    await sleep(1200);
    stop();
    r1.onStateChange.remove(watchBullets);
    const after = me(r1)!;
    ok(!fired && after.ammo === WEAPONS[2].magazine, `no bullet and no grenade in warmup, trigger held (ammo ${after.ammo})`);
    ok(after.shieldTicks === 0 && after.shieldCd === 0 && after.grenadeCd === 0, "no shield raised and no grenade cooldown started");
    ok(after.dashCd > 0, "the dash works in warmup");

    // No damage, even through the damage path itself.
    const room = local(r1.roomId);
    const target = room.state.players.get(r2.sessionId)!;
    room.damage(r1.sessionId, r2.sessionId, target, 50, 0);
    ok(target.hp === 100 && target.alive, `no damage in warmup (hp ${target.hp})`);

    // A dropped connection mid-warmup comes back to the same timer.
    let back = false;
    r1.onReconnect(() => (back = true));
    room.clients.find((c) => c.sessionId === r1.sessionId)?.ref.terminate();
    await waitFor(() => back && state(r1).phase === "warmup", 5000);
    ok(back && state(r1).warmupEnd === end, `a reconnection mid-warmup reads the same end tick (${state(r1).warmupEnd})`);

    // The match starts at the end tick, with the clock from there.
    const started = await waitFor(() => state(r1).phase === "playing", (WARMUP_SECONDS + 2) * 1000);
    const st = state(r1);
    ok(started && st.startTick >= end && st.startTick - end <= 1, `playing starts at the end of the warmup (startTick ${st.startTick}, end ${end})`);
    ok(st.warmupEnd === 0, "the end tick is cleared once playing");
    ok(JSON.stringify(seen) === JSON.stringify(["waiting", "warmup", "playing"]), `phases in order: ${seen.join(" > ")}`);

    // Playing, alive: a pick waits for the next spawn again.
    r1.send(MSG_PICK, { weapon: 0 });
    await sleep(300);
    ok(me(r1)?.pick === 2 && me(r1)?.weapon === 2, `a pick while alive and playing is refused (pick ${me(r1)?.pick})`);

    // And the trigger works now.
    const stop2 = send(r1, () => ({ ...idle, fire: true }));
    const shot = await waitFor(() => (me(r1)?.ammo ?? 99) < WEAPONS[2].magazine, 2000);
    stop2();
    ok(shot, `the same trigger fires once playing (ammo ${me(r1)?.ammo})`);
  } finally {
    await leaveAll([r1, r2, spectator]);
  }
  return lines;
}

/** `warmup: 0`: straight from waiting to playing. */
async function noWarmup(url: string): Promise<Lines> {
  const tag = "[warmup: none]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const r1 = await new Client(url).create("wu_none");
  const seen = phases(r1);
  let r2: Room | null = null;
  try {
    r2 = await new Client(url).joinById(r1.roomId);
    const started = await waitFor(() => state(r1).phase === "playing", 2000);
    ok(started && !seen.includes("warmup"), `with warmup 0 the match goes straight to playing (${seen.join(" > ")})`);
    ok(state(r1).startTick > 0 && state(r1).warmupEnd === 0, `the clock starts at once (startTick ${state(r1).startTick})`);
  } finally {
    await leaveAll([r1, r2]);
  }
  return lines;
}

/** FFA: the time limit counts from the end of the warmup. */
async function timedFfa(url: string): Promise<Lines> {
  const tag = "[warmup: ffa time limit]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms: Room[] = [await new Client(url).create("wu_ffa_timed")];
  const seen = phases(rooms[0]);
  try {
    let warmupStart = 0;
    const cb = () => {
      if (!warmupStart && state(rooms[0]).phase === "warmup") warmupStart = state(rooms[0]).tick;
    };
    rooms[0].onStateChange(cb);
    for (let i = 0; i < 2; i++) rooms.push(await new Client(url).joinById(rooms[0].roomId));
    const ended = await waitFor(() => state(rooms[0]).phase === "ended", 8000);
    const s = state(rooms[0]);
    ok(ended && JSON.stringify(seen) === JSON.stringify(["waiting", "warmup", "playing", "ended"]), `phases in order: ${seen.join(" > ")}`);
    const warm = s.startTick - warmupStart;
    ok(Math.abs(warm - ticks(1.5)) <= 1, `the clock starts after the 1.5 s warmup (${warm} ticks after it began)`);
    const played = s.endTick - s.startTick;
    ok(Math.abs(played - ticks(2 + 0.5)) <= 1, `the time limit and sudden death count from playing (${played} ticks of play)`);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** FFA: a drop-in during warmup takes part in it; leaving below minToContinue goes back to waiting. */
async function ffaJoinLeave(url: string): Promise<Lines> {
  const tag = "[warmup: ffa drop-in and leave]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms: Room[] = [await new Client(url).create("wu_ffa_long")];
  try {
    for (let i = 0; i < 2; i++) rooms.push(await new Client(url).joinById(rooms[0].roomId));
    const warm = await waitFor(() => state(rooms[0]).phase === "warmup", 3000);
    ok(warm, "three in: the countdown, then the warmup");
    const d = await new Client(url).joinById(rooms[0].roomId);
    rooms.push(d);
    await waitFor(() => !!me(d), 1000);
    ok(state(d).phase === "warmup" && !!me(d)?.alive, "a fourth player dropping in during warmup is spawned into it");
    d.send(MSG_PICK, { weapon: 3, grenade: 2 });
    const inHand = await waitFor(() => me(d)?.weapon === 3 && me(d)?.grenade === 2, 1000);
    ok(inHand && me(d)?.ammo === WEAPONS[3].magazine && me(d)?.grenadeCd === 0, "the drop-in's pick is in hand at once, like everyone's");

    // Down to 2: still enough to go on (minToContinue), the warmup runs on.
    await rooms.pop()!.leave();
    await rooms.pop()!.leave();
    await sleep(200);
    ok(state(rooms[0]).phase === "warmup", `two left of four: the warmup goes on (${state(rooms[0]).phase})`);
    // Down to 1: back to waiting, like a match with too few left, with no result.
    await rooms.pop()!.leave();
    const back = await waitFor(() => state(rooms[0]).phase === "waiting", 1000);
    ok(back && state(rooms[0]).warmupEnd === 0 && state(rooms[0]).winner === "", `one left: back to waiting, no result (${state(rooms[0]).phase})`);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** Teams: a team left empty during warmup sends the room back to waiting (no team wins a match not played). */
async function teamLeave(url: string): Promise<Lines> {
  const tag = "[warmup: tdm leave]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms: Room[] = [await new Client(url).create("wu_tdm")];
  try {
    for (let i = 0; i < 3; i++) rooms.push(await new Client(url).joinById(rooms[0].roomId));
    const warm = await waitFor(() => state(rooms[0]).phase === "warmup", 3000);
    ok(warm, "2v2: the countdown, then the warmup");
    const host = me(rooms[0])!.team;
    const others = rooms.filter((r) => me(r)!.team !== host);
    for (const r of others) await r.leave();
    const back = await waitFor(() => state(rooms[0]).phase === "waiting", 1000);
    ok(
      back && state(rooms[0]).winningTeam === 255 && state(rooms[0]).warmupEnd === 0,
      `a team left empty in warmup: back to waiting, no winner (${state(rooms[0]).phase}, ${others.length} left)`,
    );
    for (const r of others) rooms.splice(rooms.indexOf(r), 1);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** Every warmup scenario, in parallel. Call `registerWarmupRooms` first. */
export async function warmupChecks(url: string): Promise<Lines[]> {
  const results = await Promise.allSettled([Promise.resolve(pureChecks()), realDuel(url), noWarmup(url), timedFfa(url), ffaJoinLeave(url), teamLeave(url)]);
  return results.map((r) => (r.status === "fulfilled" ? r.value : [[false, `[warmup] scenario crashed: ${r.reason instanceof Error ? r.reason.message : r.reason}`]]));
}

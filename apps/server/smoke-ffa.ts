// Free-for-all checks for the smoke test (see smoke.ts). Every scenario runs
// in its own FFA room type pinned to Crossroads (registered by smoke.ts with
// `registerFfaRooms`), with a 1 s countdown so the checks don't wait 10 s;
// the timed one also has a 3 s time limit, and the tiebreak ones a 2 s
// limit with a 1 s sudden death cap, so the tiebreaks decide.
//
// Kills are dealt through the room's own damage path (`damage`, the one
// bullets and grenades call), like smoke.ts' random-map check does, except the
// self-kill, which is a real grenade thrown at the thrower's own feet.

import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  FFA_MAX_PLAYERS,
  FFA_COUNTDOWN,
  FFA_KILLS_TO_WIN,
  FFA_MAPS,
  FFA_ROOM_NAME,
  GAMES_ROUTE,
  GRENADE,
  KILL_GRENADE,
  MAX_HP,
  MSG_INPUT,
  SPECTATOR_ROOM,
  TICK_MS,
  TICK_RATE,
  bodiesSee,
  findMap,
  rank,
  type InputMessage,
  type KillView,
  type OpenGame,
  type PlayerView,
  type RoomStateView,
} from "@bagarre/shared";
import { FfaRoom } from "./src/GameRoom.ts";
import { QUICK_WARMUP } from "./smoke-warmup.ts";
import type { AccountsHarness } from "./smoke-accounts.ts";

type Lines = [boolean, string][];
const CROSSROADS = findMap("crossroads")!;

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
const count = (m: { forEach(cb: () => void): void }) => {
  let n = 0;
  m.forEach(() => n++);
  return n;
};
const me = (room: Room): PlayerView | undefined => state(room)?.players?.get(room.sessionId);

/** What the checks poke at on the server side of an FFA room. */
type LocalFfa = {
  damage(a: string, t: string, target: unknown, n: number, weapon?: number): void;
  state: {
    players: Map<string, PlayerView>;
    phase: string;
    winner: string;
    tiebreak: string;
    countdown: number;
    suddenDeath: boolean;
    feed: KillView[];
  };
  clients: { sessionId: string; ref: { terminate(): void } }[];
  maxClients: number;
  locked: boolean;
  /** Private in GameRoom: the tiebreak lot's seed. */
  matchId: string;
};
const local = (roomId: string) => matchMaker.getLocalRoomById(roomId) as unknown as LocalFfa;

/** Room types used below: name -> class. */
export function registerFfaRooms() {
  // Short countdown and respawn delay, so a scenario takes seconds.
  const quick = { countdown: 1, respawnDelay: 0.3, warmup: QUICK_WARMUP };
  const base = FfaRoom.pinnedTo("crossroads").withRules(quick);
  matchMaker.defineRoomType("ffa_test", base);
  matchMaker.defineRoomType("ffa_seats", base);
  matchMaker.defineRoomType("ffa_cancel", FfaRoom.pinnedTo("crossroads").withRules({ ...quick, countdown: 3 }));
  // Not pinned: its rematch must move to another FFA map.
  matchMaker.defineRoomType("ffa_timed", FfaRoom.withRules({ ...quick, timeLimit: 3 }));
  // Ties that sudden death doesn't break: the time runs out after 2 s, sudden death after 1 more.
  matchMaker.defineRoomType("ffa_tie", FfaRoom.pinnedTo("crossroads").withRules({ ...quick, timeLimit: 2, suddenDeathMax: 1 }));
}

/** `n` clients in one fresh room of `type` (the first creates it). */
async function fill(url: string, type: string, n: number, opts: Record<string, unknown> = {}): Promise<Room[]> {
  const first = await new Client(url).create(type, opts);
  const rooms = [first];
  for (let i = 1; i < n; i++) rooms.push(await new Client(url).joinById(first.roomId));
  for (const r of rooms) r.reconnection.minUptime = 0;
  return rooms;
}

/** Leaves every room. A room already left never settles its leave() again, hence the race. */
const leaveAll = (rooms: Room[]) => Promise.all(rooms.map((r) => Promise.race([r.leave().catch(() => {}), sleep(1000)])));

/** Kills `victim` by `killer` through the room's damage path, once the victim is alive. */
async function kill(roomId: string, killer: string, victim: string, weapon = 0) {
  const room = local(roomId);
  await waitFor(() => !!room.state.players.get(victim)?.alive, 5000);
  room.damage(killer, victim, room.state.players.get(victim), MAX_HP, weapon);
}

/** Positions of every living player (server side), and whether any two of them see each other. */
function anyoneSeesAnyone(room: LocalFfa): boolean {
  const ps = [...room.state.players.values()].filter((p) => p.alive);
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (bodiesSee(CROSSROADS, ps[i], ps[j])) return true;
  return false;
}

/** 3 join, countdown, start; a 4th drops in out of sight; kill credit and the self-kill. */
async function startAndDropIn(url: string): Promise<Lines> {
  const tag = "[ffa]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await fill(url, "ffa_test", 2);
  try {
    const [a, b] = rooms;
    await waitFor(() => count(state(a).players) === 2, 2000);
    await sleep(300);
    ok(
      state(a).mode === "ffa" && state(a).mapId === "crossroads" && state(a).phase === "waiting" && state(a).countdown === 0,
      `two players wait, no countdown (mode ${state(a).mode}, map ${state(a).mapId}, countdown ${state(a).countdown})`,
    );
    const c = await new Client(url).joinById(a.roomId);
    rooms.push(c);
    c.reconnection.minUptime = 0;
    const counting = await waitFor(() => state(a).countdown > 0, 1000);
    ok(counting && state(a).phase === "waiting", `the third player starts the countdown (${state(a).countdown} ticks)`);
    const started = await waitFor(() => state(a).phase === "playing", 3000);
    ok(started, "the countdown ends and the match starts");
    const room = local(a.roomId);
    const spots = new Set([...room.state.players.values()].map((p) => `${p.x},${p.z}`));
    const onSpawns = [...room.state.players.values()].every((p) => CROSSROADS.spawns.some((s) => s.x === p.x && s.z === p.z));
    ok(spots.size === 3 && onSpawns, `the three start on three different spawns (${[...spots].join(" ")})`);
    ok(!anyoneSeesAnyone(room), "no one starts in anyone else's sight (ffaStartSpawns)");
    const slots = [...room.state.players.values()].map((p) => p.slot).sort();
    ok(slots.join(",") === "0,1,2", `seats 0, 1 and 2 (${slots.join(",")})`);

    // A 4th drops in mid-match, out of everyone's sight.
    const d = await new Client(url).joinById(a.roomId);
    rooms.push(d);
    await waitFor(() => !!room.state.players.get(d.sessionId), 2000);
    const joiner = room.state.players.get(d.sessionId)!;
    const others = [...room.state.players.entries()].filter(([id, p]) => id !== d.sessionId && p.alive);
    const seen = others.filter(([, p]) => bodiesSee(CROSSROADS, joiner, p)).length;
    ok(
      room.state.phase === "playing" && joiner.alive && joiner.slot === 3 && seen === 0,
      `a 4th player drops in mid-match on seat 3, seen by ${seen} of ${others.length} (at ${joiner.x}, ${joiner.z})`,
    );

    // Kill credit goes to the killing blow: B hurts C, A finishes C.
    const cp = room.state.players.get(c.sessionId)!;
    room.damage(b.sessionId, c.sessionId, cp, 60, 0);
    room.damage(a.sessionId, c.sessionId, cp, 60, 2);
    await waitFor(() => (state(a).players.get(a.sessionId)?.kills ?? 0) === 1, 1000);
    const pa = room.state.players.get(a.sessionId)!;
    const pb = room.state.players.get(b.sessionId)!;
    const last = room.state.feed.at(-1);
    ok(
      pa.kills === 1 && pb.kills === 0 && cp.deaths === 1,
      `the killing blow gets the kill, not the first damage (A ${pa.kills}, B ${pb.kills}, C deaths ${cp.deaths})`,
    );
    ok(
      !!last && last.killer === a.sessionId && last.victim === c.sessionId && last.weapon === 2 && last.killerName === pa.name,
      `the kill feed says A killed C with the sniper (${JSON.stringify(last)})`,
    );
    const clientFeed: KillView[] = [];
    await waitFor(() => (state(b).feed?.length ?? 0) > 0, 1000);
    state(b).feed.forEach((k) => clientFeed.push(k));
    ok(clientFeed.some((k) => k.victim === c.sessionId), "the feed is synced to the other clients");

    // A self-kill with a real grenade: D at 5 HP throws at its own feet.
    const dp = room.state.players.get(d.sessionId)!;
    dp.hp = 5;
    const killsBefore = [...room.state.players.values()].map((p) => p.kills).join(",");
    let seq = 0;
    const send = (grenade: number) => {
      const input: InputMessage = { seq: ++seq, mx: 0, mz: 0, aim: 0, fire: false, gx: dp.x, gz: dp.z, dash: 0, grenade, shield: 0, reload: 0 };
      d.send(MSG_INPUT, input);
    };
    send(0); // baseline
    await sleep(TICK_MS * 3);
    const timer = setInterval(() => send(1), TICK_MS);
    const died = await waitFor(() => !dp.alive, (GRENADE.fuse + 1.5) * 1000);
    clearInterval(timer);
    const killsAfter = [...room.state.players.values()].map((p) => p.kills).join(",");
    const selfLine = room.state.feed.at(-1);
    ok(
      died && dp.deaths === 1 && killsAfter === killsBefore && dp.kills === 0,
      `a self-kill (own grenade) counts a death and credits no one, no kill taken away (kills ${killsBefore} -> ${killsAfter})`,
    );
    ok(
      !!selfLine && selfLine.killer === "" && selfLine.victim === d.sessionId && selfLine.weapon === KILL_GRENADE,
      `the feed shows it as a self-kill by grenade (${JSON.stringify(selfLine)})`,
    );
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** The real "ffa" room type: the 10 s countdown, and the open games list (mode, seats, in progress). */
async function listing(url: string): Promise<Lines> {
  const tag = "[ffa games]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const listed = async (id: string) =>
    ((await (await fetch(`${url}${GAMES_ROUTE}`)).json()) as { games: OpenGame[] }).games.find((g) => g.roomId === id);
  const rooms = await fill(url, FFA_ROOM_NAME, 1);
  try {
    const first = await listed(rooms[0].roomId);
    ok(
      !!first && first.mode === "ffa" && first.players === 1 && first.maxPlayers === FFA_MAX_PLAYERS && first.phase === "waiting",
      `GET /games lists a waiting FFA with its seats: ${JSON.stringify(first)}`,
    );
    for (let i = 0; i < 2; i++) rooms.push(await new Client(url).joinById(rooms[0].roomId));
    await waitFor(() => state(rooms[0]).countdown > 0, 1000);
    const secs = state(rooms[0]).countdown / TICK_RATE;
    ok(Math.abs(secs - FFA_COUNTDOWN) < 0.2, `three in: a ${FFA_COUNTDOWN} s countdown (${secs.toFixed(2)} s)`);
    const started = await waitFor(() => state(rooms[0]).phase === "playing", (FFA_COUNTDOWN + 2) * 1000);
    const playing = await listed(rooms[0].roomId);
    ok(
      started && !!playing && playing.phase === "playing" && playing.players === 3,
      `a running FFA stays listed, 3/6, in progress (players drop in): ${JSON.stringify(playing)}`,
    );
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** Below 3 before the start, the countdown stops. */
async function countdownCancel(url: string): Promise<Lines> {
  const tag = "[ffa countdown]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await fill(url, "ffa_cancel", 3);
  try {
    const counting = await waitFor(() => state(rooms[0]).countdown > 0, 1500);
    await rooms[2].leave();
    const cancelled = await waitFor(() => state(rooms[0]).countdown === 0, 1000);
    await sleep(3500);
    ok(
      counting && cancelled && state(rooms[0]).phase === "waiting",
      `the countdown stops when a player leaves before the start (still ${state(rooms[0]).phase})`,
    );
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** Dropping below 2 players mid-match ends the match. */
async function tooFewLeft(url: string): Promise<Lines> {
  const tag = "[ffa]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await fill(url, "ffa_test", 3);
  try {
    const [a, b, c] = rooms;
    await waitFor(() => state(a).phase === "playing", 3000);
    await kill(a.roomId, a.sessionId, b.sessionId);
    await c.leave();
    await sleep(300);
    const stillOn = state(a).phase === "playing";
    await b.leave();
    const ended = await waitFor(() => state(a).phase === "ended", 1000);
    ok(stillOn && ended && state(a).winner === a.sessionId, `two left play on; one left ends the match, the last one wins (${state(a).phase})`);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** Six seats: the 7th client is refused a seat, and quick match sends it to another room. */
async function seatCap(url: string): Promise<Lines> {
  const tag = "[ffa seats]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await fill(url, "ffa_seats", FFA_MAX_PLAYERS);
  let extra: Room | null = null;
  try {
    const room = local(rooms[0].roomId);
    await waitFor(() => room.state.players.size === FFA_MAX_PLAYERS, 2000);
    ok(
      room.maxClients === FFA_MAX_PLAYERS + SPECTATOR_ROOM,
      `maxClients (${room.maxClients}) is not the player cap: ${SPECTATOR_ROOM} clients of room are left for spectators`,
    );
    let refused = "";
    try {
      const r = await new Client(url).joinById(rooms[0].roomId);
      await r.leave();
    } catch (err) {
      refused = String((err as Error).message ?? err);
    }
    ok(/locked|full/i.test(refused) && room.state.players.size === FFA_MAX_PLAYERS, `a 7th client can't take a seat by id (${refused})`);
    extra = await new Client(url).joinOrCreate("ffa_seats");
    ok(extra.roomId !== rooms[0].roomId, "quick match puts a 7th player in another room");
    // A seat frees: the room opens again.
    await rooms[5].leave();
    const reopened = await waitFor(() => !room.locked, 1000);
    const back = await new Client(url).joinById(rooms[0].roomId).catch(() => null);
    ok(reopened && !!back, "a freed seat can be taken again");
    if (back) rooms[5] = back;
  } finally {
    await leaveAll(extra ? [...rooms, extra] : rooms);
  }
  return lines;
}

/** Reconnection with 3 players: same seat, score and weapon, the others keep playing. */
async function reconnect(url: string): Promise<Lines> {
  const tag = "[ffa reconnect]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await fill(url, "ffa_test", 3);
  try {
    const [a, b, c] = rooms;
    await waitFor(() => state(a).phase === "playing", 3000);
    await kill(a.roomId, c.sessionId, b.sessionId);
    await waitFor(() => me(c)?.kills === 1, 1000);
    const before = JSON.stringify({ slot: me(c)!.slot, kills: me(c)!.kills });
    const events: string[] = [];
    c.onDrop(() => events.push("drop"));
    c.onReconnect(() => events.push("reconnect"));
    local(a.roomId).clients.find((x) => x.sessionId === c.sessionId)?.ref.terminate();
    const seen = await waitFor(() => state(a).players.get(c.sessionId)?.connected === false, 2000);
    ok(seen && state(a).phase === "playing", "a dropped player shows as not connected, the match goes on");
    const back = await waitFor(() => events.includes("reconnect"), 8000);
    await waitFor(() => state(a).players.get(c.sessionId)?.connected === true, 2000);
    const after = JSON.stringify({ slot: me(c)!.slot, kills: me(c)!.kills });
    ok(back && after === before && count(state(a).players) === 3, `back with the same seat and score (${after})`);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** The time limit: most kills wins; a tie goes to sudden death, the next kill wins. */
async function timeLimit(url: string): Promise<Lines> {
  const tag = "[ffa time]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await fill(url, "ffa_timed", 3);
  try {
    const [a, b, c] = rooms;
    await waitFor(() => state(a).phase === "playing", 3000);
    ok(state(a).timeLimit === 3, `the room has a 3 s time limit (${state(a).timeLimit})`);
    await kill(a.roomId, a.sessionId, c.sessionId);
    await kill(a.roomId, a.sessionId, c.sessionId);
    await kill(a.roomId, b.sessionId, c.sessionId);
    const ended = await waitFor(() => state(a).phase === "ended", 5000);
    ok(ended && state(a).winner === a.sessionId, `the time runs out: most kills wins (winner is A: ${state(a).winner === a.sessionId})`);

    // Rematch (3 still in, new match right after the result) on another
    // FFA map, then a tie at the limit.
    const firstMap = state(a).mapId;
    await waitFor(() => state(a).phase === "playing", 12_000);
    const secondMap = state(a).mapId;
    ok(
      secondMap !== firstMap && FFA_MAPS.some((m) => m.id === secondMap) && FFA_MAPS.some((m) => m.id === firstMap),
      `the rematch is on another FFA map, never a duel map (${firstMap} -> ${secondMap})`,
    );
    await kill(a.roomId, a.sessionId, c.sessionId);
    await kill(a.roomId, b.sessionId, c.sessionId);
    const sudden = await waitFor(() => state(a).suddenDeath, 5000);
    ok(sudden && state(a).phase === "playing", "a tie at the time limit goes to sudden death");
    await kill(a.roomId, b.sessionId, c.sessionId);
    const over = await waitFor(() => state(a).phase === "ended", 1000);
    ok(over && state(a).winner === b.sessionId, "sudden death: the next kill that breaks the tie wins");
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** First to 15 with three account players: the placements are recorded, with the stats. */
async function firstTo15(url: string, h: AccountsHarness): Promise<Lines> {
  const tag = "[ffa accounts]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const accounts = await Promise.all([1, 2, 3].map((i) => h.account(`FfaPlayer${i}`)));
  const ids = accounts.map((a) => a.id);
  const clients = accounts.map(({ token }) => {
    const cl = new Client(url);
    cl.auth.token = token;
    return cl;
  });
  const first = await clients[0].create("ffa_test");
  const rooms = [first, await clients[1].joinById(first.roomId), await clients[2].joinById(first.roomId)];
  const recordedBefore = h.recorded.length;
  try {
    const [a, b, c] = rooms;
    await waitFor(() => state(a).phase === "playing", 3000);
    await kill(a.roomId, b.sessionId, c.sessionId);
    await kill(a.roomId, b.sessionId, a.sessionId);
    await kill(a.roomId, c.sessionId, a.sessionId);
    for (let k = 0; k < FFA_KILLS_TO_WIN; k++) await kill(a.roomId, a.sessionId, k % 2 ? b.sessionId : c.sessionId);
    const ended = await waitFor(() => state(a).phase === "ended", 1000);
    ok(ended && state(a).winner === a.sessionId && me(a)?.kills === FFA_KILLS_TO_WIN, `first to ${FFA_KILLS_TO_WIN} ends the match (A ${me(a)?.kills})`);
    await waitFor(() => h.recorded.length > recordedBefore, 3000);
    const rec = h.recorded[recordedBefore];
    const place = (id: string) => rec?.players.find((p) => p.userId === id);
    // A: 15 kills. B: 2 kills, 8 deaths. C: 1 kill, 8 deaths.
    ok(
      !!rec &&
        rec.players.length === 3 &&
        place(ids[0])?.place === 1 && place(ids[0])?.won === true &&
        place(ids[1])?.place === 2 && place(ids[1])?.won === false &&
        place(ids[2])?.place === 3 && place(ids[2])?.won === false,
      `the recorded match has the places 1, 2, 3; only first place is a win (${JSON.stringify(rec?.players)})`,
    );
    // The hook fires before the write: give it a moment.
    let row = rec ? await h.matchRow(rec.matchId) : null;
    for (let i = 0; i < 50 && rec && !row; i++) {
      await sleep(50);
      row = await h.matchRow(rec.matchId);
    }
    ok(
      row?.mode === "ffa" && row.placements?.map((p) => p.place).sort().join(",") === "1,2,3",
      `the match row keeps the mode and the placements (${JSON.stringify({ mode: row?.mode, placements: row?.placements })})`,
    );
    const p1 = await h.stats("FfaPlayer1");
    const p2 = await h.stats("FfaPlayer2");
    ok(
      p1?.wins === 1 && p1.losses === 0 && p2?.wins === 0 && p2.losses === 1,
      `stats: 1st is a win, 2nd a loss (${JSON.stringify(p1)}, ${JSON.stringify(p2)})`,
    );
    // The rematch moves to... the same map here (the room is pinned), with everyone reset.
    const again = await waitFor(() => state(a).phase === "playing", 12_000);
    ok(again && me(a)?.kills === 0 && state(a).feed.length === 0, "after the result, a rematch starts in the same room, scores reset");
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/**
 * A tie for the most kills that sudden death doesn't break (its cap runs
 * out): the tiebreaks pick one winner. `setup` plays the match; `expect`
 * names the winner and the reason. The places must be 1, 2, 3, synced.
 */
async function tiebreak(
  url: string,
  label: string,
  setup: (roomId: string, a: Room, b: Room, c: Room) => Promise<void>,
  expect: (a: Room, b: Room, c: Room, matchId: string) => { winner: string; reason: string },
): Promise<Lines> {
  const tag = `[ffa tiebreak ${label}]`;
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await fill(url, "ffa_tie", 3);
  try {
    const [a, b, c] = rooms;
    await waitFor(() => state(a).phase === "playing", 3000);
    const room = local(a.roomId);
    await setup(a.roomId, a, b, c);
    const sudden = await waitFor(() => room.state.suddenDeath, 4000);
    const ended = await waitFor(() => room.state.phase === "ended", 3000);
    const want = expect(a, b, c, room.matchId);
    ok(sudden && ended, `the tie goes to sudden death, whose cap runs out (phase ${room.state.phase})`);
    ok(
      room.state.winner === want.winner && room.state.tiebreak === want.reason,
      `one winner, on "${want.reason}" (winner ${rooms.findIndex((r) => r.sessionId === room.state.winner)}, reason "${room.state.tiebreak}")`,
    );
    await waitFor(() => state(a).tiebreak === want.reason && (state(a).players.get(want.winner)?.place ?? 0) === 1, 1000);
    const places = rooms.map((r) => state(a).players.get(r.sessionId)?.place ?? 0);
    ok(
      [...places].sort().join(",") === "1,2,3" && state(a).winner === want.winner && state(a).tiebreak === want.reason,
      `the clients get unique places, the winner 1st, and the reason (${places.join(",")}, "${state(a).tiebreak}")`,
    );
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** Hurts `victim` by `attacker` without killing (the victim alive first). */
async function hurt(roomId: string, attacker: string, victim: string, amount: number) {
  const room = local(roomId);
  await waitFor(() => !!room.state.players.get(victim)?.alive, 5000);
  room.damage(attacker, victim, room.state.players.get(victim), amount, 0);
}

/** The winner `rank` predicts from the match id alone (everyone level: the lot). */
const lotWinner = (rooms: Room[], matchId: string) =>
  rank(rooms.map((r) => ({ id: r.sessionId, kills: 0, damage: 0, reachedAt: 0 })), matchId).order[0].entry.id;

const tiebreaks = (url: string) => [
  // 1-1: A has dealt 30 more damage.
  tiebreak(
    url,
    "damage",
    async (id, a, b, c) => {
      await kill(id, b.sessionId, c.sessionId);
      await kill(id, a.sessionId, c.sessionId);
      await hurt(id, a.sessionId, c.sessionId, 30);
    },
    (a) => ({ winner: a.sessionId, reason: "damage" }),
  ),
  // 1-1, same damage: B got there first.
  tiebreak(
    url,
    "first",
    async (id, a, b, c) => {
      await kill(id, b.sessionId, c.sessionId);
      await kill(id, a.sessionId, c.sessionId);
    },
    (_a, b) => ({ winner: b.sessionId, reason: "first" }),
  ),
  // 0-0-0, nobody hurt: the lot, from the match id.
  tiebreak(
    url,
    "lot",
    async () => {},
    (a, b, c, matchId) => ({ winner: lotWinner([a, b, c], matchId), reason: "lot" }),
  ),
];

/** Every FFA scenario, in parallel. Registers nothing: call `registerFfaRooms` first. */
export async function ffaChecks(url: string, h: AccountsHarness): Promise<Lines[]> {
  const results = await Promise.allSettled([
    startAndDropIn(url),
    listing(url),
    countdownCancel(url),
    tooFewLeft(url),
    seatCap(url),
    reconnect(url),
    timeLimit(url),
    firstTo15(url, h),
    ...tiebreaks(url),
  ]);
  return results.map((r) =>
    r.status === "fulfilled" ? r.value : [[false, `[ffa] scenario crashed: ${r.reason instanceof Error ? r.reason.stack : r.reason}`]],
  );
}

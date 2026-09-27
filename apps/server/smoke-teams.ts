// Team deathmatch checks for the smoke test (see smoke.ts). Every scenario
// runs in its own room type registered by `registerTeamRooms`, pinned to
// Crossroads (West against East) with a 1 s countdown and a short respawn,
// so a scenario takes seconds; the timed one has a 3 s time limit and isn't
// pinned (its rematch moves map).
//
// Kills go through the room's own damage path (`damage`, the one bullets and
// grenades call) like smoke-ffa.ts; the friendly fire checks use real
// bullets and a real grenade, fired by a client's inputs.

import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  GAMES_ROUTE,
  MAX_HP,
  MSG_INPUT,
  MSG_TEAM,
  NO_TEAM,
  SPECTATOR_ROOM,
  TEAM_BLUE,
  TEAM_COUNTDOWN,
  TEAM_KILLS_TO_WIN,
  TEAM_MAPS,
  TEAM_MAX_PLAYERS,
  TEAM_RED,
  TEAM_ROOM_NAME,
  TICK_MS,
  TICK_RATE,
  bodiesSee,
  clearShot,
  findMap,
  teamSpawns,
  type InputMessage,
  type KillView,
  type OpenGame,
  type PlayerView,
  type RoomStateView,
} from "@bagarre/shared";
import { api } from "@bagarre/backend/api";
import { ConvexHttpClient } from "convex/browser";
import { TeamRoom } from "./src/GameRoom.ts";
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

/** What the checks poke at on the server side of a team room. */
type LocalTeam = {
  damage(a: string, t: string, target: unknown, n: number, weapon?: number): void;
  state: {
    players: Map<string, PlayerView>;
    phase: string;
    winner: string;
    winningTeam: number;
    redScore: number;
    blueScore: number;
    countdown: number;
    suddenDeath: boolean;
    mapId: string;
    feed: KillView[];
  };
  clients: { sessionId: string; ref: { terminate(): void } }[];
  maxClients: number;
  locked: boolean;
};
const local = (roomId: string) => matchMaker.getLocalRoomById(roomId) as unknown as LocalTeam;
const teamOf = (room: LocalTeam, id: string) => room.state.players.get(id)?.team ?? -1;
/** Seats on red and blue, server side. */
const sizes = (room: LocalTeam) => {
  const n = [0, 0];
  room.state.players.forEach((p) => (p.team === TEAM_RED || p.team === TEAM_BLUE ? n[p.team]++ : 0));
  return n;
};

/** Room types used below. */
export function registerTeamRooms() {
  const quick = { countdown: 1, respawnDelay: 0.3 };
  const base = TeamRoom.pinnedTo("crossroads").withRules(quick);
  matchMaker.defineRoomType("tdm_test", base);
  matchMaker.defineRoomType("tdm_seats", base);
  // A long countdown: the waiting-room checks happen before it ends.
  matchMaker.defineRoomType("tdm_wait", TeamRoom.pinnedTo("crossroads").withRules({ ...quick, countdown: 30 }));
  matchMaker.defineRoomType("tdm_timed", TeamRoom.withRules({ ...quick, timeLimit: 3 }));
}

async function joinN(url: string, type: string, n: number, opts: Record<string, unknown> = {}): Promise<Room[]> {
  const first = await new Client(url).create(type, opts);
  const rooms = [first];
  for (let i = 1; i < n; i++) rooms.push(await new Client(url).joinById(first.roomId));
  for (const r of rooms) r.reconnection.minUptime = 0;
  return rooms;
}

const leaveAll = (rooms: Room[]) => Promise.all(rooms.map((r) => Promise.race([r.leave().catch(() => {}), sleep(1000)])));

/** Kills `victim` by `killer` through the room's damage path, once the victim is alive. */
async function kill(roomId: string, killer: string, victim: string, weapon = 0) {
  const room = local(roomId);
  await waitFor(() => !!room.state.players.get(victim)?.alive, 5000);
  room.damage(killer, victim, room.state.players.get(victim), MAX_HP, weapon);
}

/** The ids on each team, in join order. */
function byTeam(room: LocalTeam, rooms: Room[]): [Room[], Room[]] {
  return [rooms.filter((r) => teamOf(room, r.sessionId) === TEAM_RED), rooms.filter((r) => teamOf(room, r.sessionId) === TEAM_BLUE)];
}

/** Is (x, z) one of that team's own spawns on Crossroads? */
const onOwnSide = (p: PlayerView) => teamSpawns(CROSSROADS, p.team).some((s) => s.x === p.x && s.z === p.z);
/** Enemies (living, other team) who can see `p`. */
const enemiesSeeing = (room: LocalTeam, id: string) => {
  const p = room.state.players.get(id)!;
  return [...room.state.players.entries()].filter(([oid, o]) => oid !== id && o.alive && o.team !== p.team && bodiesSee(CROSSROADS, p, o)).length;
};

/** Joining fills the smaller team, a switch is refused when it would unbalance, the countdown needs 2v2, starts on each side. */
async function balanceAndStart(url: string): Promise<Lines> {
  const tag = "[tdm]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await joinN(url, "tdm_test", 3);
  try {
    const [a, b, c] = rooms;
    const room = local(a.roomId);
    await waitFor(() => room.state.players.size === 3, 2000);
    const teams = rooms.map((r) => teamOf(room, r.sessionId));
    ok(teams.join(",") === "0,1,0", `joins fill the smaller team: red, blue, red (${teams.join(",")})`);
    await sleep(300);
    ok(
      state(a).mode === "tdm" && state(a).phase === "waiting" && state(a).countdown === 0,
      `2v1 waits with no countdown (mode ${state(a).mode}, countdown ${state(a).countdown})`,
    );
    ok(rooms.every((r) => onOwnSide(room.state.players.get(r.sessionId)!)), "waiting players stand on their own side's spawns");

    // B alone on blue can't go red (3v0); A can go blue (1v2), and back.
    b.send(MSG_TEAM, { team: TEAM_RED });
    await sleep(300);
    ok(teamOf(room, b.sessionId) === TEAM_BLUE, `a switch that would unbalance (2v1 -> 3v0) is refused (B on ${teamOf(room, b.sessionId)})`);
    a.send(MSG_TEAM, { team: 2 });
    a.send(MSG_TEAM, { team: "1" });
    a.send(MSG_TEAM, {});
    await sleep(300);
    ok(teamOf(room, a.sessionId) === TEAM_RED, "malformed team messages are dropped");
    a.send(MSG_TEAM, { team: TEAM_BLUE });
    const moved = await waitFor(() => teamOf(room, a.sessionId) === TEAM_BLUE, 1000);
    const pa = room.state.players.get(a.sessionId)!;
    ok(moved && onOwnSide(pa), `a switch that keeps the teams within one (2v1 -> 1v2) goes through, onto the new side (${pa.x}, ${pa.z})`);
    await waitFor(() => state(a).players.get(a.sessionId)?.team === TEAM_BLUE, 1000);
    ok(state(c).players.get(a.sessionId)?.team === TEAM_BLUE, "the new team is synced to the others");
    a.send(MSG_TEAM, { team: TEAM_RED });
    await waitFor(() => teamOf(room, a.sessionId) === TEAM_RED, 1000);

    // A 4th: red and blue are 2 and 1, so blue. 2v2: the countdown.
    const d = await new Client(url).joinById(a.roomId);
    rooms.push(d);
    d.reconnection.minUptime = 0;
    await waitFor(() => room.state.players.has(d.sessionId), 2000);
    ok(teamOf(room, d.sessionId) === TEAM_BLUE, `the 4th player goes to the smaller team (${teamOf(room, d.sessionId)})`);
    const counting = await waitFor(() => state(a).countdown > 0, 1000);
    ok(counting && state(a).phase === "waiting", `2v2 starts the countdown (${state(a).countdown} ticks)`);
    // In a 2v2 no switch keeps the teams within one.
    d.send(MSG_TEAM, { team: TEAM_RED });
    await sleep(200);
    ok(teamOf(room, d.sessionId) === TEAM_BLUE, "2v2: a switch (to 3v1) is refused");
    const started = await waitFor(() => state(a).phase === "playing", 3000);
    ok(started, "the countdown ends and the match starts");
    const all = [...room.state.players.entries()];
    ok(all.every(([, p]) => onOwnSide(p)), `each team starts on its own side (${all.map(([, p]) => `${p.team}@${p.x},${p.z}`).join(" ")})`);
    ok(all.every(([id]) => enemiesSeeing(room, id) === 0), "no one starts in an enemy's sight");
    ok(state(a).redScore === 0 && state(a).blueScore === 0 && state(a).killsToWin === TEAM_KILLS_TO_WIN, `the score starts at 0-0, first to ${state(a).killsToWin}`);
    // Mid-match, switching is refused.
    c.send(MSG_TEAM, { team: TEAM_BLUE });
    await sleep(200);
    ok(teamOf(room, c.sessionId) === TEAM_RED, "a switch mid-match is refused");
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/**
 * No friendly fire. A red player fires down a clear lane with a teammate in
 * front and an enemy behind: the bullets fly through the teammate and hit
 * the enemy. Then a grenade at the feet of the thrower and a teammate, with
 * an enemy in the blast too, and the damage hook between teammates.
 */
async function friendlyFire(url: string): Promise<Lines> {
  const tag = "[tdm fire]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await joinN(url, "tdm_test", 4);
  try {
    const room = local(rooms[0].roomId);
    await waitFor(() => room.state.phase === "playing", 4000);
    const [[a, b], [c, d]] = byTeam(room, rooms);
    const P = (r: Room) => room.state.players.get(r.sessionId)!;
    // A lane in the Square, south of the clock tower.
    const place = (r: Room, x: number, z: number) => {
      const p = P(r);
      p.x = x;
      p.z = z;
    };
    place(a, -7, 2.8);
    place(b, -3.5, 2.8);
    place(c, 1, 2.8);
    place(d, 8, -8);
    ok(clearShot(CROSSROADS, P(a), P(c)), "the lane from A to C is clear (test setup)");

    let seq = 0;
    const input = (patch: Partial<InputMessage>): InputMessage => ({
      seq: ++seq, mx: 0, mz: 0, aim: 0, fire: false, gx: P(a).x, gz: P(a).z, dash: 0, grenade: 0, shield: 0, reload: 0, ...patch,
    });
    a.send(MSG_INPUT, input({})); // baseline
    await sleep(TICK_MS * 3);
    const timer = setInterval(() => a.send(MSG_INPUT, input({ fire: true, aim: 0 })), TICK_MS);
    const cHurt = await waitFor(() => P(c).hp < MAX_HP, 2000);
    clearInterval(timer);
    await sleep(300);
    ok(
      cHurt && P(b).hp === MAX_HP && P(b).alive,
      `bullets fly through a teammate (B ${P(b).hp} HP) and hit the enemy behind (C ${P(c).hp} HP)`,
    );
    ok(P(a).hits > 0 && P(a).damage > 0, `only hits on the enemy count (A: ${P(a).hits} hits, ${P(a).damage} damage)`);

    // A grenade at A's own feet, B next to it, C in the blast too.
    for (const r of [a, b, c]) {
      P(r).hp = MAX_HP;
      P(r).alive = true;
    }
    place(a, -7, 2.8);
    place(b, -6, 2.8);
    place(c, -7, 4.3);
    const before = { a: P(a).hp, b: P(b).hp };
    a.send(MSG_INPUT, input({ grenade: 1, gx: -6.5, gz: 2.8 }));
    const cBlasted = await waitFor(() => P(c).hp < MAX_HP, 3000);
    ok(
      cBlasted && P(a).hp === before.a && P(b).hp === before.b,
      `a grenade hurts the enemy (C ${P(c).hp} HP) but not the thrower (A ${P(a).hp}) nor a teammate (B ${P(b).hp})`,
    );

    // The damage path itself refuses a teammate, and yourself.
    room.damage(a.sessionId, b.sessionId, P(b), MAX_HP, 0);
    room.damage(a.sessionId, a.sessionId, P(a), MAX_HP, 0);
    ok(P(b).alive && P(b).hp === MAX_HP && P(a).alive && P(a).hp === MAX_HP, "damage between teammates, or to yourself, does nothing");
    ok(state(a).redScore === 0 && state(a).blueScore === 0, `no kill came of it (${state(a).redScore}-${state(a).blueScore})`);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** Kills count for the team; respawns on your own side out of enemy sight; reconnecting keeps the team. */
async function creditRespawnReconnect(url: string): Promise<Lines> {
  const tag = "[tdm]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await joinN(url, "tdm_test", 4);
  try {
    const room = local(rooms[0].roomId);
    await waitFor(() => room.state.phase === "playing", 4000);
    const [[a, b], [c, d]] = byTeam(room, rooms);
    await kill(a.roomId, a.sessionId, c.sessionId);
    await kill(a.roomId, b.sessionId, d.sessionId);
    await kill(a.roomId, d.sessionId, a.sessionId);
    await waitFor(() => state(c).redScore === 2 && state(c).blueScore === 1, 1000);
    ok(
      room.state.redScore === 2 && room.state.blueScore === 1 && room.state.players.get(a.sessionId)!.kills === 1,
      `kills count for the killer's team (red ${room.state.redScore}, blue ${room.state.blueScore})`,
    );
    const line = room.state.feed.at(-1);
    ok(
      !!line && line.killerTeam === TEAM_BLUE && line.victimTeam === TEAM_RED,
      `the kill feed carries the teams (${line?.killerTeam} killed ${line?.victimTeam})`,
    );

    // Respawns: five in a row, each on the victim's own side, out of every living enemy's sight.
    const where: string[] = [];
    let good = 0;
    for (let i = 0; i < 5; i++) {
      const victim = i % 2 ? d : c;
      await kill(a.roomId, a.sessionId, victim.sessionId);
      await waitFor(() => !!room.state.players.get(victim.sessionId)?.alive, 3000);
      const p = room.state.players.get(victim.sessionId)!;
      where.push(`${p.x},${p.z}`);
      if (onOwnSide(p) && enemiesSeeing(room, victim.sessionId) === 0) good++;
    }
    ok(good === 5, `respawns are on the team's own side, out of enemy sight (${good}/5: ${where.join(" ")})`);

    // Reconnect: same team, same seat.
    const before = JSON.stringify({ team: teamOf(room, c.sessionId), slot: room.state.players.get(c.sessionId)!.slot });
    const events: string[] = [];
    c.onReconnect(() => events.push("reconnect"));
    room.clients.find((x) => x.sessionId === c.sessionId)?.ref.terminate();
    await waitFor(() => room.state.players.get(c.sessionId)?.connected === false, 2000);
    const back = await waitFor(() => events.includes("reconnect"), 8000);
    await waitFor(() => room.state.players.get(c.sessionId)?.connected === true, 2000);
    const after = JSON.stringify({ team: teamOf(room, c.sessionId), slot: room.state.players.get(c.sessionId)!.slot });
    ok(back && after === before, `a reconnect keeps the team and the seat (${after})`);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** Drop-in up to 4v4 (the newcomer on the smaller team, on its side), a 9th refused, and a team leaving ends it. */
async function dropInAndCap(url: string): Promise<Lines> {
  const tag = "[tdm seats]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await joinN(url, "tdm_seats", 4);
  try {
    const room = local(rooms[0].roomId);
    await waitFor(() => room.state.phase === "playing", 4000);
    ok(room.maxClients === TEAM_MAX_PLAYERS + SPECTATOR_ROOM, `maxClients ${room.maxClients}: 8 seats plus room for spectators`);
    // Blue ahead: on a size tie, the newcomer helps red, the side behind.
    const [[a], [c]] = byTeam(room, rooms);
    await kill(rooms[0].roomId, c.sessionId, a.sessionId);
    const fifth = await new Client(url).joinById(rooms[0].roomId);
    rooms.push(fifth);
    await waitFor(() => room.state.players.has(fifth.sessionId), 2000);
    const p5 = room.state.players.get(fifth.sessionId)!;
    ok(
      room.state.phase === "playing" && p5.team === TEAM_RED && onOwnSide(p5) && enemiesSeeing(room, fifth.sessionId) === 0,
      `a 5th drops in mid-match on the team behind (red), on its side, out of enemy sight (team ${p5.team} at ${p5.x}, ${p5.z})`,
    );
    for (let i = 0; i < 3; i++) rooms.push(await new Client(url).joinById(rooms[0].roomId));
    await waitFor(() => room.state.players.size === 8, 2000);
    ok(sizes(room).join("v") === "4v4", `eight players are 4v4 (${sizes(room).join("v")})`);
    let refused = "";
    try {
      const r = await new Client(url).joinById(rooms[0].roomId);
      await r.leave();
    } catch (err) {
      refused = String((err as Error).message ?? err);
    }
    ok(/locked|full/i.test(refused) && room.state.players.size === 8, `a 9th player is refused (${refused})`);

    // Every blue player leaves: red wins, whatever the score (blue was ahead).
    const blue = byTeam(room, rooms)[1];
    for (const r of blue) await r.leave();
    const ended = await waitFor(() => room.state.phase === "ended", 1000);
    ok(ended && room.state.winningTeam === TEAM_RED && room.state.winner === "", `a team with nobody left loses (winner team ${room.state.winningTeam})`);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** Before the start, leaves that unbalance the teams are evened out. */
async function rebalanceOnLeave(url: string): Promise<Lines> {
  const tag = "[tdm wait]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await joinN(url, "tdm_wait", 5);
  try {
    const room = local(rooms[0].roomId);
    await waitFor(() => room.state.players.size === 5, 2000);
    ok(sizes(room).join("v") === "3v2", `five join as 3v2 (${sizes(room).join("v")})`);
    const [, blue] = byTeam(room, rooms);
    for (const r of blue) await r.leave();
    await waitFor(() => room.state.players.size === 3, 2000);
    await sleep(200);
    const last = rooms[4];
    ok(
      sizes(room).join("v") === "2v1" && teamOf(room, last.sessionId) === TEAM_BLUE && onOwnSide(room.state.players.get(last.sessionId)!),
      `3v0 after blue left is evened out to 2v1, the latest red joiner moving to blue (${sizes(room).join("v")})`,
    );
    ok(room.state.countdown === 0, "2v1: no countdown");
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** The time limit: the team ahead wins; a tie goes to sudden death, the next team kill wins. */
async function timeLimit(url: string): Promise<Lines> {
  const tag = "[tdm time]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const rooms = await joinN(url, "tdm_timed", 4);
  try {
    const room = local(rooms[0].roomId);
    await waitFor(() => room.state.phase === "playing", 4000);
    ok(state(rooms[0]).timeLimit === 3 && TEAM_MAPS.some((m) => m.id === room.state.mapId), `a 3 s limit on a team map (${room.state.mapId})`);
    let [[a], [c]] = byTeam(room, rooms);
    await kill(a.roomId, a.sessionId, c.sessionId);
    await kill(a.roomId, a.sessionId, c.sessionId);
    await kill(a.roomId, c.sessionId, a.sessionId);
    const ended = await waitFor(() => room.state.phase === "ended", 5000);
    ok(ended && room.state.winningTeam === TEAM_RED, `the time runs out: the team ahead wins (2-1, winner team ${room.state.winningTeam})`);

    const firstMap = room.state.mapId;
    await waitFor(() => room.state.phase === "playing", 12_000);
    ok(room.state.mapId !== firstMap && TEAM_MAPS.some((m) => m.id === room.state.mapId), `the rematch is on another team map (${firstMap} -> ${room.state.mapId})`);
    ok(room.state.redScore === 0 && room.state.blueScore === 0 && room.state.winningTeam === NO_TEAM, "the rematch starts at 0-0");
    [[a], [c]] = byTeam(room, rooms);
    await kill(a.roomId, a.sessionId, c.sessionId);
    await kill(a.roomId, c.sessionId, a.sessionId);
    const sudden = await waitFor(() => room.state.suddenDeath, 5000);
    ok(sudden && room.state.phase === "playing", "a tie at the time limit goes to sudden death");
    await kill(a.roomId, c.sessionId, a.sessionId);
    const over = await waitFor(() => room.state.phase === "ended", 1000);
    ok(over && room.state.winningTeam === TEAM_BLUE, `sudden death: the next team kill wins (winner team ${room.state.winningTeam})`);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** The real "tdm" room type: listed with its mode and team counts, the 10 s countdown at 2v2. */
async function listing(url: string): Promise<Lines> {
  const tag = "[tdm games]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const listed = async (id: string) =>
    ((await (await fetch(`${url}${GAMES_ROUTE}`)).json()) as { games: OpenGame[] }).games.find((g) => g.roomId === id);
  const rooms = await joinN(url, TEAM_ROOM_NAME, 3);
  try {
    await waitFor(() => (local(rooms[0].roomId)?.state.players.size ?? 0) === 3, 2000);
    await sleep(100);
    const g = await listed(rooms[0].roomId);
    ok(
      !!g && g.mode === "tdm" && g.players === 3 && g.maxPlayers === TEAM_MAX_PLAYERS && g.teams?.join("v") === "2v1" && g.joinable,
      `GET /games lists a team game with its mode and team counts: ${JSON.stringify(g)}`,
    );
    rooms.push(await new Client(url).joinById(rooms[0].roomId));
    await waitFor(() => state(rooms[0]).countdown > 0, 1500);
    const secs = state(rooms[0]).countdown / TICK_RATE;
    ok(Math.abs(secs - TEAM_COUNTDOWN) < 0.2, `2v2: a ${TEAM_COUNTDOWN} s countdown (${secs.toFixed(2)} s)`);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** First to 25 with four account players: the winners reach matches.record (convex-test), with the teams. */
async function firstTo25(url: string, h: AccountsHarness): Promise<Lines> {
  const tag = "[tdm accounts]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const ids = ["user_tdm_1", "user_tdm_2", "user_tdm_3", "user_tdm_4"];
  for (const [i, sub] of ids.entries()) await h.t.withIdentity({ subject: sub }).mutation(api.users.claimUsername, { username: `TdmPlayer${i + 1}` });
  const clients = await Promise.all(
    ids.map(async (sub) => {
      const cl = new Client(url);
      cl.auth.token = await h.sign(sub);
      return cl;
    }),
  );
  const first = await clients[0].create("tdm_test");
  const rooms = [first];
  for (const cl of clients.slice(1)) rooms.push(await cl.joinById(first.roomId));
  const recordedBefore = h.recorded.length;
  try {
    const room = local(first.roomId);
    await waitFor(() => room.state.phase === "playing", 4000);
    const [red, blue] = byTeam(room, rooms);
    await kill(first.roomId, blue[0].sessionId, red[0].sessionId);
    for (let k = 0; k < TEAM_KILLS_TO_WIN; k++) await kill(first.roomId, red[k % 2].sessionId, blue[k % 2].sessionId);
    const ended = await waitFor(() => room.state.phase === "ended", 1000);
    ok(
      ended && room.state.winningTeam === TEAM_RED && room.state.redScore === TEAM_KILLS_TO_WIN && room.state.blueScore === 1,
      `first team to ${TEAM_KILLS_TO_WIN} ends the match (red ${room.state.redScore}, blue ${room.state.blueScore})`,
    );
    await waitFor(() => h.recorded.length > recordedBefore, 3000);
    const rec = h.recorded[recordedBefore];
    const sub = (r: Room) => ids[rooms.indexOf(r)];
    const res = (r: Room) => rec?.players.find((p) => p.clerkId === sub(r));
    ok(
      !!rec &&
        rec.players.length === 4 &&
        red.every((r) => res(r)?.won === true && res(r)?.team === TEAM_RED && res(r)?.place === 1) &&
        blue.every((r) => res(r)?.won === false && res(r)?.team === TEAM_BLUE && res(r)?.place === 2),
      `matches.record: a win for each red player, a loss for each blue (${JSON.stringify(rec?.players)})`,
    );
    type Row = { matchId: string; mode?: string; placements?: { clerkId: string; place: number; team?: number }[] };
    // The harness logs the call before convex-test has run it: give the write a moment.
    let row: Row | undefined;
    for (let i = 0; i < 50 && !row; i++) {
      const rows = (await h.t.run(async (ctx) => (ctx.db as unknown as { query(t: string): { collect(): Promise<Row[]> } }).query("recordedMatches").collect())) as Row[];
      row = rows.find((r) => r.matchId === rec?.matchId);
      if (!row) await sleep(50);
    }
    ok(
      row?.mode === "tdm" && row.placements?.filter((p) => p.team === TEAM_RED).length === 2,
      `Convex keeps the mode and the teams (${JSON.stringify({ mode: row?.mode, placements: row?.placements })})`,
    );
    const p1 = await h.t.query(api.users.publicProfile, { username: `TdmPlayer${ids.indexOf(sub(red[0])) + 1}` });
    const p4 = await h.t.query(api.users.publicProfile, { username: `TdmPlayer${ids.indexOf(sub(blue[0])) + 1}` });
    ok(p1?.stats.wins === 1 && p4?.stats.losses === 1, `stats: a red player won, a blue one lost (${JSON.stringify(p1?.stats)}, ${JSON.stringify(p4?.stats)})`);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** matches.record on the live dev deployment accepts a team match (mode "tdm", teams) and refuses a 9th player or a bad team. */
async function liveTeamRecord(): Promise<Lines> {
  const tag = "[tdm live]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const url = process.env.CONVEX_URL;
  const secret = process.env.GAME_SERVER_SECRET;
  if (!url || !secret || secret === "smoke-local-secret") {
    console.log("SKIP  live Convex team check (CONVEX_URL / GAME_SERVER_SECRET not set)");
    return lines;
  }
  const client = new ConvexHttpClient(url);
  const player = (i: number, team: number) => ({ clerkId: `smoke_tdm_${i}`, kills: 3, deaths: 1, won: team === TEAM_RED, place: team === TEAM_RED ? 1 : 2, team });
  const winners = [0, 1, 2, 3].map((i) => player(i, i % 2));
  const matchId = `smoke-tdm:${crypto.randomUUID()}`;
  const first = await client.mutation(api.matches.record, { secret, matchId, mode: "tdm", players: winners });
  ok(first.status === "recorded", `the dev deployment records a team match with the winners and teams (${first.status})`);
  const tooMany = await client
    .mutation(api.matches.record, { secret, matchId: `${matchId}:9`, mode: "tdm", players: Array.from({ length: 9 }, (_, i) => player(i, i % 2)) })
    .then(() => "accepted", (e: unknown) => String((e as { data?: unknown }).data ?? e));
  ok(/at most 8/.test(tooMany), `a team match has at most 8 players (${tooMany})`);
  const badTeam = await client
    .mutation(api.matches.record, { secret, matchId: `${matchId}:t`, mode: "tdm", players: [{ ...player(0, 0), team: 2 }] })
    .then(() => "accepted", (e: unknown) => String((e as { data?: unknown }).data ?? e));
  ok(/Bad team/.test(badTeam), `a team other than 0 or 1 is refused (${badTeam})`);
  return lines;
}

/** Every team scenario, in parallel. Call `registerTeamRooms` first. */
export async function teamChecks(url: string, h: AccountsHarness): Promise<Lines[]> {
  const results = await Promise.allSettled([
    balanceAndStart(url),
    friendlyFire(url),
    creditRespawnReconnect(url),
    dropInAndCap(url),
    rebalanceOnLeave(url),
    timeLimit(url),
    listing(url),
    firstTo25(url, h),
    liveTeamRecord(),
  ]);
  return results.map((r) =>
    r.status === "fulfilled" ? r.value : [[false, `[tdm] scenario crashed: ${r.reason instanceof Error ? r.reason.stack : r.reason}`]],
  );
}

// Spectator checks for the smoke test (see smoke.ts). A spectator is a
// client with no seat: it joins through the watch route (POST
// /games/<id>/watch, past the seat lock of a full room), gets the full state,
// sends nothing that counts, isn't counted anywhere seats are, survives a
// rematch and a map change, can take a free seat, and reconnects like a
// player. The room types are registered by `registerSpectateRooms`: an
// unpinned duel with a 1 s result delay (its rematch moves to another map)
// and a 2 s spectators-only timeout, and an FFA with a 1 s countdown.

import { ClientState, matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  CLOSE_NO_PLAYERS,
    MAX_HP,
  MSG_INPUT,
  MSG_PICK,
  MSG_TAKE_SEAT,
  watchPath,
  type InputMessage,
  type OpenGame,
  type PlayerView,
  type RoomMeta,
  type RoomStateView,
} from "@bagarre/shared";
import { openGames } from "./src/app.ts";
import { DuelRoom, FfaRoom } from "./src/GameRoom.ts";
import { QUICK_WARMUP } from "./smoke-warmup.ts";

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
const state = (room: Room) => room.state as unknown as RoomStateView & { players: Map<string, PlayerView> };

/** What the checks poke at on the server side of a room. */
type LocalRoom = {
  damage(a: string, t: string, target: unknown, n: number, weapon?: number): void;
  state: {
    players: Map<string, PlayerView>;
    bullets: Map<string, unknown>;
    grenades: Map<string, unknown>;
    phase: string;
    mapId: string;
    startTick: number;
    killsToWin: number;
    countdown: number;
    spectators: number;
  };
  clients: { sessionId: string; state: ClientState; ref: { terminate(): void } }[];
  metadata: RoomMeta;
  locked: boolean;
};
const local = (roomId: string) => matchMaker.getLocalRoomById(roomId) as unknown as LocalRoom;

/** Short result delay and spectators-only timeout; not pinned, so the rematch changes map. */
class SpectateDuel extends DuelRoom.withRules({ endDelay: 1, warmup: QUICK_WARMUP }) {
  protected override spectatorIdle = 2;
}

export function registerSpectateRooms() {
  matchMaker.defineRoomType("spec_duel", SpectateDuel);
  matchMaker.defineRoomType("spec_ffa", FfaRoom.pinnedTo("crossroads").withRules({ countdown: 1, respawnDelay: 0.3, warmup: QUICK_WARMUP }));
}

/** Watches a room through the watch route, like the client does. */
async function watch(url: string, roomId: string): Promise<Room> {
  const client = new Client(url);
  const res = await client.http.post(watchPath(roomId), { body: {} });
  const room = await client.consumeSeatReservation(res.data as Parameters<Client["consumeSeatReservation"]>[0]);
  room.reconnection.minUptime = 0;
  return room;
}

/** The open games entry of a room of this file's types (GET /games lists only "duel" and "ffa", through the same function). */
async function listed(roomId: string): Promise<OpenGame | undefined> {
  return (await openGames(["spec_duel", "spec_ffa"])).find((g) => g.roomId === roomId);
}

async function refusal(p: Promise<Room>): Promise<string> {
  try {
    const r = await p;
    await r.leave();
    return "";
  } catch (err) {
    return String((err as Error).message ?? err);
  }
}

const leaveAll = (rooms: (Room | null)[]) =>
  Promise.all(rooms.map((r) => (r ? Promise.race([r.leave().catch(() => {}), sleep(1000)]) : null)));

/** Every SDK event of one room, in order. */
function lifecycle(room: Room) {
  const events: string[] = [];
  room.onDrop((code) => events.push(`drop:${code}`));
  room.onReconnect(() => events.push("reconnect"));
  room.onLeave((code) => events.push(`leave:${code}`));
  return events;
}

const input = (seq: number): InputMessage => ({
  seq,
  mx: 1,
  mz: 0,
  aim: 0,
  fire: true,
  gx: 3,
  gz: 0,
  dash: seq,
  grenade: seq,
  shield: seq,
  reload: 0,
});

/** The whole duel story: watch a full duel, try to play, a kill, a rematch, a free seat, a reconnect, an empty room. */
async function duelStory(url: string): Promise<Lines> {
  const tag = "[spectate duel]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const p1 = await new Client(url).create("spec_duel");
  const p2 = await new Client(url).joinById(p1.roomId);
  const rooms: (Room | null)[] = [p1, p2];
  try {
    const room = local(p1.roomId);
    await waitFor(() => room.state.phase === "playing", 3000);
    const startTick = room.state.startTick;
    ok(room.locked, "a full duel is locked");
    const byId = await refusal(new Client(url).joinById(p1.roomId, { spectate: true }));
    ok(/locked/.test(byId), `joinById can't get into it, even to watch (${byId})`);

    // In through the watch route.
    const s1 = await watch(url, p1.roomId);
    rooms.push(s1);
    const s1Events = lifecycle(s1);
    const sees = await waitFor(() => state(s1).players?.size === 2 && state(s1).phase === "playing", 2000);
    ok(sees && !state(s1).players.has(s1.sessionId), "a spectator gets into the full duel, sees both players and the phase, and isn't in state.players");
    await waitFor(() => state(p1).spectators === 1, 1000);
    ok(
      room.state.players.size === 2 && room.state.spectators === 1 && state(p1).spectators === 1 && state(s1).spectators === 1,
      `the synced spectator count is 1, players see it too (${room.state.spectators}, ${state(p1).spectators})`,
    );
    await sleep(100);
    ok(
      room.metadata.players === 2 && room.metadata.spectators === 1 && room.locked,
      `not counted as a seat: metadata ${room.metadata.players} players, ${room.metadata.spectators} spectator, still locked`,
    );
    ok(room.state.phase === "playing" && room.state.startTick === startTick, "the match didn't restart when they came in");

    // Inputs and a pick: nothing changes, and the spectator stays connected.
    const before = [...room.state.players.values()].map((p) => ({ x: p.x, z: p.z, shots: p.shots, pick: p.pick, dashCd: p.dashCd }));
    for (let i = 1; i <= 60; i++) s1.send(MSG_INPUT, input(i));
    s1.send(MSG_PICK, { weapon: 2 });
    await sleep(800);
    const after = [...room.state.players.values()].map((p) => ({ x: p.x, z: p.z, shots: p.shots, pick: p.pick, dashCd: p.dashCd }));
    ok(
      JSON.stringify(after) === JSON.stringify(before) && room.state.bullets.size === 0 && room.state.grenades.size === 0,
      `60 inputs (move, fire, dash, grenade) and a pick change nothing (${JSON.stringify(after)})`,
    );
    ok(!s1Events.some((e) => e.startsWith("leave") || e.startsWith("drop")), `the spectator is still connected (${s1Events.join(", ") || "no events"})`);

    // A second spectator, who leaves: the room stays locked, quick match skips it.
    const s2 = await watch(url, p1.roomId);
    ok(await waitFor(() => room.state.spectators === 2 && state(p1).spectators === 2, 1000), "a second spectator makes it 2");
    await s2.leave();
    ok(await waitFor(() => room.state.spectators === 1, 1000), "...and 1 again when they leave");
    await sleep(100);
    ok(room.locked, "a spectator leaving doesn't unlock the full room");
    const quick = await new Client(url).joinOrCreate("spec_duel");
    ok(quick.roomId !== p1.roomId, "quick match skips the full room with a spectator in it");
    await quick.leave();
    const full = await refusal(new Client(url).joinById(p1.roomId));
    ok(/locked/.test(full), `a player with the link still gets "full" (${full})`);
    const game = await listed(p1.roomId);
    ok(!!game && !game.joinable && game.spectators === 1, `the open games list has it to watch, not join (${JSON.stringify(game)})`);

    // A kill: the spectator sees it land.
    room.damage(p1.sessionId, p2.sessionId, room.state.players.get(p2.sessionId), MAX_HP);
    const killSeen = await waitFor(() => state(s1).feed.length === 1 && state(s1).players.get(p1.sessionId)?.kills === 1, 1500);
    let feedKiller = "";
    state(s1).feed.forEach((k) => (feedKiller = k.killer));
    ok(killSeen && feedKiller === p1.sessionId, "the spectator sees the kill, with the killer in the kill feed");

    // Rematch on another map: the spectator stays.
    const mapBefore = room.state.mapId;
    const shooter = room.state.players.get(p1.sessionId)!;
    shooter.kills = room.state.killsToWin - 1;
    await waitFor(() => !!room.state.players.get(p2.sessionId)?.alive, 5000);
    room.damage(p1.sessionId, p2.sessionId, room.state.players.get(p2.sessionId), MAX_HP);
    const ended = await waitFor(() => state(s1).phase === "ended", 2000);
    const rematch = await waitFor(() => state(s1).phase === "playing" && state(s1).mapId !== mapBefore, 4000);
    ok(
      ended && rematch && state(s1).spectators === 1 && !s1Events.some((e) => e.startsWith("leave")),
      `the spectator stays through the match end and the rematch on a new map (${mapBefore} -> ${state(s1).mapId})`,
    );

    // A seat frees: the room opens, the spectator takes it on the same connection.
    await p2.leave();
    rooms[1] = null;
    ok(await waitFor(() => !room.locked && state(s1).phase === "waiting", 2000), "a player leaves: the room unlocks, back to waiting");
    await sleep(100);
    const open = await listed(p1.roomId);
    ok(!!open?.joinable, `...and the open games list has it as joinable (${JSON.stringify(open)})`);
    // One player and a spectator: no match.
    ok(room.state.phase === "waiting", "one player and a spectator don't start a match");
    s1.send(MSG_TAKE_SEAT, {});
    const seated = await waitFor(() => !!state(s1).players.get(s1.sessionId) && state(s1).phase === "playing", 2000);
    ok(
      seated && room.state.spectators === 0 && room.state.players.size === 2 && s1.roomId === p1.roomId,
      `the spectator takes the free seat on the same connection, and the match starts (${room.state.players.get(s1.sessionId)?.name})`,
    );
    ok(room.locked, "the room is locked again, full");
    const seq = (state(s1).players.get(s1.sessionId)?.lastSeq ?? 0) + 1;
    s1.send(MSG_INPUT, { ...input(seq), fire: false, dash: 0, grenade: 0, shield: 0 });
    ok(await waitFor(() => state(s1).players.get(s1.sessionId)?.lastSeq === seq, 1500), "the new player's inputs are applied");
    p1.send(MSG_TAKE_SEAT, {});
    await sleep(200);
    ok(room.state.players.size === 2 && room.state.spectators === 0, "MSG_TAKE_SEAT from a player is ignored");

    // Every seat taken: a spectator's MSG_TAKE_SEAT is ignored.
    const s3 = await watch(url, p1.roomId);
    rooms.push(s3);
    await waitFor(() => room.state.spectators === 1, 1000);
    s3.send(MSG_TAKE_SEAT, {});
    await sleep(300);
    ok(room.state.players.size === 2 && !room.state.players.has(s3.sessionId) && room.state.spectators === 1, "with every seat taken, MSG_TAKE_SEAT is ignored");

    // Reconnection: the SDK's own retry, then a reload's client.reconnect(token).
    const s3Events = lifecycle(s3);
    const s3Server = () => room.clients.find((c) => c.sessionId === s3.sessionId);
    s3Server()?.ref.terminate();
    // The SDK fires "reconnect" before its join acknowledgement reaches the
    // server, and until the server reads it allowReconnection refuses the
    // client ("not joined"): a drop in between would hold no seat.
    const back = await waitFor(() => s3Events.includes("reconnect") && s3Server()?.state === ClientState.JOINED, 8000);
    ok(
      back && !s3Events.some((e) => e.startsWith("leave")) && room.state.spectators === 1,
      `a dropped spectator is back through the SDK's retry (${s3Events.join(", ")})`,
    );
    s3.reconnection.enabled = false;
    const token = s3.reconnectionToken;
    s3Server()?.ref.terminate();
    // Gone from room.clients means onDrop has run and the seat is held.
    await waitFor(() => !s3Server() && s3Events.some((e) => e.startsWith("leave")), 3000);
    const s3b = await new Client(url).reconnect(token);
    rooms.push(s3b);
    const resumed = await waitFor(() => state(s3b).players?.size === 2, 2000);
    ok(
      resumed && s3b.sessionId === s3.sessionId && !state(s3b).players.has(s3b.sessionId) && room.state.spectators === 1,
      "a reload's client.reconnect(token) resumes watching (same session, still a spectator)",
    );

    // Everyone playing leaves: the spectator is told the game ended.
    const lastEvents = lifecycle(s3b);
    await Promise.all([p1.leave(), s1.leave()]);
    rooms[0] = null;
    const closed = await waitFor(() => lastEvents.includes(`leave:${CLOSE_NO_PLAYERS}`), 5000);
    ok(closed, `with only spectators left, the room closes after its timeout (${lastEvents.join(", ")})`);
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** A running FFA: watched with a free seat, not counted for the start, drop-in through MSG_TAKE_SEAT. */
async function ffaStory(url: string): Promise<Lines> {
  const tag = "[spectate ffa]";
  const lines: Lines = [];
  const ok = (c: boolean, l: string) => lines.push([c, `${tag} ${l}`]);
  const first = await new Client(url).create("spec_ffa");
  const rooms: (Room | null)[] = [first];
  try {
    const room = local(first.roomId);
    rooms.push(await new Client(url).joinById(first.roomId));
    // Two players and two spectators (one by id: the room isn't full): no countdown.
    const s1 = await new Client(url).joinById(first.roomId, { spectate: true });
    const s2 = await watch(url, first.roomId);
    rooms.push(s1, s2);
    await sleep(1500);
    ok(
      room.state.phase === "waiting" && room.state.countdown === 0 && room.state.players.size === 2 && room.state.spectators === 2,
      `2 players and 2 spectators: no countdown (${room.state.phase}, countdown ${room.state.countdown})`,
    );
    rooms.push(await new Client(url).joinById(first.roomId));
    const started = await waitFor(() => state(s1).phase === "playing", 4000);
    ok(started && !state(s1).players.has(s1.sessionId) && state(s1).players.size === 3, "a third player starts it; the spectators watch it run, not in state.players");
    ok(room.metadata.players === 3 && room.metadata.spectators === 2, `metadata: 3 players, 2 spectators (${JSON.stringify(room.metadata)})`);
    const before = [...room.state.players.values()].map((p) => ({ x: p.x, z: p.z, shots: p.shots, pick: p.pick }));
    for (let i = 1; i <= 30; i++) s1.send(MSG_INPUT, input(i));
    s1.send(MSG_PICK, { weapon: 3 });
    await sleep(500);
    const after = [...room.state.players.values()].map((p) => ({ x: p.x, z: p.z, shots: p.shots, pick: p.pick }));
    ok(JSON.stringify(after) === JSON.stringify(before) && room.state.bullets.size === 0, "a spectator's inputs and pick change nothing");

    // Drop-in: a spectator takes a seat mid-match.
    s2.send(MSG_TAKE_SEAT, {});
    const seated = await waitFor(() => !!state(s2).players.get(s2.sessionId), 2000);
    ok(
      seated && room.state.phase === "playing" && room.state.players.size === 4 && room.state.spectators === 1,
      "a spectator drops into the running FFA with MSG_TAKE_SEAT",
    );
  } finally {
    await leaveAll(rooms);
  }
  return lines;
}

/** Every spectator scenario, in parallel. Call `registerSpectateRooms` first. */
export async function spectatorChecks(url: string): Promise<Lines[]> {
  const results = await Promise.allSettled([duelStory(url), ffaStory(url)]);
  return results.map((r) =>
    r.status === "fulfilled" ? r.value : [[false, `[spectate] scenario crashed: ${r.reason instanceof Error ? r.reason.stack : r.reason}`]],
  );
}

// The game server the e2e suite plays against: the real one (createServer),
// on its own port so it never meets `bun run dev`, with shorter rules so a
// match can be played to the end in a few seconds. Accounts live in an
// in-memory database (PGlite), fresh on every run; reset links go to the
// console (no mail settings).
//
// Next to it, on PORT + 1, a small control API for the tests (test-only,
// never part of the product):
//   POST /kill { roomId, killer, victim }  the killer's shot kills the victim at once
//                                          (through the real damage path: nothing
//                                          happens between teammates)
//   POST /place { roomId, id, x, z }       puts a player on (x, z) (a teleport)
//   POST /warmup { roomId, seconds }       that room's warmups last `seconds`, the one
//                                          running included (from now)
//   POST /hp { roomId, id, hp }            sets a living player's HP (1..MAX_HP), with no
//                                          kill, feed line or damage stat (the heal spec
//                                          hurts players with it)
//   POST /countdown { roomId, seconds }    the same for that room's pre-match countdowns
//   POST /respawn { roomId, seconds }      the same for that room's respawn delays (every
//                                          dead player respawns `seconds` from now)
//   POST /loot { roomId, weapon }          battle royale: that room's crates drop this gun
//                                          (a WEAPONS index) instead of a random item
//   POST /loot { roomId, kind, item, amount }  the same with any floor item (an ITEM_KINDS
//                                          index, which one, how many): healing, shields
//   POST /zone { roomId, wait, close }     battle royale: the running match's zone starts
//                                          shrinking `wait` seconds from now and is closed
//                                          `close` seconds from now
//
// Run by playwright.config.ts (webServer), or by hand: `bun server.ts`.

import { createServer as createHttpServer } from "node:http";
import { matchMaker } from "@colyseus/core";
import { createServer } from "@bagarre/server/app";
import { ITEM_GUN, ITEM_KINDS, MAX_HP, TICK_RATE, WEAPONS, type ItemDrop } from "@bagarre/shared";

/**
 * Every match starts with a 1 s warmup instead of WARMUP_SECONDS (8 s): most
 * specs wait for `playing` right after the players are in. The warmup spec
 * gives its own room the real length through POST /warmup.
 */
export const E2E_WARMUP = 1;

export const E2E_RULES = {
  /**
   * Two kills win a duel: one kill leaves a score to check, the second ends the match.
   * The result card stays 10 s before the rematch (4 s in the game): CI draws a
   * page about once a second, and a click there needs two still frames before
   * the card goes. The card's own countdown still counts from 4 (client rules).
   */
  duel: { killsToWin: 2, respawnDelay: 0.5, endDelay: 10, warmup: E2E_WARMUP },
  /** An FFA starts 2 s after the third player is in. */
  ffa: { countdown: 2, respawnDelay: 0.5, warmup: E2E_WARMUP },
  /** A team deathmatch starts 2 s after it is 2v2. */
  tdm: { countdown: 2, respawnDelay: 0.5, warmup: E2E_WARMUP },
  /**
   * A battle royale starts 2 s after the second player is in; its zone waits
   * 60 s and closes at 90 s (30 s and 4:30 in the game): long enough for a
   * spec's steps, short enough to watch it close (POST /zone moves it on).
   * The result stays 10 s, like the duel's.
   */
  royale: { countdown: 2, warmup: E2E_WARMUP, endDelay: 10, royale: { zoneWait: 60, zoneClose: 90 } },
};

const port = Number(process.env.PORT ?? 2610);
const controlPort = port + 1;

const server = createServer({
  gracefullyShutdown: false,
  duelRules: E2E_RULES.duel,
  ffaRules: E2E_RULES.ffa,
  teamRules: E2E_RULES.tdm,
  royaleRules: E2E_RULES.royale,
  database: "memory",
  // The e2e client (playwright.config.ts), where reset links would land.
  auth: { publicUrl: "http://localhost:5610", backendUrl: `http://localhost:${port}`, discord: null, mail: null },
});
await server.listen(port);

/**
 * The room's own damage path (GameRoom.damage is private): the same kill,
 * feed line, score and match end as a real shot, without having to aim.
 */
type DamageFn = (attackerId: string, targetId: string, target: unknown, amount: number, weapon?: number) => void;
interface RoomInternals {
  state: { players: { get(id: string): unknown } };
  damage: DamageFn;
}

/**
 * POST /place { roomId, id, x, z }: puts a player on (x, z) at once, as a
 * respawn would (their client snaps to it), so a test can set up a grenade
 * throw without walking there.
 */
function place(body: string, reply: (status: number, text: string) => void) {
  const { roomId, id, x, z } = JSON.parse(body || "{}") as { roomId?: string; id?: string; x?: number; z?: number };
  const room = roomId ? (matchMaker.getLocalRoomById(roomId) as unknown as RoomInternals | undefined) : undefined;
  if (!room) return reply(404, `no room ${roomId}`);
  const p = id ? (room.state.players.get(id) as { x: number; z: number; dashTicks: number } | undefined) : undefined;
  if (!p || typeof x !== "number" || typeof z !== "number") return reply(404, `no player ${id}`);
  p.x = x;
  p.z = z;
  p.dashTicks = 0;
  reply(200, "ok");
}

/**
 * POST /hp { roomId, id, hp }: sets a living player's HP at once (1..MAX_HP),
 * outside the damage path: no kill, no feed line, no damage stat. The heal
 * spec uses it to hurt players before a heal.
 */
function setHp(body: string, reply: (status: number, text: string) => void) {
  const { roomId, id, hp } = JSON.parse(body || "{}") as { roomId?: string; id?: string; hp?: number };
  const room = roomId ? (matchMaker.getLocalRoomById(roomId) as unknown as RoomInternals | undefined) : undefined;
  if (!room) return reply(404, `no room ${roomId}`);
  const p = id ? (room.state.players.get(id) as { hp: number; alive: boolean } | undefined) : undefined;
  if (!p || !p.alive) return reply(404, `no living player ${id}`);
  if (typeof hp !== "number" || !Number.isInteger(hp) || hp < 1 || hp > MAX_HP) return reply(400, `bad hp ${hp}`);
  p.hp = hp;
  reply(200, "ok");
}

/**
 * POST /warmup { roomId, seconds }: the warmups of that room from now on last
 * `seconds` (the room reads `rules.warmup` when a match starts). Called while
 * the room waits, a spec plays a warmup of the real length; called during a
 * warmup, it moves that warmup's end to `seconds` from now (0: it ends on the
 * next tick), so a slow machine gets time for its checks and a fast one
 * doesn't wait. The room's rules object is shared by every room of its type:
 * it is replaced for this room, never changed.
 */
function setWarmup(body: string, reply: (status: number, text: string) => void) {
  const { roomId, seconds } = JSON.parse(body || "{}") as { roomId?: string; seconds?: number };
  const room = roomId
    ? (matchMaker.getLocalRoomById(roomId) as unknown as { rules: { warmup: number }; state: { phase: string; tick: number; warmupEnd: number } } | undefined)
    : undefined;
  if (!room) return reply(404, `no room ${roomId}`);
  if (typeof seconds !== "number" || seconds < 0) return reply(400, `bad seconds ${seconds}`);
  if (typeof room.rules?.warmup !== "number") return reply(500, "GameRoom.rules.warmup is gone: update apps/e2e/server.ts");
  room.rules = { ...room.rules, warmup: seconds };
  if (room.state.phase === "warmup") room.state.warmupEnd = room.state.tick + Math.round(seconds * TICK_RATE);
  reply(200, "ok");
}

/** A room's rules and the state fields the holds below move (replaced for that room, never changed: see setWarmup). */
interface HoldRoom {
  rules: { countdown: number; respawnDelay: number };
  state: { countdown: number; players: { forEach(fn: (p: { alive: boolean; respawnTicks: number }) => void): void } };
}

function holdRoom(body: string, reply: (status: number, text: string) => void): { room: HoldRoom; seconds: number } | null {
  const { roomId, seconds } = JSON.parse(body || "{}") as { roomId?: string; seconds?: number };
  const room = roomId ? (matchMaker.getLocalRoomById(roomId) as unknown as HoldRoom | undefined) : undefined;
  if (!room) return reply(404, `no room ${roomId}`), null;
  // Above 0: a countdown of 0 means "no countdown" to the room.
  if (typeof seconds !== "number" || seconds <= 0) return reply(400, `bad seconds ${seconds}`), null;
  if (typeof room.rules?.countdown !== "number" || typeof room.rules?.respawnDelay !== "number") {
    return reply(500, "GameRoom.rules.countdown / respawnDelay are gone: update apps/e2e/server.ts"), null;
  }
  return { room, seconds };
}

const ticksOf = (seconds: number) => Math.max(1, Math.round(seconds * TICK_RATE));

/**
 * POST /countdown { roomId, seconds }: that room's pre-match countdowns last
 * `seconds`, and the one running if any ends `seconds` from now. A spec holds
 * the countdown open while a slow page gets to see it (CI draws a page a few
 * times a second), then lets it end.
 */
function setCountdown(body: string, reply: (status: number, text: string) => void) {
  const hold = holdRoom(body, reply);
  if (!hold) return;
  const { room, seconds } = hold;
  room.rules = { ...room.rules, countdown: seconds };
  if (room.state.countdown > 0) room.state.countdown = ticksOf(seconds);
  reply(200, "ok");
}

/**
 * POST /respawn { roomId, seconds }: that room's respawns come `seconds` after
 * a death, and every player dead right now respawns `seconds` from now. A
 * spec holds a death while slow pages get to show it, then lets it end.
 */
function setRespawn(body: string, reply: (status: number, text: string) => void) {
  const hold = holdRoom(body, reply);
  if (!hold) return;
  const { room, seconds } = hold;
  room.rules = { ...room.rules, respawnDelay: seconds };
  room.state.players.forEach((p) => {
    if (!p.alive) p.respawnTicks = ticksOf(seconds);
  });
  reply(200, "ok");
}

/**
 * Sets how long every smoke cloud in a room has left (seconds from now), so a
 * test can hold one open while it checks things, however slow the machine,
 * then let it clear. Replies with the ticks each had left before, oldest first.
 */
function setSmoke(body: string, reply: (status: number, text: string) => void) {
  const { roomId, seconds } = JSON.parse(body || "{}") as { roomId?: string; seconds?: number };
  const room = roomId
    ? (matchMaker.getLocalRoomById(roomId) as unknown as { state: { tick: number; smokes?: Map<string, { end: number }> } } | undefined)
    : undefined;
  if (!room) return reply(404, `no room ${roomId}`);
  if (typeof seconds !== "number" || seconds < 0) return reply(400, `bad seconds ${seconds}`);
  if (!room.state.smokes) return reply(500, "GameRoom state.smokes is gone: update apps/e2e/server.ts");
  const left: number[] = [];
  room.state.smokes.forEach((s) => {
    left.push(s.end - room.state.tick);
    s.end = room.state.tick + Math.round(seconds * TICK_RATE);
  });
  reply(200, JSON.stringify(left));
}

/**
 * POST /loot { roomId, weapon }: from now on that room's crates drop this gun
 * (with a full magazine) instead of a random line of the loot table, so a
 * spec knows what it will pick up. Only the room's Floor changes (its draw).
 * With `kind`, `item` and `amount` instead of `weapon`: that floor item
 * (a stack of healing items, shield charges, grenades).
 */
function setLoot(body: string, reply: (status: number, text: string) => void) {
  const { roomId, weapon, kind, item, amount } = JSON.parse(body || "{}") as { roomId?: string; weapon?: number; kind?: number; item?: number; amount?: number };
  const room = roomId ? (matchMaker.getLocalRoomById(roomId) as unknown as { floor?: { force: ItemDrop | null } } | undefined) : undefined;
  if (!room) return reply(404, `no room ${roomId}`);
  if (!room.floor || !("force" in room.floor)) return reply(500, "GameRoom.floor.force is gone: update apps/e2e/server.ts");
  if (kind !== undefined) {
    const whole = (v: unknown, max: number) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
    if (!whole(kind, ITEM_KINDS.length - 1) || !whole(item, 255) || !whole(amount, 255) || amount === 0)
      return reply(400, `bad item ${kind} / ${item} / ${amount}`);
    room.floor.force = { kind, item: item as number, amount: amount as number };
    return reply(200, "ok");
  }
  if (typeof weapon !== "number" || !WEAPONS[weapon]) return reply(400, `bad weapon ${weapon}`);
  room.floor.force = { kind: ITEM_GUN, item: weapon, amount: WEAPONS[weapon].magazine };
  reply(200, "ok");
}

/**
 * POST /zone { roomId, wait, close }: the running royale match's zone starts
 * shrinking `wait` seconds from now and is closed `close` seconds from now
 * (its circles unchanged), so a spec sees it close without waiting for it.
 */
function setZone(body: string, reply: (status: number, text: string) => void) {
  const { roomId, wait, close } = JSON.parse(body || "{}") as { roomId?: string; wait?: number; close?: number };
  const room = roomId
    ? (matchMaker.getLocalRoomById(roomId) as unknown as { state: { tick: number; zone?: { start: number; end: number } } } | undefined)
    : undefined;
  if (!room) return reply(404, `no room ${roomId}`);
  const zone = room.state.zone;
  if (!zone) return reply(500, "GameRoom state.zone is gone: update apps/e2e/server.ts");
  if (zone.end <= 0) return reply(409, "no zone running");
  if (typeof wait !== "number" || typeof close !== "number" || wait < 0 || close <= wait) return reply(400, `bad wait ${wait} / close ${close}`);
  zone.start = room.state.tick + Math.round(wait * TICK_RATE);
  zone.end = room.state.tick + Math.round(close * TICK_RATE);
  reply(200, "ok");
}

/** The test-only control API. */
createHttpServer((req, res) => {
  let body = "";
  req.on("data", (chunk: Buffer) => (body += chunk));
  req.on("end", () => {
    const reply = (status: number, text: string) => res.writeHead(status, { "content-type": "text/plain" }).end(text);
    if (req.method === "POST" && req.url === "/place") return place(body, reply);
    if (req.method === "POST" && req.url === "/warmup") return setWarmup(body, reply);
    if (req.method === "POST" && req.url === "/smoke") return setSmoke(body, reply);
    if (req.method === "POST" && req.url === "/hp") return setHp(body, reply);
    if (req.method === "POST" && req.url === "/countdown") return setCountdown(body, reply);
    if (req.method === "POST" && req.url === "/respawn") return setRespawn(body, reply);
    if (req.method === "POST" && req.url === "/loot") return setLoot(body, reply);
    if (req.method === "POST" && req.url === "/zone") return setZone(body, reply);
    if (req.method !== "POST" || req.url !== "/kill") return reply(404, "not found");
    const { roomId, killer, victim } = JSON.parse(body || "{}") as { roomId?: string; killer?: string; victim?: string };
    const room = roomId ? (matchMaker.getLocalRoomById(roomId) as unknown as RoomInternals | undefined) : undefined;
    if (!room) return reply(404, `no room ${roomId}`);
    const target = victim ? room.state.players.get(victim) : undefined;
    if (!target || !killer) return reply(404, `no player ${victim}`);
    if (typeof room.damage !== "function") return reply(500, "GameRoom.damage is gone: update apps/e2e/server.ts");
    room.damage(killer, victim!, target, 10_000, 0);
    reply(200, "ok");
  });
}).listen(controlPort);

console.log(`[e2e] game server on ws://localhost:${port}, control on http://localhost:${controlPort}`);

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
//
// Run by playwright.config.ts (webServer), or by hand: `bun server.ts`.

import { createServer as createHttpServer } from "node:http";
import { matchMaker } from "@colyseus/core";
import { createServer } from "@bagarre/server/app";

export const E2E_RULES = {
  /**
   * Two kills win a duel: one kill leaves a score to check, the second ends the match.
   * The result card stays 10 s before the rematch (4 s in the game): CI draws a
   * page about once a second, and a click there needs two still frames before
   * the card goes. The card's own countdown still counts from 4 (client rules).
   */
  duel: { killsToWin: 2, respawnDelay: 0.5, endDelay: 10 },
  /** An FFA starts 2 s after the third player is in. */
  ffa: { countdown: 2, respawnDelay: 0.5 },
  /** A team deathmatch starts 2 s after it is 2v2. */
  tdm: { countdown: 2, respawnDelay: 0.5 },
};

const port = Number(process.env.PORT ?? 2610);
const controlPort = port + 1;

const server = createServer({
  gracefullyShutdown: false,
  duelRules: E2E_RULES.duel,
  ffaRules: E2E_RULES.ffa,
  teamRules: E2E_RULES.tdm,
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

/** The test-only control API. */
createHttpServer((req, res) => {
  let body = "";
  req.on("data", (chunk: Buffer) => (body += chunk));
  req.on("end", () => {
    const reply = (status: number, text: string) => res.writeHead(status, { "content-type": "text/plain" }).end(text);
    if (req.method === "POST" && req.url === "/place") return place(body, reply);
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

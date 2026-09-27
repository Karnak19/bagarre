import { createEndpoint, createRouter, defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { FFA_ROOM_NAME, GAMES_ROUTE, ROOM_NAME, type OpenGame, type RoomMeta } from "@bagarre/shared";
import { DuelRoom, FfaRoom } from "./GameRoom.ts";

/**
 * The menu's open games list: public rooms of both modes with a free seat,
 * newest first. A duel is listed while one player waits for an opponent; a
 * free-for-all while it waits or plays (players drop in) and has a seat left.
 * Private rooms never show up (Colyseus keeps them out of
 * `query({ private: false })`), and full ones are locked (the seat lock in
 * GameRoom).
 */
export async function openGames(): Promise<OpenGame[]> {
  const out: OpenGame[] = [];
  for (const name of [ROOM_NAME, FFA_ROOM_NAME]) {
    const rooms = await matchMaker.query({ name, private: false, locked: false });
    for (const r of rooms) {
      const meta = r.metadata as RoomMeta | undefined;
      if (!meta || meta.players < 1 || meta.players >= meta.maxPlayers) continue;
      if (meta.mode === "duel" && meta.phase !== "waiting") continue;
      out.push({
        roomId: r.roomId,
        mode: meta.mode,
        hostName: meta.hostName,
        mapId: meta.mapId,
        phase: meta.phase,
        players: meta.players,
        maxPlayers: meta.maxPlayers,
        createdAt: meta.createdAt,
      });
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
}

const listGames = createEndpoint(GAMES_ROUTE, { method: "GET" }, async () => ({ games: await openGames() }));

/**
 * `mapId` pins every duel room to one duel map (the smoke test forces
 * "yard"), `ffaMapId` every FFA room to one FFA map; without them each match
 * picks a random map of its mode's pool.
 */
export function createServer(
  options: { greet?: boolean; gracefullyShutdown?: boolean; mapId?: string; ffaMapId?: string } = {},
) {
  return defineServer({
    greet: options.greet ?? false,
    gracefullyShutdown: options.gracefullyShutdown ?? true,
    transport: new WebSocketTransport(),
    rooms: {
      [ROOM_NAME]: defineRoom(options.mapId ? DuelRoom.pinnedTo(options.mapId) : DuelRoom),
      [FFA_ROOM_NAME]: defineRoom(options.ffaMapId ? FfaRoom.pinnedTo(options.ffaMapId) : FfaRoom),
    },
    routes: createRouter({ listGames }),
  });
}

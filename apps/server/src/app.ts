import { createEndpoint, createRouter, defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAMES_ROUTE, MAX_PLAYERS, ROOM_NAME, type OpenGame, type RoomMeta } from "@bagarre/shared";
import { DuelRoom } from "./DuelRoom.ts";

/**
 * The menu's open games list: public duel rooms with one player waiting for
 * an opponent, newest first. Private rooms never show up (Colyseus keeps them
 * out of `query({ private: false })`), and full ones are locked.
 */
export async function openGames(): Promise<OpenGame[]> {
  const rooms = await matchMaker.query({ name: ROOM_NAME, private: false, locked: false });
  const out: OpenGame[] = [];
  for (const r of rooms) {
    const meta = r.metadata as RoomMeta | undefined;
    if (!meta || meta.phase !== "waiting" || meta.players < 1 || r.clients >= MAX_PLAYERS) continue;
    out.push({ roomId: r.roomId, hostName: meta.hostName, mapId: meta.mapId, createdAt: meta.createdAt });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
}

const listGames = createEndpoint(GAMES_ROUTE, { method: "GET" }, async () => ({ games: await openGames() }));

/**
 * `mapId` pins every room to one map (the smoke test forces "yard"); without
 * it each match picks a random map.
 */
export function createServer(options: { greet?: boolean; gracefullyShutdown?: boolean; mapId?: string } = {}) {
  return defineServer({
    greet: options.greet ?? false,
    gracefullyShutdown: options.gracefullyShutdown ?? true,
    transport: new WebSocketTransport(),
    rooms: {
      [ROOM_NAME]: defineRoom(options.mapId ? DuelRoom.pinnedTo(options.mapId) : DuelRoom),
    },
    routes: createRouter({ listGames }),
  });
}

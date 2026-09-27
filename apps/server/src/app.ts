import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@bagarre/shared";
import { DuelRoom } from "./DuelRoom.ts";

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
  });
}

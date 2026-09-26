import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@bagarre/shared";
import { DuelRoom } from "./DuelRoom.ts";

export function createServer(options: { greet?: boolean; gracefullyShutdown?: boolean } = {}) {
  return defineServer({
    greet: options.greet ?? false,
    gracefullyShutdown: options.gracefullyShutdown ?? true,
    transport: new WebSocketTransport(),
    rooms: {
      [ROOM_NAME]: defineRoom(DuelRoom),
    },
  });
}

// Bots: battle royale seats the server drives (#48). A bot is a seat like
// any other (a Player in `state.players` and its internals in GameRoom), with
// no Colyseus client: GameRoom.addBot seats it, and every tick
// GameRoom.feedBots puts one input from `botInput` in its queue, which then
// goes through applyInput and the shared step exactly like a client's.
//
// `botInput` is the bot's brain, the one place to plug it in. For now it is
// neutral: a bot stands where it spawned and presses nothing.

import type { InputMessage, MapDef } from "@bagarre/shared";
import type { GameState, Player } from "./state.ts";

/**
 * Bot ids start with this. Colyseus session ids are letters, digits, `_` and
 * `-`, never a `:`, so a bot's id can't collide with a client's.
 */
export const BOT_ID_PREFIX = "bot:";

export const isBotId = (id: string): boolean => id.startsWith(BOT_ID_PREFIX);

/**
 * Bot names, in the order they are handed out. Never a guest name, and never
 * a username (those have no spaces), so nobody mistakes a bot for a person.
 */
export const BOT_NAMES = ["Bot Ada", "Bot Rex", "Bot Ivy", "Bot Max", "Bot Zoe", "Bot Leo", "Bot Kit", "Bot Sam", "Bot Uma", "Bot Ned"] as const;

/** The first bot name nobody in the room has (`taken`: every seat's name). */
export function botName(taken: ReadonlySet<string>): string {
  const free = BOT_NAMES.find((n) => !taken.has(n));
  if (free) return free;
  for (let i = BOT_NAMES.length + 1; ; i++) if (!taken.has(`Bot ${i}`)) return `Bot ${i}`;
}

/**
 * Everything a bot can read when it decides its input, once a tick. The
 * whole room state (players, items, crates, zone, bullets, grenades, tick,
 * phase) and the map are the server's own: read them, never write them.
 */
export interface BotTick {
  /** The bot's id (its key in `state.players`). */
  id: string;
  /** Its seat. */
  player: Player;
  state: GameState;
  map: MapDef;
  /** The seq this input must carry: one more than the last (applyInput acks it, `bulletId` uses it). */
  seq: number;
}

/**
 * The bot's input for this tick. Press counters are running totals (see
 * InputMessage): a brain that presses something keeps its own counters and
 * bumps them. Neutral for now: no move, no fire, no presses, aim kept.
 */
export function botInput({ player, seq }: BotTick): InputMessage {
  return {
    seq,
    mx: 0,
    mz: 0,
    aim: player.aim,
    fire: false,
    gx: player.x,
    gz: player.z,
    dash: 0,
    grenade: 0,
    shield: 0,
    reload: 0,
    slot: 0,
    switch: 0,
    swap: 0,
    heal: 0,
    use: 0,
    melee: 0,
  };
}

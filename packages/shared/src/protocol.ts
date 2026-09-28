import type { GameMode } from "./modes.ts";

// Message and state shapes exchanged between client and server.

export const MSG_INPUT = "input";
/** Weapon choice. Only accepted while dead or between matches. */
export const MSG_PICK = "pick";
/**
 * Latency probe: the server sends `{ n }` every couple of seconds, the client
 * echoes it back at once, and the server stores the round trip as the
 * player's `ping` (so everyone's ping is measured by the server).
 */
// The "__" prefix keeps clients that don't answer (the smoke test's) quiet:
// the Colyseus SDK only warns about unhandled types without it.
export const MSG_PING = "__latency";
export const MSG_PONG = "latency:ack";
/**
 * Team deathmatch, while waiting: move to the other team, `{ team }`
 * (TEAM_RED or TEAM_BLUE). Refused unless the teams stay balanced (sizes
 * differ by at most 1 after the move).
 */
export const MSG_TEAM = "team";
/** Spectator -> room: take a free seat, on the same connection. Payload `{}`. */
export const MSG_TAKE_SEAT = "seat";
/**
 * Close code: the room has had spectators but no player for
 * SPECTATOR_IDLE_S, so it closes. 4000-4010 are Colyseus'; ours are 4011+.
 */
export const CLOSE_NO_PLAYERS = 4012;
/** Seconds a room with only spectators in it stays open. */
export const SPECTATOR_IDLE_S = 60;

export interface PingMessage {
  n: number;
}

/**
 * One input per simulation tick. `mx`/`mz` is the WORLD-space move direction
 * (the client already turned screen-relative WASD into world space). The server
 * clamps its length to 1 and never accepts positions from the client.
 *
 * Abilities are edge-triggered through press COUNTERS rather than one-tick
 * booleans: the client bumps `dash` each time Space goes down and sends the
 * running total in every input. The simulation acts when the counter is higher
 * than the last one it saw, so a press survives a dropped input (the next input
 * carries the same total), and holding or spamming the key can't queue extra
 * uses: one increase = at most one use, gated by the cooldown.
 */
export interface InputMessage {
  seq: number;
  mx: number;
  mz: number;
  /** Aim angle in radians, atan2(dz, dx) on the ground plane. */
  aim: number;
  /** Fire button held. */
  fire: boolean;
  /** Cursor on the ground: where a grenade thrown this tick would go (clamped to range by the sim). */
  gx: number;
  gz: number;
  /** Press counters, see above. */
  dash: number;
  grenade: number;
  shield: number;
  reload: number;
}

export interface PickMessage {
  weapon: number;
}

export interface TeamMessage {
  team: number;
}

export type Phase = "waiting" | "playing" | "ended";

/**
 * Everything the shared step function needs to advance a player by one input.
 * All of it is synced, so the client can restart its prediction from the
 * server's exact values and replay the inputs still in flight.
 */
export interface PlayerSim {
  x: number;
  z: number;
  /** Ticks of dash left (0 = not dashing), and the unit dash direction. */
  dashTicks: number;
  dashDx: number;
  dashDz: number;
  /** Cooldowns, in ticks until ready. */
  dashCd: number;
  fireCd: number;
  grenadeCd: number;
  shieldCd: number;
  /** Rounds left in the magazine, and ticks left of an ongoing reload. */
  ammo: number;
  reloadTicks: number;
  /** Highest press counter already consumed, per ability. */
  dashSeen: number;
  grenadeSeen: number;
  shieldSeen: number;
  reloadSeen: number;
  /** Rounds still to come in the burst being fired (burst weapons only, else 0). */
  burstLeft: number;
}

export const PLAYER_SIM_KEYS = [
  "x",
  "z",
  "dashTicks",
  "dashDx",
  "dashDz",
  "dashCd",
  "fireCd",
  "grenadeCd",
  "shieldCd",
  "ammo",
  "reloadTicks",
  "dashSeen",
  "grenadeSeen",
  "shieldSeen",
  "reloadSeen",
  "burstLeft",
] as const satisfies readonly (keyof PlayerSim)[];

/** What the client reads from a player in the synced room state. */
export interface PlayerView extends PlayerSim {
  aim: number;
  hp: number;
  kills: number;
  alive: boolean;
  /** Last input seq the server applied for this player (for reconciliation). */
  lastSeq: number;
  /**
   * The player's seat number: 0-1 in a duel, 0-5 in FFA, 0-7 in a team
   * deathmatch. Decides the bullet ids, and the colour outside a team mode
   * (PLAYER_COLORS). The lowest free one is taken at join.
   */
  slot: number;
  /** TEAM_RED or TEAM_BLUE in a team deathmatch (their colour); NO_TEAM in the other modes. */
  team: number;
  /** Server ticks left before respawn, when dead. */
  respawnTicks: number;
  /** Weapon in hand, and the one picked for the next spawn. */
  weapon: number;
  pick: number;
  /** Shield bubble: ticks left and damage it can still absorb. */
  shieldTicks: number;
  shieldHp: number;
  /**
   * Display name, decided by the server: the account's username, or a
   * generated "Guest-1234". Never taken from the client.
   */
  name: string;
  /** Signed in with a username (false: a guest). */
  account: boolean;
  /**
   * Scoreboard counters for the current match, all counted by the server and
   * reset when a match starts: deaths, bullets fired (each shotgun pellet
   * counts), bullets that hit the opponent, and damage dealt to the opponent
   * (shield included, grenades included, never your own).
   */
  deaths: number;
  shots: number;
  hits: number;
  damage: number;
  /**
   * Final place once the match ended, 1 = first, set by the server (`rank`
   * in modes.ts): every player has their own, no shared places. 0 while the
   * match runs, and for a player who joined after the end.
   */
  place: number;
  /** Round-trip time to the server in ms, measured by the server (MSG_PING). */
  ping: number;
  /**
   * False while the player's connection is lost and the server holds their
   * seat (RECONNECT_GRACE_S): the character stays put, takes no input and can
   * still be shot. Back to true when they reconnect.
   */
  connected: boolean;
  /**
   * The skin worn (a SKINS id), decided by the server at join: the account's
   * saved one, or a random one for a guest. Never taken from the client.
   * Empty from an older server: draw the capsule fallback.
   */
  skin: string;
}

export const PLAYER_VIEW_KEYS = [
  ...PLAYER_SIM_KEYS,
  "aim",
  "hp",
  "kills",
  "alive",
  "lastSeq",
  "slot",
  "team",
  "respawnTicks",
  "weapon",
  "pick",
  "shieldTicks",
  "shieldHp",
  "name",
  "account",
  "deaths",
  "shots",
  "hits",
  "damage",
  "place",
  "ping",
  "connected",
  "skin",
] as const satisfies readonly (keyof PlayerView)[];

/**
 * Bullet ids are `${slot}:${seq}:${pellet}`: the shooter's slot, the input seq
 * that fired it and the pellet index. The shooter's client computes the same id
 * for its predicted bullet, which is how the two get matched.
 */
export interface BulletView {
  x: number;
  z: number;
  owner: string;
}

export interface GrenadeView {
  x: number;
  /** Height above the ground (the arc). */
  y: number;
  z: number;
  /** Landing point, for the telegraph. */
  tx: number;
  tz: number;
  landed: boolean;
  /** True for exactly one snapshot: the tick it blew up. */
  exploded: boolean;
  owner: string;
}

/** Minimal iteration interface shared by Colyseus MapSchema and Map. */
export interface MapLike<T> {
  forEach(cb: (value: T, key: string) => void): void;
  get(key: string): T | undefined;
}

/**
 * One death in the kill feed (`RoomStateView.feed`, the last few). Names and
 * slots are copied at the time, so a line stays readable after its players
 * leave. `killer` is "" for a self-kill (your own grenade): no one is
 * credited.
 */
export interface KillView {
  /** Increases with every death in the room: the feed's key. */
  n: number;
  tick: number;
  killer: string;
  killerName: string;
  killerSlot: number;
  victim: string;
  victimName: string;
  victimSlot: number;
  /** Their teams at the time (NO_TEAM outside a team mode), for the colours. */
  killerTeam: number;
  victimTeam: number;
  /** A weapon id (WEAPONS), or KILL_GRENADE. */
  weapon: number;
}

/** `KillView.weapon` of a grenade kill. */
export const KILL_GRENADE = 255;
/** Kill feed lines kept in the synced state. */
export const KILL_FEED_SIZE = 5;

export interface RoomStateView {
  /** "duel", "ffa" or "tdm" (see modes.ts). Set when the room is made, never changes. */
  mode: string;
  phase: Phase;
  /** Session id of the winner once the match ended, "" before (always "" with teams). There is always one. */
  winner: string;
  /**
   * Why the winner (the winning team) won when it was level on kills, once
   * the match ended: a `TiebreakReason` (modes.ts), "" when it won outright.
   */
  tiebreak: string;
  /** Team deathmatch: the kills of each team this match, and the winning team once it ended (NO_TEAM before, or no teams). */
  redScore: number;
  blueScore: number;
  winningTeam: number;
  tick: number;
  /** The map being played (a `MapDef.id`, see `mapById`). Only changes between matches. */
  mapId: string;
  /** Server tick the current match started on, and the one it ended on (0 while it runs). */
  startTick: number;
  endTick: number;
  /** Kills that win at once, and the time limit in seconds (0: none). From the mode's rules. */
  killsToWin: number;
  timeLimit: number;
  /** Server ticks left of the pre-match countdown while waiting (0: not counting down). */
  countdown: number;
  /** The time ran out on a tie for the most kills: the next kill that breaks it wins. */
  suddenDeath: boolean;
  players: MapLike<PlayerView>;
  bullets: MapLike<BulletView>;
  grenades: MapLike<GrenadeView>;
  /** The last KILL_FEED_SIZE deaths, oldest first. */
  feed: { forEach(cb: (k: KillView, i: number) => void): void; length: number };
  /** Spectators connected right now (clients with no seat, see GameRoom). */
  spectators: number;
}

/**
 * Matchmaking metadata of a duel room (Colyseus `room.metadata`), kept up to
 * date by the server on every join, leave, phase and map change. The open
 * games list on the menu is built from it.
 */
export interface RoomMeta {
  mode: GameMode;
  /** Name of the player who has been in the room the longest ("" when empty). */
  hostName: string;
  mapId: string;
  phase: Phase;
  /** Player seats taken (dropped players waiting to reconnect included), and the seat count. */
  players: number;
  maxPlayers: number;
  /** Team deathmatch: seats on red and on blue ("3v2"). Absent in the other modes. */
  teams?: [number, number];
  /** Spectators watching. */
  spectators: number;
  /** Date.now() when the room was created. */
  createdAt: number;
}

/** Options the client sends when it joins or creates a room. */
export interface JoinOptions {
  /** Only read by `create`: a private room, never listed nor quick-matched, joined by its link only. */
  private?: boolean;
  /** Dev-only map choice (`?map=`), ignored in production. */
  map?: string;
  /** The guest name the menu shows (`Guest-` and four digits, anything else is ignored). Accounts use their username. */
  guestName?: string;
  /**
   * Join as a spectator: no seat, no player, no inputs (see the seat model
   * in GameRoom). The client joins through the watch route (WATCH_ROUTE),
   * which sets it, so a room whose seats are full can still be watched. The mode is the room name
   * ("duel", "ffa" or "tdm"), never an option.
   */
  spectate?: boolean;
}

/**
 * HTTP route of the game server listing the public games: the ones with a
 * free seat (duels waiting, FFA waiting or playing), then the ones to watch
 * (full, or a duel under way).
 */
export const GAMES_ROUTE = "/games";

/**
 * HTTP route (POST) that reserves a spectator's place in a room, past the
 * seat lock: `joinById` refuses a locked (full) room. It answers with a seat
 * reservation for `client.consumeSeatReservation()`. The body may carry
 * `guestName` (JoinOptions); `spectate` is always set by the server.
 */
export const WATCH_ROUTE = "/games/:roomId/watch";
export const watchPath = (roomId: string) => `/games/${encodeURIComponent(roomId)}/watch`;

/** One entry of GET /games. */
export interface OpenGame {
  roomId: string;
  mode: GameMode;
  hostName: string;
  mapId: string;
  phase: Phase;
  /** Seats taken and seats in all ("3/6 players"). */
  players: number;
  maxPlayers: number;
  /** Team deathmatch: seats on red and on blue ("3v2"). */
  teams?: [number, number];
  spectators: number;
  /** A seat can be taken now (Join); otherwise the game can only be watched. */
  joinable: boolean;
  createdAt: number;
}

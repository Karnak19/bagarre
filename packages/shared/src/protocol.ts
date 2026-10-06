import type { GameMode } from "./modes.ts";

// Message and state shapes exchanged between client and server.

export const MSG_INPUT = "input";
/** Loadout choice. Only accepted while dead, between matches or during warmup (where it applies at once). */
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
 * Host -> room: start the match now. Payload `{}`. Only in a mode whose host
 * starts it (`ModeRules.hostStarts`, the battle royale), and only honoured
 * from the host, while waiting, with enough players in (`acceptsStart`).
 */
export const MSG_START = "start";
/**
 * Host -> room: add a bot to a free seat (MSG_BOT_ADD), or remove the bot
 * added last (MSG_BOT_REMOVE). Payload `{}`. In every mode, only honoured
 * from the host, and a bot is only added while waiting, up to the mode's
 * seat cap (`acceptsBot`). A bot is a seat
 * with no client, driven by the server (`Player.bot`).
 */
export const MSG_BOT_ADD = "bot:add";
export const MSG_BOT_REMOVE = "bot:remove";
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
  /**
   * Battle royale only (the other modes ignore them; parseInput fills in 0
   * when they are missing). `switch` is a press counter like the ones above:
   * when it goes up, the gun in `slot` (0-2, the slot the player asks for)
   * goes in hand, if they carry one there. The client works the slot out
   * (a number key, or the wheel from its predicted slots); the step checks it.
   * `swap` is the F press counter: open a chest, or swap the gun in hand or
   * the grenades held for one on the floor (the server's, see fTarget and floor.ts).
   */
  slot?: number;
  switch?: number;
  swap?: number;
  /**
   * Battle royale: `use` is the press counter of the healing keys (4 and 5):
   * when it goes up, a heal with the item `heal` (a HEAL_ITEMS index) starts,
   * if the step allows it (one carried, not at full health, nothing else
   * going on). Like a switch, the step decides on both sides.
   */
  heal?: number;
  use?: number;
  /**
   * The melee strike's press counter (V), like `dash` above. Optional on the
   * wire: an input from an older client has none, and parseInput reads it as 0.
   */
  melee?: number;
}

/**
 * MSG_PICK: the loadout for the next spawn. Either field or both; each one
 * present must be valid, or the whole message is dropped (see parsePick).
 */
export interface PickMessage {
  /** A WEAPONS index. */
  weapon?: number;
  /** A GRENADES index. */
  grenade?: number;
  /** A PERKS index, or NO_PERK for none. Ignored by the battle royale, where perks are loot. */
  perk?: number;
}

export interface TeamMessage {
  team: number;
}

/**
 * waiting (not enough players, or the countdown) -> warmup (spawned, picks
 * apply at once, no shooting; skipped when the mode's warmup is 0) ->
 * playing (the match clock runs) -> ended (the result) -> warmup again for
 * the rematch, or back to waiting.
 */
export type Phase = "waiting" | "warmup" | "playing" | "ended";

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
  /**
   * Cooldowns, in ticks until ready. `dashCd` is the time until every dash
   * charge is back (one charge without a perk: the plain cooldown; see
   * perks.ts for the double dash).
   */
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
  /**
   * Stun grenade: steps left of the stun (0 = not stunned). While it runs the
   * player walks at STUN.speedScale and can't dash. Set by the server when a
   * stun goes off, counted down by `stepPlayer` once per input, so the
   * client predicts the slow exactly like the server (no rubber-banding).
   */
  stunTicks: number;
  /**
   * Melee strike: ticks until the next one is allowed, and the highest
   * `melee` press counter already consumed. A strike also holds `fireCd` up
   * for MELEE_LOCKOUT_TICKS. Both in the step, so the client predicts them.
   * Synced like the rest: another client sees a strike as `meleeCd` jumping up.
   */
  meleeCd: number;
  meleeSeen: number;
  /**
   * Health (0..MAX_HP). Part of the sim for the battle royale's healing
   * items: the step refuses a heal at full health and adds the heal when it
   * completes, so the client predicts both. Everything else that changes it
   * (damage, the heal grenade, a respawn) is the server's alone.
   */
  hp: number;
  /**
   * The perk held (a PERKS index, NO_PERK: none). Set by the server only (a
   * spawn with the loadout's pick, a royale pickup or swap); the step reads
   * it for the dash, the magazine, the reload and the switch (perks.ts), so
   * the client predicts with the same numbers.
   */
  perk: number;
  /**
   * The battle royale's gun slots and grenade stack (KitSim, royale.ts). In
   * the other modes it stays empty and nothing reads it. A nested object, as
   * it is a child Schema on the server (`Player.kit`): room for healing
   * items and shield charges (#34) without nearing the 63-field cap.
   */
  kit: KitSim;
}

/**
 * What a player carries in the battle royale. Flat on purpose, like the
 * schema that syncs it: `gun0`..`gun2` are the three gun slots (a WEAPONS
 * index, NO_GUN when empty) and `mag0`..`mag2` their magazines. The slot in
 * `hand` holds the gun being used: ITS magazine is `PlayerSim.ammo`, the
 * one the step fires and reloads, and its `magN` is stale until it is
 * switched away (see `switchGun`, `magAt`). `grenades` is how many of the
 * type in hand (`Player.grenade`) are left.
 */
export interface KitSim {
  hand: number;
  gun0: number;
  gun1: number;
  gun2: number;
  mag0: number;
  mag1: number;
  mag2: number;
  grenades: number;
  /** Highest `switch` / `swap` press counter already consumed (InputMessage). */
  switchSeen: number;
  swapSeen: number;
  /** Healing items carried (HEAL_BANDAGE, HEAL_MEDKIT) and shield charges. */
  bandages: number;
  medkits: number;
  shields: number;
  /**
   * The heal in progress: the HEAL_ITEMS index being used (NO_HEAL: none) and
   * the steps left before it completes. The step walks at
   * ROYALE.healSpeedScale while it runs, which is why it is predicted.
   */
  heal: number;
  healTicks: number;
  /** How the last heal ended (a HEAL_STOP value, 0 before any): the HUD says why a heal stopped. */
  healStop: number;
  /** Highest `use` press counter already consumed (InputMessage). */
  useSeen: number;
}

export const KIT_KEYS = [
  "hand",
  "gun0",
  "gun1",
  "gun2",
  "mag0",
  "mag1",
  "mag2",
  "grenades",
  "switchSeen",
  "swapSeen",
  "bandages",
  "medkits",
  "shields",
  "heal",
  "healTicks",
  "healStop",
  "useSeen",
] as const satisfies readonly (keyof KitSim)[];

/** The flat fields of PlayerSim (everything but `kit`), copied one by one. */
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
  "stunTicks",
  "hp",
  "meleeCd",
  "meleeSeen",
  "perk",
] as const satisfies readonly (keyof PlayerSim)[];

/** What the client reads from a player in the synced room state. */
export interface PlayerView extends PlayerSim {
  aim: number;
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
   * A bot: a seat the server drives, with no client behind it (added by the
   * room's host). Never the host; shown with a BOT tag. False from
   * an older server.
   */
  bot: boolean;
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
  /** Grenade type in hand (a GRENADES index), and the one picked for the next spawn. */
  grenade: number;
  grenadePick: number;
  /**
   * Flash grenade: the server tick the white screen ends on (0 or past: not
   * flashed), and how many ticks it lasted in all (for the fade).
   */
  flashEnd: number;
  flashTicks: number;
  /**
   * Battle royale: the server tick this player was knocked out on (killed,
   * the zone, or left), 0 while still in. Their place follows from it.
   */
  outTick: number;
  /** The perk picked for the next spawn (a PERKS index, NO_PERK: none). The one held is `perk` (PlayerSim). */
  perkPick: number;
}

export const PLAYER_VIEW_KEYS = [
  ...PLAYER_SIM_KEYS,
  "aim",
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
  "grenade",
  "grenadePick",
  "flashEnd",
  "flashTicks",
  "outTick",
  "perkPick",
  "bot",
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
  /** Its type (a GRENADES index), fixed when thrown: a new pick doesn't change a grenade in the air. */
  kind: number;
}

/** A smoke cloud on the ground (`RoomStateView.smokes`), SMOKE.radius wide. */
export interface SmokeView {
  x: number;
  z: number;
  /** Server ticks it appeared on and clears on. */
  start: number;
  end: number;
  /** Session id of the player who threw it, and their team (NO_TEAM outside teams): who sees through it. */
  owner: string;
  team: number;
}

/**
 * Something on the floor in the battle royale (`RoomStateView.items`):
 * dropped by a chest or a dead player, picked up by walking over it or with
 * F (see `fTarget`). Owned by the server, which alone decides who gets it.
 */
export interface FloorItemView {
  x: number;
  z: number;
  /** An ITEM_KINDS index (ITEM_GUN, ITEM_GRENADE, ITEM_HEAL, ITEM_SHIELD, ITEM_PERK). */
  kind: number;
  /** Which one: a WEAPONS index for a gun, a GRENADES index for grenades, a HEAL_ITEMS index for healing (0 for shield charges), a PERKS index for a perk. */
  item: number;
  /** How many: a gun's magazine, a stack's count. */
  amount: number;
  /**
   * The player (session id) who dropped it under their own feet (a grenade
   * swap, an F swap) and hasn't stepped off it yet: they can't take it back
   * until they do. "" for everyone else's items and once they step off.
   */
  blockedFor: string;
  /**
   * A chest's loot pops out of the chest at (`fromX`, `fromZ`) on `dropTick`
   * and lands on (x, z) on `readyTick`: nobody can take it before that (the
   * server's rule, `itemReady`), and the client draws the arc in between.
   * Both 0 for everything else (a knock-out's drop, a swap's): there at once.
   */
  fromX: number;
  fromZ: number;
  dropTick: number;
  readyTick: number;
}

/**
 * A chest (`RoomStateView.crates`, named crates on the wire): F opens it
 * (see `fTarget`), and its loot falls out next to it. An opened one stays,
 * open, until the match ends.
 */
export interface CrateView {
  x: number;
  z: number;
  open: boolean;
}

/**
 * The battle royale's zone, as a few numbers: the circle moves from
 * (x0, z0) with radius r0 at tick `start` to (x1, z1) with radius r1 at tick
 * `end`, in a straight line. `zoneAt` (royale.ts) turns it into the circle of
 * any tick, the same on the server and the client. `end` 0: no zone.
 */
export interface ZoneView {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  r0: number;
  r1: number;
  start: number;
  end: number;
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
  /** A weapon id (WEAPONS), or KILL_GRENADE, KILL_ZONE or KILL_MELEE. */
  weapon: number;
}

/** `KillView.weapon` of a grenade kill. */
export const KILL_GRENADE = 255;
/** `KillView.weapon` of a death in the battle royale's zone (the killer is "", like a self-kill). */
export const KILL_ZONE = 254;
/** `KillView.weapon` of a melee strike (V). Weapon ids grow up from 0, so this never meets one. */
export const KILL_MELEE = 253;
/** Kill feed lines kept in the synced state. */
export const KILL_FEED_SIZE = 5;

export interface RoomStateView {
  /** "duel", "ffa", "tdm" or "royale" (see modes.ts). Set when the room is made, never changes. */
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
  /**
   * Server tick the current match started on (the end of its warmup: 0
   * during warmup), and the one it ended on (0 while it runs).
   */
  startTick: number;
  endTick: number;
  /** Kills that win at once, and the time limit in seconds (0: none). From the mode's rules. */
  killsToWin: number;
  timeLimit: number;
  /** Server ticks left of the pre-match countdown while waiting (0: not counting down). */
  countdown: number;
  /**
   * Session id of the room's host: the first seated player in join order
   * ("" with none). In a battle royale the host starts the match.
   */
  host: string;
  /**
   * Warmup: the server tick it ends on (the match starts then). A tick, not
   * a duration, so every client shows the same timer, one that reconnects
   * mid-warmup included. 0 outside warmup.
   */
  warmupEnd: number;
  /** The time ran out on a tie for the most kills: the next kill that breaks it wins. */
  suddenDeath: boolean;
  players: MapLike<PlayerView>;
  bullets: MapLike<BulletView>;
  grenades: MapLike<GrenadeView>;
  /** The smoke clouds on the ground right now (removed once they clear). */
  smokes: MapLike<SmokeView>;
  /** The last KILL_FEED_SIZE deaths, oldest first. */
  feed: { forEach(cb: (k: KillView, i: number) => void): void; length: number };
  /** Spectators connected right now (clients with no seat, see GameRoom). */
  spectators: number;
  /** Battle royale: the items on the floor, the crates still standing, and the zone (empty or `end` 0 elsewhere). */
  items: MapLike<FloorItemView>;
  crates: MapLike<CrateView>;
  zone: ZoneView;
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

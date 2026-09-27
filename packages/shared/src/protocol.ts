// Message and state shapes exchanged between client and server.

export const MSG_INPUT = "input";
/** Weapon choice. Only accepted while dead or between matches. */
export const MSG_PICK = "pick";

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
] as const satisfies readonly (keyof PlayerSim)[];

/** What the client reads from a player in the synced room state. */
export interface PlayerView extends PlayerSim {
  aim: number;
  hp: number;
  kills: number;
  alive: boolean;
  /** Last input seq the server applied for this player (for reconciliation). */
  lastSeq: number;
  /** 0 or 1, decides colour and name. */
  slot: number;
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
}

export const PLAYER_VIEW_KEYS = [
  ...PLAYER_SIM_KEYS,
  "aim",
  "hp",
  "kills",
  "alive",
  "lastSeq",
  "slot",
  "respawnTicks",
  "weapon",
  "pick",
  "shieldTicks",
  "shieldHp",
  "name",
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

export interface RoomStateView {
  phase: Phase;
  winner: string;
  tick: number;
  players: MapLike<PlayerView>;
  bullets: MapLike<BulletView>;
  grenades: MapLike<GrenadeView>;
}

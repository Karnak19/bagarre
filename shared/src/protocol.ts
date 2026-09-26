// Message and state shapes exchanged between client and server.

export const MSG_INPUT = "input";

/**
 * One input per simulation tick. `mx`/`mz` is the WORLD-space move direction
 * (the client already turned screen-relative WASD into world space). The server
 * clamps its length to 1 and never accepts positions from the client.
 */
export interface InputMessage {
  seq: number;
  mx: number;
  mz: number;
  /** Aim angle in radians, atan2(dz, dx) on the ground plane. */
  aim: number;
  fire: boolean;
}

export type Phase = "waiting" | "playing" | "ended";

/** What the client reads from a player in the synced room state. */
export interface PlayerView {
  x: number;
  z: number;
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
}

export interface BulletView {
  x: number;
  z: number;
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
}

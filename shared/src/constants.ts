// Gameplay and network constants shared by client and server.
// Changing a value here changes it on both sides, which is the whole point:
// client prediction only matches the server if both run the same numbers.

/** Server simulation rate. Clients also send exactly one input per tick. */
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
/** Fixed step, in seconds. Every input advances the simulation by exactly this. */
export const TICK_DT = 1 / TICK_RATE;

/** Default server port. */
export const SERVER_PORT = 2567;
/** Room name used for matchmaking. */
export const ROOM_NAME = "duel";
export const MAX_PLAYERS = 2;

// --- Players ---
export const PLAYER_RADIUS = 0.5;
/** Metres per second. */
export const PLAYER_SPEED = 6;
export const MAX_HP = 100;

// --- Bullets (shared by every weapon) ---
export const BULLET_RADIUS = 0.15;
/** Height at which bullets travel (rendering only; the sim is 2D). */
export const BULLET_HEIGHT = 1.0;
/** Collision sub-steps per tick for bullets, so fast shots don't tunnel. */
export const BULLET_SUBSTEPS = 3;

/** Seconds -> whole simulation ticks. All timers in the sim count ticks. */
export const ticks = (seconds: number) => Math.max(1, Math.round(seconds * TICK_RATE));

// =============================================================================
// Balance tables. Every tuning number for weapons and abilities lives below.
// Times are in seconds (converted to ticks with `ticks()`), distances in
// metres, angles in radians. Time-to-kill (100 HP, no shield) at ideal range:
//   rifle 5 hits = 0.8 s, SMG 10 hits = 0.9 s, shotgun 2 blasts = 0.7 s,
//   sniper 2 hits = 1.2 s (but one hit + anything finishes).
// =============================================================================

export interface WeaponDef {
  name: string;
  /** Damage per bullet (per pellet for the shotgun). */
  damage: number;
  /** Seconds between two shots. */
  fireInterval: number;
  /** Metres per second. */
  bulletSpeed: number;
  /** Metres a bullet travels before it expires. */
  range: number;
  /** Full cone angle the bullets are spread over, radians. */
  spread: number;
  /** Bullets per shot. */
  pellets: number;
  /** Shots per magazine. */
  magazine: number;
  /** Seconds to reload a magazine. */
  reloadTime: number;
}

/** Index = weapon id (sent over the wire, picked with keys 1-4). */
export const WEAPONS: readonly WeaponDef[] = [
  //  name        damage  fireInterval  bulletSpeed  range  spread  pellets  magazine  reloadTime
  { name: "Rifle",   damage: 20, fireInterval: 0.2, bulletSpeed: 22, range: 18, spread: 0.04, pellets: 1, magazine: 12, reloadTime: 1.5 },
  { name: "Shotgun", damage: 12, fireInterval: 0.7, bulletSpeed: 18, range: 7, spread: 0.4, pellets: 6, magazine: 5, reloadTime: 2.0 },
  { name: "Sniper",  damage: 70, fireInterval: 1.2, bulletSpeed: 45, range: 30, spread: 0, pellets: 1, magazine: 4, reloadTime: 2.5 },
  { name: "SMG",     damage: 11, fireInterval: 0.1, bulletSpeed: 20, range: 12, spread: 0.16, pellets: 1, magazine: 30, reloadTime: 1.8 },
];
export const DEFAULT_WEAPON = 0;

/** Dash (Space): a burst in the move direction, or the facing direction when standing still. */
export const DASH = {
  /** Metres covered by a full, unobstructed dash. */
  distance: 5,
  /** Seconds the dash lasts (rounded to ticks: 5 ticks = 0.167 s). */
  duration: 0.16,
  /** Seconds from the start of a dash until the next one is allowed. */
  cooldown: 3,
} as const;

/** Grenade (Q): lobbed at the cursor, flies over cover, explodes after a fuse. */
export const GRENADE = {
  /** Max throw distance; farther targets are pulled back to this. */
  range: 10,
  /** Horizontal flight speed, m/s. Flight time = distance / speed. */
  flightSpeed: 15,
  /** Shortest flight, seconds (for lobs at your own feet). */
  minFlight: 0.3,
  /** Arc apex height = arcBase + arcPerMetre * distance. Visual only. */
  arcBase: 1,
  arcPerMetre: 0.3,
  /** Seconds between landing and exploding (the telegraph is shown meanwhile). */
  fuse: 0.6,
  /** Blast radius, measured to the edge of the player's body. */
  radius: 3.5,
  /** Damage at the centre, falling off linearly to minDamage at the edge. */
  maxDamage: 60,
  minDamage: 15,
  /** Multiplier applied when the grenade hurts its own thrower. */
  selfDamageScale: 0.5,
  cooldown: 8,
} as const;

/** Shield (E): a bubble that absorbs damage before HP. */
export const SHIELD = {
  /** Seconds the bubble lasts (it also pops early once `absorb` is used up). */
  duration: 2.5,
  /** Damage the bubble soaks before HP is touched. */
  absorb: 40,
  /** Seconds from activation until the next one is allowed. */
  cooldown: 10,
} as const;

// Derived tick counts (do not tune these, tune the tables above).
export const DASH_TICKS = ticks(DASH.duration);
export const DASH_SPEED = DASH.distance / (DASH_TICKS * TICK_DT);
export const DASH_COOLDOWN_TICKS = ticks(DASH.cooldown);
export const GRENADE_COOLDOWN_TICKS = ticks(GRENADE.cooldown);
export const GRENADE_FUSE_TICKS = ticks(GRENADE.fuse);
export const SHIELD_TICKS = ticks(SHIELD.duration);
export const SHIELD_COOLDOWN_TICKS = ticks(SHIELD.cooldown);

// --- Match flow ---
export const KILLS_TO_WIN = 5;
/** Seconds before a dead player comes back. */
export const RESPAWN_DELAY = 2;
/** Seconds the winner banner stays up before the match resets. */
export const MATCH_END_DELAY = 4;

// --- Netcode ---
/** How far in the past remote entities are rendered, in ms. */
export const INTERP_DELAY_MS = 100;
/**
 * Server-side input budget. Each tick grants one token; each processed input
 * costs one. The cap allows catching up after network jitter without letting a
 * client move faster than one input per tick on average (no speed hacks).
 */
export const INPUT_BURST = 4;
/** Inputs queued beyond this are dropped. */
export const MAX_INPUT_QUEUE = 16;

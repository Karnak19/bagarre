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

// --- Weapon / bullets ---
export const BULLET_SPEED = 20;
export const BULLET_RADIUS = 0.15;
/** Seconds a bullet lives before it fizzles out. */
export const BULLET_LIFETIME = 1.2;
export const BULLET_DAMAGE = 20;
/** Seconds between two shots. */
export const FIRE_COOLDOWN = 0.2;
/** Height at which bullets travel (rendering only; the sim is 2D). */
export const BULLET_HEIGHT = 1.0;
/** Collision sub-steps per tick for bullets, so fast shots don't tunnel. */
export const BULLET_SUBSTEPS = 3;

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

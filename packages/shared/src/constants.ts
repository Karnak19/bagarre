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
/**
 * Clients a room accepts on top of its player seats. Nothing uses them yet:
 * they are the room left for spectators (clients with no player seat), so the
 * room's `maxClients` is never the player cap. See the README's seat model.
 */
export const SPECTATOR_ROOM = 20;

// --- Players ---
export const PLAYER_RADIUS = 0.5;
/** Metres per second. */
export const PLAYER_SPEED = 6;
export const MAX_HP = 100;

// --- Bullets (shared by every weapon) ---
export const BULLET_RADIUS = 0.1;
/** Height at which bullets travel (rendering only; the sim is 2D). */
export const BULLET_HEIGHT = 1.0;
/** Minimum collision sub-steps per tick for bullets. */
export const BULLET_SUBSTEPS = 3;
/** Longest distance a bullet may travel in one sub-step, so fast shots can't tunnel through cover or players. */
export const BULLET_MAX_SUBSTEP = 0.25;

/** Seconds -> whole simulation ticks. All timers in the sim count ticks. */
export const ticks = (seconds: number) => Math.max(1, Math.round(seconds * TICK_RATE));

// =============================================================================
// Balance tables. Every tuning number for weapons and abilities lives below.
// Times are in seconds (converted to ticks with `ticks()`), distances in
// metres, angles in radians. Time-to-kill (100 HP, no shield) at ideal range:
//   rifle 5 hits = 0.8 s, SMG 10 hits = 0.9 s, shotgun 2 blasts = 0.7 s,
//   sniper 2 hits = 1.2 s (but one hit + anything finishes),
//   revolver 3 hits = 0.93 s, burst pistol 3 bursts = 1.07 s, DMR 3 hits = 1.13 s.
// =============================================================================

export interface WeaponDef<K extends string = WeaponKey> {
  /** Stable key: what the client's GUN_VIEW (models, sounds, flashes) is looked up by. Never renamed. */
  key: K;
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
  /**
   * Burst fire: rounds one trigger pull fires (default 1). A burst runs to the
   * end even if the button is released, unless the magazine runs dry, a reload
   * starts or the player dies. `fireInterval` is then the time from the start
   * of one burst to the start of the next.
   */
  burst?: number;
  /** Seconds between the rounds of a burst. */
  burstInterval?: number;
}

/**
 * Index = weapon id: sent over the wire (MSG_PICK, `Player.weapon`, the kill
 * feed, which also uses KILL_GRENADE = 255) and picked with the number keys
 * (1 = index 0). Ids are frozen: never reorder or remove a gun, only append.
 *
 * Adding a gun:
 * 1. Append its line here, with a new `key` (the firing rules are generic:
 *    no server change needed).
 * 2. Add its `key` to GUN_VIEW (apps/client/src/items.ts): model, scale,
 *    muzzle flash, shot sound, How to play blurb. It won't compile without it.
 * 3. Add its assets: the model under apps/client/public/models/guns/, and
 *    its shot sound (SfxName and the SFX table in apps/client/src/audio.ts).
 * 4. Append its key to WEAPON_IDS in packages/shared/scripts/items.check.ts.
 */
const WEAPON_LIST = [
  //  name        damage  fireInterval  bulletSpeed  range  spread  pellets  magazine  reloadTime
  { key: "rifle", name: "Rifle",   damage: 20, fireInterval: 0.2, bulletSpeed: 45, range: 18, spread: 0.04, pellets: 1, magazine: 12, reloadTime: 1.5 },
  { key: "shotgun", name: "Shotgun", damage: 12, fireInterval: 0.7, bulletSpeed: 36, range: 7, spread: 0.4, pellets: 6, magazine: 5, reloadTime: 2.0 },
  { key: "sniper", name: "Sniper",  damage: 70, fireInterval: 1.2, bulletSpeed: 90, range: 30, spread: 0, pellets: 1, magazine: 4, reloadTime: 2.5 },
  { key: "smg", name: "SMG",     damage: 11, fireInterval: 0.1, bulletSpeed: 40, range: 12, spread: 0.16, pellets: 1, magazine: 30, reloadTime: 1.8 },
  { key: "revolver", name: "Revolver", damage: 34, fireInterval: 0.45, bulletSpeed: 70, range: 20, spread: 0, pellets: 1, magazine: 6, reloadTime: 2.2 },
  { key: "burst-pistol", name: "Burst pistol", damage: 12, fireInterval: 0.45, bulletSpeed: 42, range: 15, spread: 0.05, pellets: 1, magazine: 15, reloadTime: 1.2, burst: 3, burstInterval: 0.06 },
  { key: "dmr", name: "DMR",     damage: 40, fireInterval: 0.567, bulletSpeed: 80, range: 26, spread: 0.01, pellets: 1, magazine: 8, reloadTime: 2.0 },
] as const satisfies readonly WeaponDef<string>[];
/** A gun's stable key ("rifle", "shotgun", ...). */
export type WeaponKey = (typeof WEAPON_LIST)[number]["key"];
export const WEAPONS: readonly WeaponDef[] = WEAPON_LIST;
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

/**
 * Grenade (Q): lobbed at the cursor, flies over cover, goes off after a fuse.
 * The throw (range, flight, arc, fuse) is the same for every type (see
 * GRENADES below); the blast radius and damage here are the frag's.
 */
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
  /** Frag blast radius, measured to the edge of the player's body. */
  radius: 3.5,
  /** Frag damage at the centre, falling off linearly to minDamage at the edge. */
  maxDamage: 60,
  minDamage: 15,
  /** Multiplier applied when the frag hurts its own thrower. */
  selfDamageScale: 0.5,
} as const;

/**
 * Smoke grenade: leaves a cloud that hides whoever is in it, or behind it,
 * from their enemies (the thrower's side sees through it, faded). Client-side only (see smokeVeil in grenades.ts). No damage.
 */
export const SMOKE = {
  /** Cloud radius, metres. */
  radius: 4,
  /** Seconds the cloud lasts. */
  duration: 8,
} as const;

/** Stun grenade ("para"): everyone in the blast walks slower and can't dash for a while. No damage. */
export const STUN = {
  /** Blast radius, measured to the edge of the player's body (like the frag's). */
  radius: 3.5,
  /** Seconds the stun lasts. */
  duration: 2,
  /** Walking speed multiplier while stunned. */
  speedScale: 0.5,
} as const;

/**
 * Flash grenade: a player who looks toward the blast with no cover in the way
 * gets a white screen, shorter the farther away they are and the farther
 * their aim is from the blast, but never nothing just for looking away:
 * with their back to it they still get `backFactor` of the full length. No damage.
 */
export const FLASH = {
  /** Farther than this from the blast: nothing. */
  range: 14,
  /** Up to this distance: the full length (it then shrinks linearly to 0 at `range`). */
  fullRange: 4,
  /**
   * Share of the full length you still get with your back to the blast (aim
   * 180° off). The angle factor eases from 1 (aiming at it) down to this.
   */
  backFactor: 0.3,
  /** Closer than this it goes off in your face: flashed whatever your aim. */
  pointBlank: 1,
  /** Longest white screen, seconds, and the shortest worth showing (below it: nothing). */
  maxDuration: 2,
  minDuration: 0.3,
} as const;

/**
 * Heal grenade: an instant burst of health for the thrower and their
 * teammates in the radius, with no cover in the way (see `healAmount` in
 * grenades.ts). Never enemies; in a duel or a free for all, only the thrower.
 */
export const HEAL = {
  /** Blast radius, measured to the edge of the player's body (like the frag's and the stun's). */
  radius: 3.5,
  /** HP given to each player it reaches, the same across the whole radius (capped at MAX_HP). */
  amount: 40,
} as const;

/**
 * What a grenade does when it goes off. Each effect has one handler on the
 * server (GameRoom's blastEffects) and reads its own tuning block above:
 * - damage: GRENADE (falloff damage, the kill feed's "Grenade");
 * - cloud: SMOKE (a cloud that hides, drawn by the clients);
 * - stun: STUN (slower walking, no dash);
 * - flash: FLASH (a white screen for whoever looks at it);
 * - heal: HEAL (instant health for the thrower and their teammates).
 */
export type GrenadeEffect = "damage" | "cloud" | "stun" | "flash" | "heal";

/**
 * Who a blast affects (see `grenadeAffects` in combat.ts):
 * - enemies: the friendly-fire rule, `canDamage`. Teammates are spared in a
 *   team mode; in a duel or a free for all it gets the thrower too.
 * - allies: the thrower and their teammates (`self || sameTeam`). Never an
 *   enemy; in a duel or a free for all, only the thrower.
 */
export type GrenadeAffects = "enemies" | "allies";

export interface GrenadeDef<K extends string = GrenadeKey> {
  /** Stable key (test ids, the HUD, the client's GRENADE_VIEW). Never renamed. */
  key: K;
  name: string;
  /** What the blast does: picks the server's handler. */
  effect: GrenadeEffect;
  /** Who the blast affects. Ignored by "cloud", which is the same for everyone. */
  affects: GrenadeAffects;
  /** Seconds from a throw until the next one is allowed. */
  cooldown: number;
  /** The landing telegraph's radius, metres. */
  radius: number;
}

/** `Player.grenade` / `Grenade.kind` values: the index in GRENADES. */
export const GRENADE_FRAG = 0;
export const GRENADE_SMOKE = 1;
export const GRENADE_STUN = 2;
export const GRENADE_FLASH = 3;

/**
 * Index = grenade type (MSG_PICK, `Player.grenade`, `Grenade.kind`). They all
 * share the throw (GRENADE); only the frag hurts, and only the frag counts as
 * the "Grenade" weapon in the kill feed. Ids are frozen (frag 0, smoke 1,
 * stun 2, flash 3, heal 4): never reorder or remove a type, only append.
 *
 * Adding a grenade:
 * 1. Append its line here, with a new `key`, its `effect` and who it `affects`.
 *    A new effect also needs its tuning block above, a GrenadeEffect member
 *    and its handler in blastEffects (apps/server/src/GameRoom.ts).
 * 2. Add its `key` to GRENADE_VIEW (apps/client/src/items.ts): icon,
 *    telegraph colour, blast sound, blast drawing, How to play blurb. It
 *    won't compile without it.
 * 3. Add its assets: the blast sound (SfxName and the SFX table in
 *    apps/client/src/audio.ts), any new particles in vfx.ts.
 * 4. Append its key to GRENADE_IDS in packages/shared/scripts/items.check.ts
 *    (and a new effect or `affects` value to EFFECTS / AFFECTS there).
 */
const GRENADE_LIST = [
  { key: "frag", name: "Frag", effect: "damage", affects: "enemies", cooldown: 8, radius: GRENADE.radius },
  { key: "smoke", name: "Smoke", effect: "cloud", affects: "enemies", cooldown: 12, radius: SMOKE.radius },
  { key: "stun", name: "Stun", effect: "stun", affects: "enemies", cooldown: 10, radius: STUN.radius },
  { key: "flash", name: "Flash", effect: "flash", affects: "enemies", cooldown: 10, radius: 1.2 },
  { key: "heal", name: "Heal", effect: "heal", affects: "allies", cooldown: 14, radius: HEAL.radius },
] as const satisfies readonly GrenadeDef<string>[];
/** A grenade type's stable key ("frag", "smoke", ...). */
export type GrenadeKey = (typeof GRENADE_LIST)[number]["key"];
export const GRENADES: readonly GrenadeDef[] = GRENADE_LIST;
export const DEFAULT_GRENADE = GRENADE_FRAG;

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
export const GRENADE_FUSE_TICKS = ticks(GRENADE.fuse);
export const SMOKE_TICKS = ticks(SMOKE.duration);
export const STUN_TICKS = ticks(STUN.duration);
export const SHIELD_TICKS = ticks(SHIELD.duration);
export const SHIELD_COOLDOWN_TICKS = ticks(SHIELD.cooldown);

// --- Match flow ---
export const KILLS_TO_WIN = 5;
/** Seconds before a dead player comes back. */
export const RESPAWN_DELAY = 2;
/** Seconds the winner banner stays up before the match resets. */
export const MATCH_END_DELAY = 4;
/**
 * Seconds of warmup at the start of every match (ModeRules.warmup): everyone
 * on their start spot, on the real map, free to move and dash and to change
 * their loadout (applied at once), but nobody can shoot, throw, raise the
 * shield or take damage. The match clock starts when it ends.
 */
export const WARMUP_SECONDS = 8;

// --- Free for all (see modes.ts and docs/ffa-maps.md) ---
/** Room name of the free-for-all matchmaking. */
export const FFA_ROOM_NAME = "ffa";
export const FFA_MIN_PLAYERS = 3;
export const FFA_MAX_PLAYERS = 6;
/** First to this many kills wins... */
export const FFA_KILLS_TO_WIN = 15;
/** ...or the most kills after this many seconds. */
export const FFA_TIME_LIMIT = 360;
/** Seconds of countdown once FFA_MIN_PLAYERS are in, before the match starts. */
export const FFA_COUNTDOWN = 10;
/** Below this many players mid-match, the match ends. */
export const FFA_MIN_TO_CONTINUE = 2;
/** Seconds before a dead player comes back in FFA (more players: instant respawns feel spammy). */
export const FFA_RESPAWN_DELAY = 3;
/** Seconds the placement table stays up before the rematch. */
export const FFA_END_DELAY = 8;
/**
 * FFA and team deathmatch: a tie for the most kills when the time runs out
 * goes to sudden death: the match ends as soon as one player (one team)
 * alone has the most kills. If that takes longer than this many seconds, it
 * ends anyway and the tiebreaks of `rank` (modes.ts) pick the winner: most
 * damage, then first to the score, then the lot. Never a draw.
 */
export const SUDDEN_DEATH_MAX = 60;

// --- Team deathmatch (see modes.ts): red against blue, up to 4v4 on the FFA maps ---
/** Room name of the team deathmatch matchmaking. */
export const TEAM_ROOM_NAME = "tdm";
/** Players per team at most: 4v4. */
export const TEAM_SIZE = 4;
export const TEAM_MAX_PLAYERS = 2 * TEAM_SIZE;
/** Connected players each team needs for the countdown to run: 2v2. */
export const TEAM_MIN_PER_TEAM = 2;
export const TEAM_MIN_PLAYERS = 2 * TEAM_MIN_PER_TEAM;
/** The first team to this many kills wins... */
export const TEAM_KILLS_TO_WIN = 25;
/** ...or the team with the most after this many seconds (a tie goes to sudden death, capped by SUDDEN_DEATH_MAX). */
export const TEAM_TIME_LIMIT = 480;
/** Seconds of countdown once both teams have TEAM_MIN_PER_TEAM connected. */
export const TEAM_COUNTDOWN = 10;
export const TEAM_RESPAWN_DELAY = 3;
/** Seconds the result stays up before the rematch. */
export const TEAM_END_DELAY = 8;
/** `Player.team` values. Every player of a duel or an FFA is NO_TEAM. */
export const TEAM_RED = 0;
export const TEAM_BLUE = 1;
export const NO_TEAM = 255;
export const TEAM_NAMES = ["Red", "Blue"] as const;

// --- Netcode ---
/** How far in the past remote entities are rendered, in ms. */
export const INTERP_DELAY_MS = 100;
/**
 * How many ticks the server rewinds its targets when it tests a bullet hit.
 * A shooter sees remote players INTERP_DELAY_MS in the past and aims there, so
 * the server judges each bullet against where its targets were that long ago
 * (lag compensation). Never under 3, so a hit is never judged on live poses.
 */
export const HIT_REWIND_TICKS = Math.max(3, Math.ceil(INTERP_DELAY_MS / TICK_MS));
/**
 * Ticks of player positions the server keeps for that rewind (a ring buffer).
 * Always more than the rewind, or every hit would silently find no frame; 16
 * leaves headroom for adding the shooter's latency later.
 */
export const HIT_HISTORY_FRAMES = Math.max(16, HIT_REWIND_TICKS + 1);
/**
 * Server-side input budget. Each tick grants one token; each processed input
 * costs one. The cap allows catching up after network jitter without letting a
 * client move faster than one input per tick on average (no speed hacks).
 */
export const INPUT_BURST = 4;
/** Inputs queued beyond this are dropped. */
export const MAX_INPUT_QUEUE = 16;
/**
 * Seconds a dropped player's seat is held (Colyseus `allowReconnection`).
 * Meanwhile their character stays where it was, takes no input and can still
 * be shot; after it, the drop is a normal leave.
 */
export const RECONNECT_GRACE_S = 20;
/**
 * Messages per second a client may send before the server closes its
 * connection (Colyseus `maxMessagesPerSecond`). A real client sends TICK_RATE
 * inputs per second plus a latency answer every two seconds; the margin
 * absorbs a network stall whose backlog arrives in one burst. This is flood
 * protection only: the input budget (INPUT_BURST) is what paces the game.
 */
export const MAX_MESSAGES_PER_SECOND = TICK_RATE * 10;

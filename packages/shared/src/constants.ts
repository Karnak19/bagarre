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
  /**
   * False: a starting gun only (the battle royale's Pistol). It never shows
   * in the loadout picker, has no number key and can't be picked (parsePick
   * refuses it). Default true.
   */
  pickable?: boolean;
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
 * 4. Append its key to WEAPON_IDS in packages/shared/src/items.test.ts.
 * 5. For the battle royale: give it a weight in LOOT below (or leave it out:
 *    it then never drops from a crate).
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
  // The battle royale's starting gun, weaker than the burst pistol and the revolver (44 dps against 75-80). Never in the picker.
  { key: "pistol", name: "Pistol",  damage: 14, fireInterval: 0.32, bulletSpeed: 40, range: 14, spread: 0.06, pellets: 1, magazine: 10, reloadTime: 1.4, pickable: false },
] as const satisfies readonly WeaponDef<string>[];
/** A gun's stable key ("rifle", "shotgun", ...). */
export type WeaponKey = (typeof WEAPON_LIST)[number]["key"];
export const WEAPONS: readonly WeaponDef[] = WEAPON_LIST;
export const DEFAULT_WEAPON = 0;
/** The battle royale's starting gun (WEAPONS index). */
export const PISTOL = WEAPONS.findIndex((w) => w.key === "pistol");

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
  /**
   * Battle royale: the most of this type one player carries (grenades are
   * counted there, not on a cooldown: see `takeGrenades` in royale.ts).
   */
  stack: number;
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
 * 4. Append its key to GRENADE_IDS in packages/shared/src/items.test.ts
 *    (and a new effect or `affects` value to EFFECTS / AFFECTS there).
 * 5. For the battle royale: its `stack`, and a weight in LOOT below.
 */
const GRENADE_LIST = [
  { key: "frag", name: "Frag", effect: "damage", affects: "enemies", cooldown: 8, radius: GRENADE.radius, stack: 3 },
  { key: "smoke", name: "Smoke", effect: "cloud", affects: "enemies", cooldown: 12, radius: SMOKE.radius, stack: 2 },
  { key: "stun", name: "Stun", effect: "stun", affects: "enemies", cooldown: 10, radius: STUN.radius, stack: 2 },
  { key: "flash", name: "Flash", effect: "flash", affects: "enemies", cooldown: 10, radius: 1.2, stack: 2 },
  { key: "heal", name: "Heal", effect: "heal", affects: "allies", cooldown: 14, radius: HEAL.radius, stack: 2 },
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
  /** Seconds from activation until the next one is allowed (battle royale: charges instead, see ROYALE.shieldStack). */
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

// --- Battle royale (see modes.ts and royale.ts): one life, crates, a closing zone ---
/** Room name of the battle royale matchmaking. */
export const ROYALE_ROOM_NAME = "royale";
export const ROYALE_MIN_PLAYERS = 2;
export const ROYALE_MAX_PLAYERS = 10;
/**
 * The pre-match, once the host pressed Start (there is no countdown before
 * it): everyone on their start spot with the Pistol, nothing to pick.
 */
export const ROYALE_WARMUP = 5;
/** Seconds the placement table stays up before everyone is back in the lobby (the host starts the next match). */
export const ROYALE_END_DELAY = 10;
/**
 * A royale that started with fewer players than this isn't counted in the
 * stats (its row isn't written): with two, one kill would be a win, cheaper
 * than a duel's 5 kills. From 3 up it is at least as hard as a 3-player FFA.
 */
export const ROYALE_MIN_RECORDED = 3;

/** Gun slots, floor items and crates (royale only). */
export const ROYALE = {
  /** Guns carried at most. Slot 1 starts with the Pistol. */
  gunSlots: 3,
  /** Seconds from a switch (or a swap) until the new gun may fire; a reload in progress is cancelled. */
  switchTime: 0.3,
  /** Seconds between two throws from a grenade stack (counted grenades have no cooldown). */
  throwGap: 1,
  /** An item is picked up when the player's centre is this close to it. */
  pickupRadius: 0.9,
  /** A crate breaks open when a player's body touches this circle. */
  crateRadius: 0.6,
  /** Items on the floor at most; past it the oldest one goes. */
  maxItems: 60,
  /** A dead player's items land this far round where they fell. */
  dropSpread: 1.1,
  /** Walking speed multiplier while a healing item is being used (HEAL_ITEMS). */
  healSpeedScale: 0.5,
  /** Shield charges carried at most (royale only: the shield is counted there, not on SHIELD.cooldown). */
  shieldStack: 3,
  /**
   * Seconds between the end of one shield bubble and the next one: a charge
   * can't go up until SHIELD.duration + this after the last one, so three
   * charges never chain into one long bubble.
   */
  shieldGap: 1,
} as const;

/** Battle royale: ticks from a shield charge going up until the next may (the bubble, then ROYALE.shieldGap). */
export const SHIELD_CHARGE_TICKS = ticks(SHIELD.duration + ROYALE.shieldGap);

/**
 * A healing item (battle royale only): used with its key, it heals `amount`
 * HP (never past MAX_HP) once `duration` has run, if nothing cancelled it
 * (see `stepPlayer` and `HEAL_STOP` in royale.ts). A cancelled heal keeps the
 * item; it is only used up when the heal completes.
 */
export interface HealItemDef<K extends string = HealKey> {
  /** Stable key (test ids, the HUD, the loot table). Never renamed. */
  key: K;
  name: string;
  /** HP given when it completes (MAX_HP: back to full), capped at MAX_HP. */
  amount: number;
  /** Seconds it takes; the player walks at ROYALE.healSpeedScale meanwhile. */
  duration: number;
  /** The most of it one player carries. */
  stack: number;
}

/**
 * Index = healing item id (`FloorItem.item` of an ITEM_HEAL, `InputMessage.heal`,
 * `KitSim.heal`), and its key is the number key after the gun slots: 4 is
 * the first, 5 the second. Ids are frozen: append only.
 */
const HEAL_LIST = [
  { key: "bandage", name: "Bandage", amount: 25, duration: 1.5, stack: 5 },
  { key: "medkit", name: "Medkit", amount: MAX_HP, duration: 4, stack: 2 },
] as const satisfies readonly HealItemDef<string>[];
/** A healing item's stable key ("bandage", "medkit"). */
export type HealKey = (typeof HEAL_LIST)[number]["key"];
export const HEAL_ITEMS: readonly HealItemDef[] = HEAL_LIST;
export const HEAL_BANDAGE = 0;
export const HEAL_MEDKIT = 1;
/** `KitSim.heal` when no heal is in progress. */
export const NO_HEAL = 255;

/**
 * The closing zone: a circle round the whole map that waits, then shrinks
 * smoothly to nothing (ModeRules.royale holds the timings, so tests can
 * shorten them). Outside it you take damage every tick, more as time goes on.
 */
export const ZONE = {
  /** Seconds after the match starts before it shrinks. */
  wait: 30,
  /** Seconds after the match starts when it is closed (radius 0). */
  close: 270,
  /** Damage per second outside it when it starts shrinking, and once it is closed (linear in between). */
  dpsStart: 2,
  dpsEnd: 14,
  /** Metres past the map's corners the starting circle reaches. */
  margin: 2,
} as const;

/**
 * Kinds of item on the floor (`FloorItem.kind`). Index = id on the wire:
 * append-only, like WEAPONS and GRENADES. `item` says which one (a WEAPONS
 * index for a gun, a GRENADES index for grenades) and `amount` how many (a
 * gun's magazine, a stack's count). Healing items (a HEAL_ITEMS index) and
 * shield charges came after (#34).
 */
export const ITEM_KINDS = ["gun", "grenade", "heal", "shield"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_GUN = 0;
export const ITEM_GRENADE = 1;
/** A stack of healing items: `item` is a HEAL_ITEMS index. */
export const ITEM_HEAL = 2;
/** Shield charges: `item` is always 0. */
export const ITEM_SHIELD = 3;

/** One line of the loot table: what a crate may drop, and how often (weights, not percentages). */
export type LootEntry =
  | { weight: number; kind: "gun"; key: WeaponKey }
  | { weight: number; kind: "grenade"; key: GrenadeKey; amount: number }
  | { weight: number; kind: "heal"; key: HealKey; amount: number }
  | { weight: number; kind: "shield"; amount: number };

/**
 * What a crate drops, one entry drawn by weight (`rollLoot` in royale.ts).
 * The one place to tune the royale's loot. A gun drops with a full magazine.
 */
export const LOOT: readonly LootEntry[] = [
  { weight: 12, kind: "gun", key: "rifle" },
  { weight: 10, kind: "gun", key: "smg" },
  { weight: 8, kind: "gun", key: "shotgun" },
  { weight: 7, kind: "gun", key: "burst-pistol" },
  { weight: 6, kind: "gun", key: "revolver" },
  { weight: 5, kind: "gun", key: "dmr" },
  { weight: 3, kind: "gun", key: "sniper" },
  { weight: 9, kind: "grenade", key: "frag", amount: 2 },
  { weight: 5, kind: "grenade", key: "smoke", amount: 1 },
  { weight: 5, kind: "grenade", key: "stun", amount: 1 },
  { weight: 4, kind: "grenade", key: "flash", amount: 1 },
  { weight: 4, kind: "grenade", key: "heal", amount: 1 },
  // Bandages are common, medkits rare.
  { weight: 14, kind: "heal", key: "bandage", amount: 2 },
  { weight: 3, kind: "heal", key: "medkit", amount: 1 },
  { weight: 7, kind: "shield", amount: 1 },
];

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

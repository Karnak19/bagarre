import { schema, t, type SchemaType } from "@colyseus/schema";
import { DEFAULT_GRENADE, DEFAULT_MAP_ID, DEFAULT_WEAPON, MAX_HP, NO_GUN, NO_HEAL, NO_PERK, NO_TEAM, WEAPONS } from "@bagarre/shared";

/**
 * What a player carries in the battle royale (KitSim in @bagarre/shared):
 * three gun slots with their magazines, the slot in hand, the grenade
 * count, the healing items and shield charges, the heal in progress, and the
 * switch / swap / use press counters. A child of Player, so the royale's
 * items never push Player near the 63-field cap. Part of the prediction's state like the rest of
 * PlayerSim, hence synced in full. Unused (empty) in the other modes.
 */
export const Kit = schema(
  {
    hand: t.uint8().default(0),
    gun0: t.uint8().default(NO_GUN),
    gun1: t.uint8().default(NO_GUN),
    gun2: t.uint8().default(NO_GUN),
    mag0: t.uint8().default(0),
    mag1: t.uint8().default(0),
    mag2: t.uint8().default(0),
    grenades: t.uint8().default(0),
    switchSeen: t.uint32().default(0),
    swapSeen: t.uint32().default(0),
    // Healing items and shield charges (#34), and the heal in progress.
    bandages: t.uint8().default(0),
    medkits: t.uint8().default(0),
    shields: t.uint8().default(0),
    heal: t.uint8().default(NO_HEAL),
    healTicks: t.uint16().default(0),
    healStop: t.uint8().default(0),
    useSeen: t.uint32().default(0),
  },
  "Kit",
);
export type Kit = SchemaType<typeof Kit>;

// Positions and the dash direction are float64 on purpose: the client re-runs
// the shared step function from these exact values during reconciliation. A
// lossy float32 would make the replayed prediction drift from the server.
// Every field of PlayerSim is synced for the same reason.
export const Player = schema(
  {
    x: t.float64().default(0),
    z: t.float64().default(0),
    aim: t.float32().default(0),
    hp: t.uint8().default(MAX_HP),
    kills: t.uint8().default(0),
    alive: t.boolean().default(true),
    lastSeq: t.uint32().default(0),
    slot: t.uint8().default(0),
    /** TEAM_RED / TEAM_BLUE in a team deathmatch, NO_TEAM otherwise. */
    team: t.uint8().default(NO_TEAM),
    respawnTicks: t.uint16().default(0),

    // Simulation state (see PlayerSim in packages/shared/src/protocol.ts).
    dashTicks: t.uint8().default(0),
    dashDx: t.float64().default(0),
    dashDz: t.float64().default(0),
    dashCd: t.uint16().default(0),
    fireCd: t.uint16().default(0),
    grenadeCd: t.uint16().default(0),
    shieldCd: t.uint16().default(0),
    ammo: t.uint8().default(WEAPONS[DEFAULT_WEAPON].magazine),
    reloadTicks: t.uint16().default(0),
    dashSeen: t.uint32().default(0),
    grenadeSeen: t.uint32().default(0),
    shieldSeen: t.uint32().default(0),
    reloadSeen: t.uint32().default(0),
    burstLeft: t.uint8().default(0),

    weapon: t.uint8().default(DEFAULT_WEAPON),
    pick: t.uint8().default(DEFAULT_WEAPON),
    shieldTicks: t.uint16().default(0),
    shieldHp: t.uint8().default(0),

    /** Display name (username or "Guest-1234"), set by the server at join. */
    name: t.string().default(""),
    /** Signed in with a username. */
    account: t.boolean().default(false),

    // Scoreboard, per match (see PlayerView). Counted here, never by clients.
    deaths: t.uint8().default(0),
    shots: t.uint16().default(0),
    hits: t.uint16().default(0),
    damage: t.uint16().default(0),
    /** Final place once the match ended (1 = first, all different, see `rank`); 0 while it runs. */
    place: t.uint8().default(0),
    /** Round trip in ms, measured by the server. */
    ping: t.uint16().default(0),
    /** False while the server holds a dropped player's seat (see GameRoom.onDrop). */
    connected: t.boolean().default(true),
    /**
     * The skin worn (a SKINS id), set by the server at join, in the same patch
     * that adds the player: the account's saved one, else a random one. Never
     * taken from the client. Last on purpose: fields keep their index, and a
     * client decodes the fields the server's handshake describes, so an older
     * client just never reads it.
     */
    skin: t.string().default(""),

    // Grenades (appended after `skin` for the same reason).
    /** Stun steps left (PlayerSim.stunTicks): read by the shared step, so it's predicted. */
    stunTicks: t.uint16().default(0),
    /** Grenade type in hand, and the one picked for the next spawn (GRENADES index). */
    grenade: t.uint8().default(DEFAULT_GRENADE),
    grenadePick: t.uint8().default(DEFAULT_GRENADE),
    /** Flash: the tick the white screen ends on, and its full length in ticks (for the fade). */
    flashEnd: t.uint32().default(0),
    flashTicks: t.uint16().default(0),

    // Battle royale (appended, like the grenades).
    /** Gun slots and grenade stack (see Kit). */
    kit: Kit,
    /** The tick this player was knocked out on (0: still in). Their place follows from it. */
    outTick: t.uint32().default(0),

    // Melee strike (appended, like the grenades): PlayerSim.meleeCd / meleeSeen,
    // read by the shared step. Other clients see a strike as `meleeCd` jumping up.
    meleeCd: t.uint16().default(0),
    meleeSeen: t.uint32().default(0),

    // Perks (appended, like the grenades). `perk` is PlayerSim.perk, read by
    // the shared step (dash, magazine, reload); `perkPick` the loadout's, put
    // in hand on the next spawn. Both NO_PERK for none.
    perk: t.uint8().default(NO_PERK),
    perkPick: t.uint8().default(NO_PERK),

    /** A bot (PlayerView.bot): a seat the server drives, no client behind it. Appended, like the grenades. */
    bot: t.boolean().default(false),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

export const Bullet = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    owner: t.string().default(""),
  },
  "Bullet",
);
export type Bullet = SchemaType<typeof Bullet>;

export const Grenade = schema(
  {
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    tx: t.float32().default(0),
    tz: t.float32().default(0),
    landed: t.boolean().default(false),
    exploded: t.boolean().default(false),
    owner: t.string().default(""),
    /** Its type (GRENADES index), fixed at the throw. */
    kind: t.uint8().default(DEFAULT_GRENADE),
  },
  "Grenade",
);
export type Grenade = SchemaType<typeof Grenade>;

/** A smoke cloud on the ground (SmokeView in @bagarre/shared). */
export const Smoke = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    start: t.uint32().default(0),
    end: t.uint32().default(0),
    /** Session id of the thrower, and their team (NO_TEAM outside teams): their side sees through the cloud. */
    owner: t.string().default(""),
    team: t.uint8().default(NO_TEAM),
  },
  "Smoke",
);
export type Smoke = SchemaType<typeof Smoke>;

/** Something on the floor in the battle royale (FloorItemView in @bagarre/shared). Owned by the server. */
export const FloorItem = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    /** ITEM_KINDS index, then which one (WEAPONS / GRENADES / HEAL_ITEMS index, 0 for shield charges), then how many (magazine, stack). */
    kind: t.uint8().default(0),
    item: t.uint8().default(0),
    amount: t.uint8().default(0),
    /** Who dropped it under their feet and hasn't stepped off it yet (a session id; "": nobody). See floor.ts. */
    blockedFor: t.string().default(""),
    /** A chest's loot: the chest it pops out of, the tick it does, and the tick it lands (nobody takes it before). 0 for the rest. */
    fromX: t.float32().default(0),
    fromZ: t.float32().default(0),
    dropTick: t.uint32().default(0),
    readyTick: t.uint32().default(0),
  },
  "FloorItem",
);
export type FloorItem = SchemaType<typeof FloorItem>;

/** A chest (CrateView): F opens it once; it stays, open, until the match ends. */
export const Crate = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    open: t.boolean().default(false),
  },
  "Crate",
);
export type Crate = SchemaType<typeof Crate>;

/** The battle royale's zone as a few numbers (ZoneView); `zoneAt` gives the circle of any tick. `end` 0: none. */
export const Zone = schema(
  {
    x0: t.float32().default(0),
    z0: t.float32().default(0),
    x1: t.float32().default(0),
    z1: t.float32().default(0),
    r0: t.float32().default(0),
    r1: t.float32().default(0),
    start: t.uint32().default(0),
    end: t.uint32().default(0),
  },
  "Zone",
);
export type Zone = SchemaType<typeof Zone>;

/** One line of the kill feed (KillView in @bagarre/shared). */
export const KillEvent = schema(
  {
    n: t.uint32().default(0),
    tick: t.uint32().default(0),
    killer: t.string().default(""),
    killerName: t.string().default(""),
    killerSlot: t.uint8().default(0),
    victim: t.string().default(""),
    victimName: t.string().default(""),
    victimSlot: t.uint8().default(0),
    killerTeam: t.uint8().default(NO_TEAM),
    victimTeam: t.uint8().default(NO_TEAM),
    weapon: t.uint8().default(0),
  },
  "KillEvent",
);
export type KillEvent = SchemaType<typeof KillEvent>;

/** The room state of every mode (RoomStateView in @bagarre/shared). */
export const GameState = schema(
  {
    /** "duel", "ffa", "tdm" or "royale", from the room's rules. Never changes. */
    mode: t.string().default("duel"),
    phase: t.string().default("waiting"),
    winner: t.string().default(""),
    /** Why the winner won when level on kills: "damage", "first", "lot" (TiebreakReason), "" outright. */
    tiebreak: t.string().default(""),
    /** Team deathmatch: each team's kills this match, and the winner once it ended (NO_TEAM until then). */
    redScore: t.uint16().default(0),
    blueScore: t.uint16().default(0),
    winningTeam: t.uint8().default(NO_TEAM),
    tick: t.uint32().default(0),
    /**
     * The map being played (a `MapDef.id`). Only changes between matches, in
     * the same tick that puts the players on the new map's spawns.
     */
    mapId: t.string().default(DEFAULT_MAP_ID),
    /** Tick the current match started on (its warmup's end; 0 during warmup), and ended on (0 while it runs). */
    startTick: t.uint32().default(0),
    endTick: t.uint32().default(0),
    /** From the mode's rules, so clients show the right target and clock. */
    killsToWin: t.uint8().default(0),
    timeLimit: t.uint16().default(0),
    /** Ticks left of the pre-match countdown (0: not counting down). */
    countdown: t.uint16().default(0),
    /** Session id of the host: the first seated player in join order ("" with none). The battle royale's host starts the match. */
    host: t.string().default(""),
    suddenDeath: t.boolean().default(false),
    players: t.map(Player),
    bullets: t.map(Bullet),
    grenades: t.map(Grenade),
    /** The last KILL_FEED_SIZE deaths, oldest first. */
    feed: t.array(KillEvent),
    /** Spectators connected (clients with no seat), capped at 255 for the sync. */
    spectators: t.uint8().default(0),
    /** Smoke clouds on the ground; each is removed once it clears. */
    smokes: t.map(Smoke),
    /** Warmup: the tick it ends on, the match starts then (0 outside warmup). Synced as a tick so every client's timer agrees. */
    warmupEnd: t.uint32().default(0),
    /** Battle royale: items on the floor, the chests (by id), and the zone. Empty in the other modes. */
    items: t.map(FloorItem),
    crates: t.map(Crate),
    zone: Zone,
  },
  "GameState",
);
export type GameState = SchemaType<typeof GameState>;

import { schema, t, type SchemaType } from "@colyseus/schema";
import { DEFAULT_MAP_ID, DEFAULT_WEAPON, MAX_HP, WEAPONS } from "@bagarre/shared";

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

    weapon: t.uint8().default(DEFAULT_WEAPON),
    pick: t.uint8().default(DEFAULT_WEAPON),
    shieldTicks: t.uint16().default(0),
    shieldHp: t.uint8().default(0),

    /** Display name (username or "Guest-1234"), set by the server at join. */
    name: t.string().default(""),
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
  },
  "Grenade",
);
export type Grenade = SchemaType<typeof Grenade>;

export const DuelState = schema(
  {
    phase: t.string().default("waiting"),
    winner: t.string().default(""),
    tick: t.uint32().default(0),
    /**
     * The map being played (a `MapDef.id`). Only changes between matches, in
     * the same tick that puts the players on the new map's spawns.
     */
    mapId: t.string().default(DEFAULT_MAP_ID),
    players: t.map(Player),
    bullets: t.map(Bullet),
    grenades: t.map(Grenade),
  },
  "DuelState",
);
export type DuelState = SchemaType<typeof DuelState>;

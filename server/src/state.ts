import { schema, t, type SchemaType } from "@colyseus/schema";
import { MAX_HP } from "@bagarre/shared";

// Positions are float64 on purpose: the client re-runs the shared step
// function from these exact values during reconciliation. A lossy float32
// would make the replayed prediction drift from what the server computed.
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

export const DuelState = schema(
  {
    phase: t.string().default("waiting"),
    winner: t.string().default(""),
    tick: t.uint32().default(0),
    players: t.map(Player),
    bullets: t.map(Bullet),
  },
  "DuelState",
);
export type DuelState = SchemaType<typeof DuelState>;

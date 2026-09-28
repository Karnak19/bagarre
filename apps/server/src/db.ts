// The game's database: accounts (@colyseus/auth's users, plus our username
// and stats columns) and the matches already recorded.
//
// The driver comes from DATABASE_URL: set, it is Postgres (postgres-js, the
// production setup, see docker-compose.yaml); unset, it is PGlite, an embedded
// Postgres, in a folder for `bun run dev` (so accounts survive a restart) or in
// memory for the smoke and e2e servers. @colyseus/database loads PGlite with a
// dynamic import only on that path, and the compiled server binary leaves it
// out (`--external`, see package.json): production never needs it.
//
// Schema changes run at boot, from the code itself (no drizzle-kit, no files
// next to the binary): @colyseus/database's `migrations: "auto"` creates the
// users table, adds any column we add to it and creates its indexes; our own
// tables are created by BAGARRE_MIGRATIONS below. Both are idempotent, so
// every boot runs them. Neither ever drops or retypes a column: a change like
// that needs a new migration statement here.

import { mkdirSync } from "node:fs";
import { columns, GameDatabase } from "@colyseus/database";
import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * @colyseus/auth's users table, extended. Every added column is nullable or
 * has a default: the package's own inserts (sign up, Discord) only fill the
 * built-in columns.
 */
export const users = pgTable(
  "colyseus_users",
  {
    ...columns.pg.users,
    /** Display name, as the player typed it. Null until they pick one. */
    username: text("username"),
    /** Lowercased username, for case-insensitive uniqueness. */
    usernameKey: text("username_key"),
    kills: integer("kills").notNull().default(0),
    deaths: integer("deaths").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    matches: integer("matches").notNull().default(0),
    /** The saved skin (a SKINS id). Null: a random one at every match, like a guest. */
    skin: text("skin"),
  },
  (t) => [uniqueIndex("colyseus_users_username_key_idx").on(t.usernameKey)],
);

export interface Placement {
  userId: string;
  place: number;
  kills: number;
  deaths: number;
  /** Team deathmatch: 0 red, 1 blue. Absent in the other modes. */
  team?: number;
}

/**
 * One row per match already recorded, so recording the same match twice is a
 * no-op. Keeps the mode and each account player's place (and team).
 */
export const matches = pgTable("bagarre_matches", {
  matchId: text("match_id").primaryKey(),
  mode: text("mode").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  placements: jsonb("placements").$type<Placement[]>().notNull(),
});

/** Our own tables. Append only; each statement must be safe to run on every boot. */
const BAGARRE_MIGRATIONS = [
  sql`CREATE TABLE IF NOT EXISTS bagarre_matches (
    match_id text PRIMARY KEY,
    mode text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    placements jsonb NOT NULL
  )`,
];

const schemas = { users };
export type Database = GameDatabase<typeof schemas, "pg">;

/**
 * Where the data lives: `memory` (tests), or a connection string
 * (`postgres://…`, `pglite://<folder>`).
 */
export type DatabaseLocation = "memory" | string;

/** The dev default when DATABASE_URL is unset: a PGlite folder, git-ignored. */
const DEV_PGLITE = "pglite://./.data/pglite";

export function databaseLocationFromEnv(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production (postgres://user:password@host:5432/db)");
  }
  return DEV_PGLITE;
}

export function createDatabase(location: DatabaseLocation = databaseLocationFromEnv()): Database {
  const connectionString = location === "memory" ? "pglite://:memory:" : location;
  if (!/^(postgres|postgresql|pglite):\/\//.test(connectionString)) {
    throw new Error(`DATABASE_URL must be a postgres:// URL (got "${connectionString.split(":")[0]}:…")`);
  }
  if (connectionString.startsWith("pglite://./")) {
    // PGlite doesn't create the parent folders of its data directory.
    const dir = connectionString.slice("pglite://".length);
    mkdirSync(dir, { recursive: true });
  }
  if (connectionString.startsWith("pglite://")) {
    return new GameDatabase<typeof schemas, "pg">({ dialect: "pg", connectionString, migrations: "auto", schemas });
  }
  return new GameDatabase<typeof schemas, "pg">({
    dialect: "pg",
    connectionString,
    migrations: "auto",
    schemas,
    // The migrations' "already exists, skipping" notices, on every boot.
    connection: { onnotice: () => {} },
  });
}

/** Boots the database (the package's migrations), then runs ours. */
export async function bootDatabase(db: Database): Promise<void> {
  await db.boot();
  for (const stmt of BAGARRE_MIGRATIONS) await db.drizzle.execute(stmt);
}

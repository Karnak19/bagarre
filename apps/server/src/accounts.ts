// Player identity and match stats, from the game server's side.
//
// The server never trusts a name sent by the client. At join time it gets the
// @colyseus/auth token from the Colyseus auth header and:
//   - no token            -> a guest with a generated name;
//   - a valid token       -> an account: the user id from the token, the
//                            username read from the database;
//   - an invalid token    -> a guest too (bad signature, expired, revoked, or
//                            the account is gone): playing never needs an
//                            account, so a stale session never blocks a join.
//
// The accounts live in the game's own database (db.ts). At the end of a match
// GameRoom sends each account player's result to `recordMatch`.

import { JWT } from "@colyseus/auth";
import {
  LEADERBOARD_SIZE,
  MODES,
  usernameError,
  usernameKey,
  type Account,
  type ClaimResult,
  type GameMode,
  type LeaderboardEntry,
  type Profile,
  type Stats,
} from "@bagarre/shared";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { matches, users, type Database, type Placement } from "./db.ts";

export type Identity =
  | { kind: "guest"; name: string }
  | { kind: "account"; name: string; userId: string; username: string | null };

export interface MatchResult {
  userId: string;
  kills: number;
  deaths: number;
  /** First place, or on the winning team with teams. There is always exactly one winner (or winning team). */
  won: boolean;
  /**
   * Final place, 1 = first, never shared (see `rank` in @bagarre/shared).
   * With teams: the winning team's players first, then the others.
   */
  place: number;
  /** Team deathmatch: the player's team (TEAM_RED or TEAM_BLUE). Absent in the other modes. */
  team?: number;
}

/** What a session token carries (see auth.ts, `onGenerateToken`). */
export interface TokenPayload {
  id: string;
  tokenVersion: number;
}

let database: Database | null = null;

/** Set once by createServer, after which every function below reads and writes it. */
export function useDatabase(db: Database) {
  database = db;
}

/** The database createServer gave us (the smoke test reads and writes it directly). */
export function db(): Database {
  if (!database) throw new Error("[accounts] no database (createServer sets it)");
  return database;
}

/** Test hook: called with every match recorded (the smoke test watches it). */
export const accountHooks: { onRecord?: (matchId: string, players: MatchResult[], mode: GameMode) => void } = {};

export function guestName(taken: Set<string> = new Set()): string {
  for (;;) {
    const name = `Guest-${String(1000 + Math.floor(Math.random() * 9000))}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Checks a session token: its signature and expiry, then that it hasn't been
 * revoked (the account's token version moves on a password reset). Returns
 * the account's id, or null.
 */
export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    return await sessionUser(await JWT.verify(token));
  } catch {
    return null;
  }
}

/** The account id of an already verified token's payload, or null when it has been revoked. */
export async function sessionUser(payload: unknown): Promise<string | null> {
  const p = payload as Partial<TokenPayload> | null;
  if (typeof p?.id !== "string" || typeof p.tokenVersion !== "number") return null;
  const [row] = await db()
    .drizzle.select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, p.id))
    .limit(1);
  return row && row.tokenVersion === p.tokenVersion ? p.id : null;
}

/** Resolves the player's identity from the join token. Never throws for a bad token. */
export async function resolveIdentity(token: string | undefined): Promise<Identity> {
  if (!token) return { kind: "guest", name: guestName() };
  const userId = await verifySession(token);
  if (!userId) {
    console.warn("[accounts] invalid or expired session token, joining as a guest");
    return { kind: "guest", name: guestName() };
  }
  const username = await usernameOf(userId);
  return { kind: "account", userId, username, name: username ?? guestName() };
}

async function usernameOf(userId: string): Promise<string | null> {
  try {
    const [row] = await db().drizzle.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.username ?? null;
  } catch (err) {
    console.warn("[accounts] username lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

type UserRow = typeof users.$inferSelect;

const statsOf = (r: UserRow): Stats => ({ kills: r.kills, deaths: r.deaths, wins: r.wins, losses: r.losses, matches: r.matches });

/** The signed-in player's account, or null when it doesn't exist (anymore). */
export async function accountById(userId: string): Promise<Account | null> {
  const [row] = await db().drizzle.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;
  return { id: row.id, email: row.email, username: row.username, createdAt: row.createdAt.getTime(), stats: statsOf(row) };
}

/** Anyone's public profile by username (case-insensitive), or null. */
export async function publicProfile(username: string): Promise<Profile | null> {
  const [row] = await db()
    .drizzle.select()
    .from(users)
    .where(eq(users.usernameKey, usernameKey(username.trim())))
    .limit(1);
  if (!row?.username) return null;
  return { username: row.username, createdAt: row.createdAt.getTime(), stats: statsOf(row) };
}

/**
 * Sets the player's username: the first one, or a new one. Expected failures
 * (invalid, taken) come back as a result so the form can show them inline.
 */
export async function claimUsername(userId: string, username: string): Promise<ClaimResult> {
  const name = username.trim();
  const invalid = usernameError(name);
  if (invalid) return { ok: false, reason: "invalid", message: invalid };
  const key = usernameKey(name);
  const taken: ClaimResult = { ok: false, reason: "taken", message: "That name is taken." };

  const [holder] = await db().drizzle.select({ id: users.id }).from(users).where(eq(users.usernameKey, key)).limit(1);
  if (holder && holder.id !== userId) return taken;
  try {
    const updated = await db()
      .drizzle.update(users)
      .set({ username: name, usernameKey: key, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (updated.length === 0) throw new Error("No such account");
  } catch (err) {
    // Two players claiming the same name at once: the unique index decides.
    if (isUniqueViolation(err)) return taken;
    throw err;
  }
  return { ok: true, username: name };
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/** The top accounts by wins (then kills), among those that have played. */
export async function leaderboard(limit = LEADERBOARD_SIZE): Promise<LeaderboardEntry[]> {
  const rows = await db()
    .drizzle.select()
    .from(users)
    .where(and(isNotNull(users.username), gt(users.matches, 0)))
    .orderBy(desc(users.wins), desc(users.kills), users.matches, users.createdAt)
    .limit(limit);
  return rows.map((r, i) => ({ rank: i + 1, username: r.username!, ...statsOf(r) }));
}

/** Most players any match can have: a place is never higher. */
const MAX_MATCH_PLAYERS = MODES.tdm.maxPlayers;

/**
 * Writes a finished match: one row for the match, and each account player's
 * stats. Idempotent per `matchId`: recording it again changes nothing.
 *
 * Every mode alike: `won` is a win, anything else a loss. In a duel and a
 * free-for-all a win is first place; in a team deathmatch it is being on the
 * winning team. A match is never a draw (see `rank` in @bagarre/shared). An
 * account that never picked a username gets its place on the match row, but
 * no stats.
 */
export async function writeMatch(
  matchId: string,
  players: MatchResult[],
  mode: GameMode,
): Promise<{ status: "recorded" | "duplicate"; updated: number }> {
  if (matchId.length === 0 || matchId.length > 128) throw new Error("Bad matchId");
  const most = MODES[mode].maxPlayers;
  if (players.length > most) throw new Error(`A ${mode} has at most ${most} players`);
  for (const p of players) {
    for (const n of [p.kills, p.deaths]) {
      if (!Number.isInteger(n) || n < 0 || n > 1000) throw new Error("Bad counter");
    }
    if (!Number.isInteger(p.place) || p.place < 1 || p.place > MAX_MATCH_PLAYERS) throw new Error("Bad place");
    if (p.team !== undefined && p.team !== 0 && p.team !== 1) throw new Error("Bad team");
  }

  const placements: Placement[] = players.map((p) => ({
    userId: p.userId,
    place: p.place,
    kills: p.kills,
    deaths: p.deaths,
    ...(p.team !== undefined ? { team: p.team } : {}),
  }));
  return db().drizzle.transaction(async (tx) => {
    const inserted = await tx
      .insert(matches)
      .values({ matchId, mode, placements })
      .onConflictDoNothing()
      .returning({ matchId: matches.matchId });
    if (inserted.length === 0) return { status: "duplicate" as const, updated: 0 };
    let updated = 0;
    for (const p of players) {
      const rows = await tx
        .update(users)
        .set({
          kills: sql`${users.kills} + ${p.kills}`,
          deaths: sql`${users.deaths} + ${p.deaths}`,
          wins: sql`${users.wins} + ${p.won ? 1 : 0}`,
          losses: sql`${users.losses} + ${p.won ? 0 : 1}`,
          matches: sql`${users.matches} + 1`,
        })
        .where(and(eq(users.id, p.userId), isNotNull(users.username)))
        .returning({ id: users.id });
      updated += rows.length;
    }
    return { status: "recorded" as const, updated };
  });
}

/** The recorded row of a match, or null (the smoke test reads it back). */
export async function matchRow(matchId: string) {
  const [row] = await db().drizzle.select().from(matches).where(eq(matches.matchId, matchId)).limit(1);
  return row ?? null;
}

/**
 * Records a finished match for its account players, retrying a few times.
 * Safe to retry because writeMatch is idempotent per matchId.
 */
export async function recordMatch(matchId: string, players: MatchResult[], mode: GameMode): Promise<void> {
  if (players.length === 0) return;
  accountHooks.onRecord?.(matchId, players, mode);
  for (let attempt = 1; ; attempt++) {
    try {
      await writeMatch(matchId, players, mode);
      return;
    } catch (err) {
      if (attempt >= 3) {
        console.error(`[accounts] could not record match ${matchId}:`, err);
        return;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { modeValidator } from "./schema";

/**
 * Compares two strings in time that depends only on their lengths, not on
 * where they first differ. (No node:crypto in the Convex runtime.)
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  const len = Math.max(ea.length, eb.length);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const count = v.number();

/** Most players a match of each mode can have. */
const MAX_PLAYERS = { duel: 2, ffa: 6, tdm: 8 } as const;
const MAX_MATCH_PLAYERS = MAX_PLAYERS.tdm;

/**
 * Called by the game server, once per finished match, with the account
 * players of that match (guests are never sent). Public so the server can
 * call it over HTTP, but it only accepts calls carrying GAME_SERVER_SECRET.
 * Idempotent per `matchId`: a retry after a lost response changes nothing.
 *
 * Every mode alike: `won` is a win, anything else a loss. In a duel and a
 * free-for-all a win is first place; in a team deathmatch it is being on
 * the winning team. A match is never a draw: the game server breaks every
 * tie (see `rank` in @bagarre/shared), so each match has one winner or one
 * winning team, and every player their own place. The places (`place`, 1 =
 * first) and, with teams, each player's `team` are kept on the match's row.
 * Older servers sent shared places (and 1 / 2 by team): those are still
 * accepted and kept as sent, so `place` is only checked for its range.
 */
export const record = mutation({
  args: {
    secret: v.string(),
    matchId: v.string(),
    mode: v.optional(modeValidator),
    players: v.array(
      v.object({
        clerkId: v.string(),
        kills: count,
        deaths: count,
        won: v.boolean(),
        place: v.optional(v.number()),
        /** Team deathmatch: 0 red, 1 blue. */
        team: v.optional(v.number()),
      }),
    ),
  },
  returns: v.object({
    status: v.union(v.literal("recorded"), v.literal("duplicate")),
    updated: v.number(),
  }),
  handler: async (ctx, { secret, matchId, mode, players }) => {
    const expected = process.env.GAME_SERVER_SECRET;
    // An unset secret rejects everything rather than accepting an empty one.
    if (!expected || !constantTimeEqual(secret, expected)) {
      throw new ConvexError("Unauthorized");
    }
    if (matchId.length === 0 || matchId.length > 128) throw new ConvexError("Bad matchId");
    const most = MAX_PLAYERS[mode ?? "duel"];
    if (players.length > most) throw new ConvexError(`A ${mode ?? "duel"} has at most ${most} players`);
    for (const p of players) {
      for (const n of [p.kills, p.deaths]) {
        if (!Number.isInteger(n) || n < 0 || n > 1000) throw new ConvexError("Bad counter");
      }
      if (p.place !== undefined && (!Number.isInteger(p.place) || p.place < 1 || p.place > MAX_MATCH_PLAYERS))
        throw new ConvexError("Bad place");
      if (p.team !== undefined && p.team !== 0 && p.team !== 1) throw new ConvexError("Bad team");
    }

    const seen = await ctx.db
      .query("recordedMatches")
      .withIndex("by_matchId", (q) => q.eq("matchId", matchId))
      .unique();
    if (seen) return { status: "duplicate" as const, updated: 0 };
    await ctx.db.insert("recordedMatches", {
      matchId,
      recordedAt: Date.now(),
      mode: mode ?? "duel",
      placements: players.map((p) => ({
        clerkId: p.clerkId,
        place: p.place ?? (p.won ? 1 : 2),
        kills: p.kills,
        deaths: p.deaths,
        ...(p.team !== undefined ? { team: p.team } : {}),
      })),
    });

    let updated = 0;
    for (const p of players) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", p.clerkId))
        .unique();
      // Signed in but never picked a username: nothing to credit.
      if (!user) continue;
      const s = user.stats;
      await ctx.db.patch(user._id, {
        stats: {
          kills: s.kills + p.kills,
          deaths: s.deaths + p.deaths,
          wins: s.wins + (p.won ? 1 : 0),
          losses: s.losses + (p.won ? 0 : 1),
          matches: s.matches + 1,
        },
      });
      updated++;
    }
    return { status: "recorded" as const, updated };
  },
});

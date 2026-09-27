import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";

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

/**
 * Called by the game server, once per finished match, with the account
 * players of that match (guests are never sent). Public so the server can
 * call it over HTTP, but it only accepts calls carrying GAME_SERVER_SECRET.
 * Idempotent per `matchId`: a retry after a lost response changes nothing.
 */
export const record = mutation({
  args: {
    secret: v.string(),
    matchId: v.string(),
    players: v.array(
      v.object({
        clerkId: v.string(),
        kills: count,
        deaths: count,
        won: v.boolean(),
      }),
    ),
  },
  returns: v.object({
    status: v.union(v.literal("recorded"), v.literal("duplicate")),
    updated: v.number(),
  }),
  handler: async (ctx, { secret, matchId, players }) => {
    const expected = process.env.GAME_SERVER_SECRET;
    // An unset secret rejects everything rather than accepting an empty one.
    if (!expected || !constantTimeEqual(secret, expected)) {
      throw new ConvexError("Unauthorized");
    }
    if (matchId.length === 0 || matchId.length > 128) throw new ConvexError("Bad matchId");
    if (players.length > 2) throw new ConvexError("A duel has at most two players");
    for (const p of players) {
      for (const n of [p.kills, p.deaths]) {
        if (!Number.isInteger(n) || n < 0 || n > 1000) throw new ConvexError("Bad counter");
      }
    }

    const seen = await ctx.db
      .query("recordedMatches")
      .withIndex("by_matchId", (q) => q.eq("matchId", matchId))
      .unique();
    if (seen) return { status: "duplicate" as const, updated: 0 };
    await ctx.db.insert("recordedMatches", { matchId, recordedAt: Date.now() });

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

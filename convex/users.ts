import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { statsValidator } from "./schema";
import { usernameError, usernameKey } from "./username";

const EMPTY_STATS = { kills: 0, deaths: 0, wins: 0, losses: 0, matches: 0 };

const profileValidator = v.object({
  username: v.string(),
  createdAt: v.number(),
  stats: statsValidator,
});

async function userByClerkId(ctx: QueryCtx, clerkId: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
    .unique();
}

/**
 * The signed-in player's profile, or null when signed out or when no username
 * has been claimed yet. The game server also calls this with the player's own
 * token to learn their username at join time.
 */
export const me = query({
  args: {},
  returns: v.union(profileValidator, v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await userByClerkId(ctx, identity.subject);
    if (!user) return null;
    return { username: user.username, createdAt: user.createdAt, stats: user.stats };
  },
});

/**
 * Sets the signed-in player's username. Creates their row on the first call,
 * renames on later calls. Expected failures (invalid, taken) come back as a
 * result so the form can show them inline; only "not signed in" throws.
 */
export const claimUsername = mutation({
  args: { username: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), username: v.string() }),
    v.object({
      ok: v.literal(false),
      reason: v.union(v.literal("invalid"), v.literal("taken")),
      message: v.string(),
    }),
  ),
  handler: async (ctx, { username }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");

    const name = username.trim();
    const invalid = usernameError(name);
    if (invalid) return { ok: false as const, reason: "invalid" as const, message: invalid };

    const key = usernameKey(name);
    const holder = await ctx.db
      .query("users")
      .withIndex("by_usernameKey", (q) => q.eq("usernameKey", key))
      .unique();
    if (holder && holder.clerkId !== identity.subject) {
      return { ok: false as const, reason: "taken" as const, message: "That name is taken." };
    }

    const user = await userByClerkId(ctx, identity.subject);
    if (user) {
      await ctx.db.patch(user._id, { username: name, usernameKey: key });
    } else {
      await ctx.db.insert("users", {
        clerkId: identity.subject,
        username: name,
        usernameKey: key,
        createdAt: Date.now(),
        stats: EMPTY_STATS,
      });
    }
    return { ok: true as const, username: name };
  },
});

/** Anyone's public profile by username (case-insensitive), or null. */
export const publicProfile = query({
  args: { username: v.string() },
  returns: v.union(profileValidator, v.null()),
  handler: async (ctx, { username }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_usernameKey", (q) => q.eq("usernameKey", usernameKey(username.trim())))
      .unique();
    if (!user) return null;
    return { username: user.username, createdAt: user.createdAt, stats: user.stats };
  },
});

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const statsValidator = v.object({
  kills: v.number(),
  deaths: v.number(),
  wins: v.number(),
  losses: v.number(),
  matches: v.number(),
});

/** A match's mode. "tdm" (team deathmatch) came after "ffa"; older rows have no mode at all. */
export const modeValidator = v.union(v.literal("duel"), v.literal("ffa"), v.literal("tdm"));

export default defineSchema({
  users: defineTable({
    /** Clerk user id (the JWT `sub`). */
    clerkId: v.string(),
    /** Display name, as the player typed it. */
    username: v.string(),
    /** Lowercased username, for case-insensitive uniqueness. */
    usernameKey: v.string(),
    createdAt: v.number(),
    stats: statsValidator,
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_usernameKey", ["usernameKey"]),

  /**
   * One row per match already recorded, so a retried `matches.record` is a
   * no-op. Also keeps the mode and each account player's final place (older
   * rows, from before FFA, have neither), and in a team deathmatch their team
   * (0 red, 1 blue; absent in the other modes and on older rows).
   */
  recordedMatches: defineTable({
    matchId: v.string(),
    recordedAt: v.number(),
    mode: v.optional(modeValidator),
    placements: v.optional(
      v.array(
        v.object({ clerkId: v.string(), place: v.number(), kills: v.number(), deaths: v.number(), team: v.optional(v.number()) }),
      ),
    ),
  }).index("by_matchId", ["matchId"]),
});

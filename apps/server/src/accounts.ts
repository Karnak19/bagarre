// Player identity (Clerk) and match stats (Convex), from the game server's side.
//
// The server never trusts a name sent by the client. At join time it gets the
// Clerk token from the Colyseus auth header and:
//   - no token            -> a guest with a generated name;
//   - a valid token       -> an account: clerkId from the token's `sub`, the
//                            username read from Convex (`users.me`, called with
//                            that same token);
//   - an invalid token    -> the join is refused (the client retries as guest).
//
// Token verification is networkless: `verifyToken` from @clerk/backend checks
// the RS256 signature against CLERK_JWT_KEY (the instance's PEM public key),
// plus exp/nbf/iat, `aud: "convex"` and, when set, `iss` and `azp`.
// CLERK_SECRET_KEY is only a fallback (it makes verifyToken fetch the JWKS).

import { verifyToken } from "@clerk/backend";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@bagarre/backend/api";
import type { GameMode } from "@bagarre/shared";

export type Identity =
  | { kind: "guest"; name: string }
  | { kind: "account"; name: string; clerkId: string; username: string | null };

export interface MatchResult {
  clerkId: string;
  kills: number;
  deaths: number;
  /** First place (a shared first counts). */
  won: boolean;
  /** Final place, 1 = first (see `placements` in @bagarre/shared). With teams: 1 for the winning team, 2 for the other, 1 for both on a draw. */
  place: number;
  /** Team deathmatch: the player's team (TEAM_RED or TEAM_BLUE). Absent in the other modes. */
  team?: number;
}

export interface AccountsConfig {
  /** PEM public key for networkless verification. */
  jwtKey?: string;
  /** Fallback when there is no jwtKey: verifyToken fetches the JWKS with it. */
  secretKey?: string;
  /** Expected `iss` claim (the Clerk Frontend API URL). Unchecked when unset. */
  issuer?: string;
  /** Allowed `azp` origins. Unchecked when empty. */
  authorizedParties?: string[];
  /** Username of an account, or null (no username yet, or Convex unreachable). */
  lookupUsername: (clerkId: string, token: string) => Promise<string | null>;
  /** Credits a finished match. Must be idempotent per matchId. */
  recordMatch: (matchId: string, players: MatchResult[], mode: GameMode) => Promise<void>;
}

/** Thrown from onAuth; its message reaches the client. */
export class AuthRejected extends Error {}

const env = (name: string) => {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
};

/** PEM keys often come from .env files with literal "\n" sequences. */
const pem = (v: string | undefined) => v?.replace(/\\n/g, "\n");

function convexFromEnv(): Pick<AccountsConfig, "lookupUsername" | "recordMatch"> {
  const url = env("CONVEX_URL");
  const secret = env("GAME_SERVER_SECRET");
  return {
    async lookupUsername(_clerkId, token) {
      if (!url) return null;
      try {
        const client = new ConvexHttpClient(url, { auth: token });
        const me = await client.query(api.users.me, {});
        return me?.username ?? null;
      } catch (err) {
        console.warn("[accounts] username lookup failed:", err instanceof Error ? err.message : err);
        return null;
      }
    },
    async recordMatch(matchId, players, mode) {
      if (!url || !secret) {
        console.warn("[accounts] CONVEX_URL or GAME_SERVER_SECRET unset, match not recorded");
        return;
      }
      const client = new ConvexHttpClient(url);
      await client.mutation(api.matches.record, { secret, matchId, mode, players });
    },
  };
}

/** The production configuration, entirely from the environment. */
export function accountsFromEnv(): AccountsConfig {
  return {
    jwtKey: pem(env("CLERK_JWT_KEY")),
    secretKey: env("CLERK_SECRET_KEY"),
    issuer: env("CLERK_JWT_ISSUER_DOMAIN"),
    authorizedParties: env("CLERK_AUTHORIZED_PARTIES")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    ...convexFromEnv(),
  };
}

let config: AccountsConfig = accountsFromEnv();

/**
 * Replaces the configuration. Only for tests (the smoke test signs its own
 * tokens with a throwaway key): refused when NODE_ENV is "production", and the
 * real entry point (index.ts) never calls it.
 */
export function configureAccountsForTests(overrides: Partial<AccountsConfig>) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Test account configuration is not allowed in production");
  }
  config = { ...accountsFromEnv(), ...overrides };
}

export function guestName(taken: Set<string> = new Set()): string {
  for (;;) {
    const name = `Guest-${String(1000 + Math.floor(Math.random() * 9000))}`;
    if (!taken.has(name)) return name;
  }
}

/** Verifies a Clerk token and resolves the player's identity. Throws AuthRejected. */
export async function resolveIdentity(token: string | undefined): Promise<Identity> {
  if (!token) return { kind: "guest", name: guestName() };

  if (!config.jwtKey && !config.secretKey) {
    throw new AuthRejected("Accounts are not configured on this server");
  }
  let clerkId: string;
  try {
    // Throws on a bad signature, wrong audience/azp, or an expired token.
    const payload: { iss?: unknown; sub?: unknown } = await verifyToken(token, {
      jwtKey: config.jwtKey,
      secretKey: config.jwtKey ? undefined : config.secretKey,
      audience: "convex",
      authorizedParties: config.authorizedParties?.length ? config.authorizedParties : undefined,
    });
    if (config.issuer && payload.iss !== config.issuer) throw new Error(`unexpected issuer ${payload.iss}`);
    if (typeof payload.sub !== "string" || !payload.sub) throw new Error("no subject");
    clerkId = payload.sub;
  } catch (err) {
    console.warn("[accounts] token rejected:", err instanceof Error ? err.message : err);
    throw new AuthRejected("Invalid or expired session token");
  }

  const username = await config.lookupUsername(clerkId, token);
  return { kind: "account", clerkId, username, name: username ?? guestName() };
}

/**
 * Records a finished match for its account players, retrying a few times.
 * Safe to retry because matches.record is idempotent per matchId.
 */
export async function recordMatch(matchId: string, players: MatchResult[], mode: GameMode): Promise<void> {
  if (players.length === 0) return;
  for (let attempt = 1; ; attempt++) {
    try {
      await config.recordMatch(matchId, players, mode);
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

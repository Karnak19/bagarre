// Accounts, shared by the game server and the client: the username rules, the
// HTTP routes the account screens call, and what they answer.
//
// Signing up, in and out goes through @colyseus/auth under AUTH_PREFIX
// (`client.auth.*` in the SDK); the routes below are the game's own.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
const USERNAME_RE = /^[A-Za-z0-9_]+$/;

/** Returns an error message, or null when the name is acceptable. */
export function usernameError(name: string): string | null {
  if (name.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!USERNAME_RE.test(name)) return "Only letters, digits and _.";
  // "Guest-1234" can't be typed (no dash), but keep the prefix off-limits anyway
  // so an account never looks like a guest.
  if (/^guest/i.test(name)) return "Names starting with \"guest\" are reserved.";
  return null;
}

export const usernameKey = (name: string) => name.toLowerCase();

/** Shortest password @colyseus/auth accepts. */
export const PASSWORD_MIN = 6;

/** Where @colyseus/auth's routes live on the game server (its own default). */
export const AUTH_PREFIX = "/auth";

/** GET: which sign-in providers this server offers (`AuthProviders`). */
export const AUTH_PROVIDERS_ROUTE = "/auth/providers";
/** POST `{ email }`: sends the reset link (or logs it in dev). Always answers `true`. */
export const FORGOT_PASSWORD_ROUTE = "/auth/forgot-password";
/** POST `{ token, password }`: sets a new password from the emailed link's token (`ResetPasswordResult`). */
export const RESET_PASSWORD_ROUTE = "/auth/reset-password";
/** GET with the token: the signed-in player's account (`{ account: Account }`). */
export const ACCOUNT_ROUTE = "/account";
/** POST `{ username }` with the token: claims or changes the username (`ClaimResult`). */
export const USERNAME_ROUTE = "/account/username";
/** GET: the top accounts by wins (`{ entries: LeaderboardEntry[] }`). */
export const LEADERBOARD_ROUTE = "/leaderboard";

/** The client's page the reset email links to, with `?token=`. */
export const RESET_PASSWORD_PAGE = "/reset-password";

/** How many rows the leaderboard shows. */
export const LEADERBOARD_SIZE = 10;

export interface Stats {
  kills: number;
  deaths: number;
  wins: number;
  losses: number;
  matches: number;
}

/** The signed-in player, as GET /account sees them. */
export interface Account {
  id: string;
  email: string | null;
  /** Null until they pick one: a new account, email or Discord. */
  username: string | null;
  createdAt: number;
  stats: Stats;
}

export interface AuthProviders {
  discord: boolean;
}

export type ClaimResult =
  | { ok: true; username: string }
  | { ok: false; reason: "invalid" | "taken"; message: string };

export type ResetPasswordResult = { ok: true } | { ok: false; message: string };

export interface LeaderboardEntry {
  rank: number;
  username: string;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  matches: number;
}

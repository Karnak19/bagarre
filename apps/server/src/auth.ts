// Accounts over HTTP: @colyseus/auth's routes (sign up and in with email and
// password, Discord), plus the game's own (password reset, username,
// leaderboard). All of them are on the game server's router, so in
// production they live under /colyseus/auth/* and /colyseus/account/* (the
// client's Caddy strips /colyseus and proxies the rest here).
//
// What we change from @colyseus/auth's defaults:
//   - the session token carries only the account id and its token version,
//     and expires after 30 days (the default signs the whole user row, with
//     no expiry). A password reset bumps the version, which signs out every
//     session;
//   - forgot / reset password are our own routes: the emailed link opens the
//     client's own page (RESET_PASSWORD_PAGE), and nothing reads the
//     package's HTML templates from disk (they aren't in the compiled
//     binary). The email goes through Resend when RESEND_API_KEY and
//     MAIL_FROM are set, and to the server's console otherwise;
//   - no anonymous accounts (guests don't need a row) and no email
//     confirmation routes;
//   - Discord only when DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are set.

import { auth, Hash, JWT } from "@colyseus/auth";
import { createEndpoint, type Endpoint } from "@colyseus/core";
import {
  ACCOUNT_ROUTE,
  AUTH_PREFIX,
  AUTH_PROVIDERS_ROUTE,
  FORGOT_PASSWORD_ROUTE,
  LEADERBOARD_ROUTE,
  PASSWORD_MIN,
  PROFILE_ROUTE,
  RESET_PASSWORD_PAGE,
  RESET_PASSWORD_ROUTE,
  USERNAME_ROUTE,
  type AuthProviders,
  type ResetPasswordResult,
} from "@bagarre/shared";
import { eq, sql } from "drizzle-orm";
import { accountById, claimUsername, leaderboard, publicProfile, sessionUser, verifySession, type TokenPayload } from "./accounts.ts";
import { bootDatabase, users, type Database } from "./db.ts";

/** Only for dev and tests: production refuses to start without JWT_SECRET. */
const DEV_JWT_SECRET = "bagarre-dev-only-jwt-secret-do-not-use-in-production";
const SESSION_TTL = "30d";
const RESET_TTL = "30m";

export interface AuthConfig {
  /** Public origin of the client (the reset email links there). */
  publicUrl: string;
  /** Public URL of the game server: @colyseus/auth builds the Discord redirect from it. */
  backendUrl: string;
  discord: { clientId: string; clientSecret: string } | null;
  /** Resend, when both are set; else reset links go to the console. */
  mail: { apiKey: string; from: string } | null;
}

const env = (name: string, from: Record<string, string | undefined> = process.env) => {
  const v = from[name]?.trim();
  return v ? v : undefined;
};

/**
 * The public URLs, from the environment:
 *   - PUBLIC_URL: the client's public origin. Default http://localhost:5173.
 *   - PUBLIC_SERVER_URL: the game server's public URL. Default: PUBLIC_URL
 *     plus /colyseus (the path Caddy proxies to the server) when PUBLIC_URL is
 *     set, else http://localhost:<PORT>.
 * Production needs PUBLIC_URL: behind the proxy the server can't guess it.
 */
export function authConfigFromEnv(from: Record<string, string | undefined> = process.env): AuthConfig {
  const publicUrl = env("PUBLIC_URL", from)?.replace(/\/+$/, "");
  if (!publicUrl && from.NODE_ENV === "production") {
    throw new Error("PUBLIC_URL is required in production (the site's public origin, e.g. https://bagarre.example)");
  }
  const backendUrl =
    env("PUBLIC_SERVER_URL", from)?.replace(/\/+$/, "") ??
    (publicUrl ? `${publicUrl}/colyseus` : `http://localhost:${env("PORT", from) ?? "2567"}`);
  const clientId = env("DISCORD_CLIENT_ID", from);
  const clientSecret = env("DISCORD_CLIENT_SECRET", from);
  const apiKey = env("RESEND_API_KEY", from);
  const mailFrom = env("MAIL_FROM", from);
  return {
    publicUrl: publicUrl ?? "http://localhost:5173",
    backendUrl,
    discord: clientId && clientSecret ? { clientId, clientSecret } : null,
    mail: apiKey && mailFrom ? { apiKey, from: mailFrom } : null,
  };
}

/** The OAuth redirect URL to register in Discord's developer portal (Settings > OAuth2 > Redirects). */
export const discordRedirectUrl = (config: Pick<AuthConfig, "backendUrl">) =>
  `${config.backendUrl}${AUTH_PREFIX}/provider/discord/callback`;

/** The JWT secret: JWT_SECRET, or a fixed one outside production. */
export function jwtSecretFromEnv(from: Record<string, string | undefined> = process.env): string {
  const secret = env("JWT_SECRET", from);
  if (secret) return secret;
  if (from.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production (generate one with: openssl rand -base64 32)");
  }
  return DEV_JWT_SECRET;
}

/** Test hook: sees every reset link (the smoke test follows it). */
export const authHooks: { onResetLink?: (email: string, link: string) => void } = {};

let config: AuthConfig = { publicUrl: "", backendUrl: "", discord: null, mail: null };

/** Sets up @colyseus/auth's singletons. Called once by createServer, before listening. */
export function configureAuth(overrides: Partial<AuthConfig> = {}) {
  config = { ...authConfigFromEnv(), ...overrides };
  JWT.settings.secret = jwtSecretFromEnv();
  auth.backend_url = config.backendUrl;
  auth.oauth.defaults.origin = config.backendUrl;
  delete (auth.oauth.providers as Record<string, unknown>).discord;
  if (config.discord) {
    auth.oauth.addProvider("discord", {
      key: config.discord.clientId,
      secret: config.discord.clientSecret,
      scope: ["identify", "email"],
    });
  }
  return config;
}

/** The session token: the id and the token version, nothing else. */
async function sessionToken(user: unknown): Promise<string> {
  const u = user as { id?: unknown; tokenVersion?: unknown };
  if (typeof u?.id !== "string") throw new Error("no user id");
  const payload: TokenPayload = { id: u.id, tokenVersion: Number(u.tokenVersion ?? 0) };
  return JWT.sign(payload, { expiresIn: SESSION_TTL });
}

const bearer = (header: string | null | undefined) =>
  header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const bodyOf = (ctx: { body?: unknown }) =>
  (typeof ctx.body === "object" && ctx.body !== null ? ctx.body : {}) as Record<string, unknown>;

async function sendResetEmail(email: string, link: string) {
  authHooks.onResetLink?.(email, link);
  if (!config.mail) {
    console.log(`[auth] password reset link for ${email} (no RESEND_API_KEY / MAIL_FROM, not emailed):\n  ${link}`);
    return;
  }
  const text = `Someone asked to reset the password of your bagarre account.\n\nSet a new one here (the link works for 30 minutes):\n${link}\n\nIf it wasn't you, ignore this email.`;
  const html = `<p>Someone asked to reset the password of your bagarre account.</p>
<p><a href="${link}">Set a new password</a> (the link works for 30 minutes).</p>
<p>If it wasn't you, ignore this email.</p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.mail.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.mail.from, to: [email], subject: "Reset your bagarre password", text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${await res.text()}`);
}

interface ResetClaims {
  purpose: "reset";
  email: string;
  tokenVersion: number;
}

function gameEndpoints(db: Database): Record<string, Endpoint> {
  const findByEmail = async (email: string) => {
    const [row] = await db.drizzle
      .select({ id: users.id, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row;
  };

  // Answers `true` whether or not the address has an account, so it can't be
  // used to find out which ones do. The link is only good for 30 minutes and
  // once: using it bumps the token version it carries.
  const forgotPassword = createEndpoint(FORGOT_PASSWORD_ROUTE, { method: "POST" }, async (ctx) => {
    const email = normalizeEmail(String(bodyOf(ctx).email ?? ""));
    try {
      const user = email ? await findByEmail(email) : undefined;
      if (user) {
        const claims: ResetClaims = { purpose: "reset", email, tokenVersion: user.tokenVersion };
        const token = await JWT.sign(claims, { expiresIn: RESET_TTL });
        await sendResetEmail(email, `${config.publicUrl}${RESET_PASSWORD_PAGE}?token=${encodeURIComponent(token)}`);
      }
    } catch (err) {
      console.error("[auth] forgot password:", err instanceof Error ? err.message : err);
    }
    return true;
  });

  const resetPassword = createEndpoint(RESET_PASSWORD_ROUTE, { method: "POST" }, async (ctx): Promise<ResetPasswordResult> => {
    const body = bodyOf(ctx);
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < PASSWORD_MIN) return { ok: false, message: `At least ${PASSWORD_MIN} characters.` };
    const expired: ResetPasswordResult = { ok: false, message: "This link has expired or was already used. Ask for a new one." };
    let claims: Partial<ResetClaims>;
    try {
      claims = await JWT.verify<Partial<ResetClaims>>(String(body.token ?? ""));
    } catch {
      return expired;
    }
    if (claims.purpose !== "reset" || typeof claims.email !== "string") return expired;
    const user = await findByEmail(claims.email);
    if (!user || user.tokenVersion !== claims.tokenVersion) return expired;
    await db.drizzle
      .update(users)
      .set({ passwordHash: await Hash.make(password), tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    return { ok: true };
  });

  const providers = createEndpoint(AUTH_PROVIDERS_ROUTE, { method: "GET" }, async (): Promise<AuthProviders> => ({
    discord: !!config.discord,
  }));

  const account = createEndpoint(ACCOUNT_ROUTE, { method: "GET" }, async (ctx) => {
    const userId = await verifySession(bearer(ctx.getHeader("authorization")));
    const found = userId ? await accountById(userId) : null;
    if (!found) throw ctx.error(401, { message: "Not signed in" });
    return { account: found };
  });

  const username = createEndpoint(USERNAME_ROUTE, { method: "POST" }, async (ctx) => {
    const userId = await verifySession(bearer(ctx.getHeader("authorization")));
    if (!userId) throw ctx.error(401, { message: "Not signed in" });
    return claimUsername(userId, String(bodyOf(ctx).username ?? ""));
  });

  const top = createEndpoint(LEADERBOARD_ROUTE, { method: "GET" }, async () => ({ entries: await leaderboard() }));

  const profile = createEndpoint(PROFILE_ROUTE, { method: "GET" }, async (ctx) => ({
    profile: await publicProfile(String(ctx.params.username ?? "")),
  }));

  return {
    "auth-forgot-password": forgotPassword,
    "auth-reset-password-post": resetPassword,
    "auth-providers": providers,
    "account-get": account,
    "account-username": username,
    leaderboard: top,
    "profile-get": profile,
  };
}

/**
 * The callback page with its `postMessage(payload, '*')` aimed at `origin`
 * instead. Null when the page has a postMessage this doesn't recognise.
 */
export function restrictPostMessage(page: string, origin: string): string | null {
  if (!page.includes("postMessage")) return page;
  const out = page.replace(/, '\*'\);<\/script>/, `, ${JSON.stringify(origin)});</script>`);
  return out === page ? null : out;
}

/**
 * @colyseus/auth ends a Discord sign-in with a page that hands the token to
 * the window that opened the popup, `postMessage(..., "*")`: any site that
 * opened it would get the token. Same route, same page, but the message may
 * only go to our own client's origin.
 */
function oauthCallbackForOurOrigin(original: Endpoint): Endpoint {
  return createEndpoint(original.path!, { method: "GET" }, async (ctx) => {
    const res = (await (original as unknown as (c: unknown) => Promise<Response>)({
      params: ctx.params,
      query: ctx.query,
      headers: ctx.request?.headers ?? ctx.headers,
      asResponse: true,
    })) as Response;
    const page = await res.text();
    const body = restrictPostMessage(page, new URL(config.publicUrl).origin);
    // Never let the page through unchanged (a new version of the package).
    if (body === null) return new Response("Sign-in failed.", { status: 500 });
    // A fresh Response and headers: handing back the package's own (a
    // redirect with an empty body) left the request hanging.
    return new Response(body || null, { status: res.status, headers: new Headers(res.headers) });
  });
}

/**
 * The `database` option of defineServer: boots the database (and our
 * migrations) before the server listens, then adds the auth and account
 * routes to its router. Our own object rather than the GameDatabase itself,
 * whose defaults would mount every @colyseus/auth route as is.
 */
export function databaseService(db: Database) {
  return {
    boot: () => bootDatabase(db),
    shutdown: () => db.shutdown(),
    applyRouterDefaults<R extends { extend(endpoints: Record<string, Endpoint>): R }>(router: R): R {
      const store = db.auth.settings;
      const map = auth.endpoints({
        settings: {
          ...store,
          // Emails are compared lowercased. And the package answers sign up
          // and sign in with the user row minus `password`: leave the stored
          // hash out of it too.
          onFindUserByEmail: async (email) => {
            const found = (await store.onFindUserByEmail!(normalizeEmail(email))) as Record<string, unknown> | null;
            if (!found) return found;
            const { passwordHash: _hash, usernameKey: _key, ...rest } = found;
            return rest as typeof rest & { password: string };
          },
          onRegisterWithEmailAndPassword: (email, password, options) =>
            store.onRegisterWithEmailAndPassword!(normalizeEmail(email), password, options),
          // Discord: the same lowercased email (an existing account with it
          // is signed in), and no password hash in what reaches the page.
          onOAuthProviderCallback: async (data, provider) => {
            const profile = data.profile as { email?: unknown } | undefined;
            const email = typeof profile?.email === "string" ? normalizeEmail(profile.email) : profile?.email;
            const found = (await store.onOAuthProviderCallback!({ ...data, profile: profile && { ...profile, email } }, provider)) as
              | Record<string, unknown>
              | null;
            if (!found) return found;
            const { passwordHash: _hash, usernameKey: _key, ...rest } = found;
            return rest;
          },
          onGenerateToken: sessionToken,
          // GET /auth/userdata: the account, fresh from the database.
          onParseToken: async (payload) => {
            const userId = await sessionUser(payload);
            const found = userId ? await accountById(userId) : null;
            if (!found) throw new Error("invalid session");
            return found;
          },
        },
        oauth: !!config.discord,
      });
      // Replaced or unused (see the top of this file).
      for (const key of ["auth-anonymous", "auth-reset-password-get", "auth-confirm-email"]) delete map[key];
      if (map["auth-oauth-callback"]) map["auth-oauth-callback"] = oauthCallbackForOurOrigin(map["auth-oauth-callback"]);
      return router.extend({ ...map, ...gameEndpoints(db) });
    },
  };
}

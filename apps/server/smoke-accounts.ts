// Account checks for the smoke test (see smoke.ts).
//
// The smoke server runs with an in-memory database (PGlite), so everything
// here goes through the real code: @colyseus/auth's sign up and sign in, our
// account, username, skin, password reset and leaderboard routes over HTTP, the
// token check at join time, and the match records written at the end of a
// match. Plain fetch rather than the SDK's `client.auth`: in Node the SDK
// keeps the token in one process-wide store, which every other scenario's
// `new Client()` would pick up.

import { generateId, matchMaker } from "@colyseus/core";
import { JWT } from "@colyseus/auth";
import { Client, type Room } from "@colyseus/sdk";
import {
  ACCOUNT_ROUTE,
  AUTH_PROVIDERS_ROUTE,
  FFA_ROOM_NAME,
  FORGOT_PASSWORD_ROUTE,
  isSkinId,
  LEADERBOARD_ROUTE,
  RESET_PASSWORD_PAGE,
  RESET_PASSWORD_ROUTE,
  MSG_TAKE_SEAT,
  ROOM_NAME,
  SKIN_ROUTE,
  SKINS,
  TEAM_ROOM_NAME,
  TICK_MS,
  USERNAME_ROUTE,
  usernameKey,
  type Account,
  type ClaimResult,
  type LeaderboardEntry,
  type PlayerView,
  type Stats,
  type ResetPasswordResult,
  type RoomStateView,
  type SkinResult,
} from "@bagarre/shared";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { accountHooks, db, matchRow, writeMatch, type MatchResult } from "./src/accounts.ts";
import { authConfigFromEnv, authHooks, discordRedirectUrl, jwtSecretFromEnv, restrictPostMessage } from "./src/auth.ts";
import { users } from "./src/db.ts";

type Check = (cond: boolean, label: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await sleep(20);
  }
  return cond();
}
const state = (room: Room) => room.state as unknown as RoomStateView;
const me = (room: Room): PlayerView | undefined => state(room)?.players?.get(room.sessionId);

/** The public URL the smoke server builds reset links with (see smoke.ts). */
export const SMOKE_PUBLIC_URL = "http://localhost:5199";

export interface AccountsHarness {
  /** A new account, straight in the database, and a session token for it. */
  account(username: string | null): Promise<{ id: string; token: string }>;
  /** Every match GameRoom recorded, in order. */
  recorded: { matchId: string; players: MatchResult[] }[];
  matchRow: typeof matchRow;
  /** An account's stats, straight from the database, by username (case-insensitive). */
  stats(username: string): Promise<Stats | null>;
}

/** Call once the server is created (it sets up the database). */
export function setupTestAccounts(): AccountsHarness {
  const recorded: AccountsHarness["recorded"] = [];
  accountHooks.onRecord = (matchId, players) => {
    recorded.push({ matchId, players });
  };
  return {
    recorded,
    matchRow,
    async stats(username) {
      const [row] = await db().drizzle.select().from(users).where(eq(users.usernameKey, usernameKey(username))).limit(1);
      return row ? { kills: row.kills, deaths: row.deaths, wins: row.wins, losses: row.losses, matches: row.matches } : null;
    },
    async account(username) {
      const id = generateId(21);
      await db()
        .drizzle.insert(users)
        .values({
          id,
          email: `${id.toLowerCase()}@smoke.test`,
          anonymous: false,
          username,
          usernameKey: username ? usernameKey(username) : null,
        });
      return { id, token: await JWT.sign({ id, tokenVersion: 0 }, { expiresIn: "1h" }) };
    },
  };
}

async function http<T>(url: string, path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${url}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON: keep the text.
  }
  return { status: res.status, data: data as T, location: res.headers.get("location") };
}

type AuthAnswer = { user?: Record<string, unknown>; token?: string; error?: string; message?: string };
const register = (url: string, email: string, password: string) =>
  http<AuthAnswer>(url, "/auth/register", { body: { email, password } });
const login = (url: string, email: string, password: string) =>
  http<AuthAnswer>(url, "/auth/login", { body: { email, password } });
const errorOf = (a: AuthAnswer) => a.error ?? a.message ?? "";

async function joinWith(url: string, token: string | undefined, roomId?: string, options?: Record<string, unknown>, name = ROOM_NAME) {
  const c = new Client(url);
  if (token !== undefined) c.auth.token = token;
  return roomId ? c.joinById(roomId, options) : c.create(name, options);
}

/** Joins with `token` and returns the name the server gave us and the `account` flag. */
async function joinedAs(url: string, token: string | undefined) {
  const room = await joinWith(url, token);
  await waitFor(() => !!me(room)?.name, 2000);
  const out = { name: me(room)?.name ?? "", account: me(room)?.account ?? false };
  await room.leave();
  return out;
}

const sameStats = (a: Stats | null | undefined, b: Stats) =>
  !!a && (Object.keys(b) as (keyof Stats)[]).every((k) => a[k] === b[k]);

/** Configuration read from the environment: production refuses to start without its secrets. */
function configChecks(check: Check) {
  const PROD_ORIGIN = "https://ghj9pktfasrpthjvvpg2gehp.big-server.basile.vernouillet.dev";
  const throws = (f: () => unknown) => {
    try {
      f();
      return false;
    } catch {
      return true;
    }
  };
  check(throws(() => jwtSecretFromEnv({ NODE_ENV: "production" })), "production refuses to start without JWT_SECRET");
  check(jwtSecretFromEnv({ NODE_ENV: "development" }).length > 20, "dev and tests fall back to a fixed JWT secret");
  check(throws(() => authConfigFromEnv({ NODE_ENV: "production" })), "production refuses to start without PUBLIC_URL");
  const prod = authConfigFromEnv({ NODE_ENV: "production", PUBLIC_URL: `${PROD_ORIGIN}/`, DISCORD_CLIENT_ID: "id" });
  check(
    prod.backendUrl === `${PROD_ORIGIN}/colyseus` && prod.publicUrl === PROD_ORIGIN && prod.discord === null && prod.mail === null,
    `behind the proxy the server's public URL is PUBLIC_URL + /colyseus; Discord needs both its keys, Resend both its settings (${prod.backendUrl})`,
  );
  const redirect = discordRedirectUrl(prod);
  check(
    redirect === `${PROD_ORIGIN}/colyseus/auth/provider/discord/callback`,
    `the Discord redirect URL in production is ${redirect}`,
  );
  const dev = authConfigFromEnv({ PORT: "2567" });
  check(
    dev.backendUrl === "http://localhost:2567" && dev.publicUrl === "http://localhost:5173",
    `in dev the server is its own public URL and reset links open the Vite client (${dev.backendUrl}, ${dev.publicUrl})`,
  );
}

/** Sign up, sign in, usernames, bad tokens, a full recorded match, password reset, leaderboard, Discord. */
export async function accountChecks(url: string, h: AccountsHarness, check: Check) {
  configChecks(check);

  // Sign up and sign in (@colyseus/auth, on the database).
  const email = `Hero.${Date.now()}@Smoke.test`;
  const signedUp = await register(url, email, "hunter22");
  check(
    signedUp.status === 200 && typeof signedUp.data.token === "string" && signedUp.data.user?.email === email.toLowerCase(),
    `sign up with email and password answers a session token, the email lowercased (${signedUp.status} ${String(signedUp.data.user?.email)})`,
  );
  check(
    !!signedUp.data.user && !("passwordHash" in signedUp.data.user) && !("password" in signedUp.data.user),
    "the sign up answer carries no password hash",
  );
  const tokenPayload = JWT.decode(signedUp.data.token ?? "") as Record<string, unknown> | null;
  check(
    !!tokenPayload && Object.keys(tokenPayload).sort().join(",") === "exp,iat,id,tokenVersion",
    `the session token carries only the id and token version, and expires (${Object.keys(tokenPayload ?? {}).join(", ")})`,
  );
  const again = await register(url, email.toUpperCase(), "whatever1");
  check(again.status === 401 && errorOf(again.data) === "email_already_in_use", `the same email can't sign up twice, whatever its case (${errorOf(again.data)})`);
  const short = await register(url, `short.${Date.now()}@smoke.test`, "abc");
  check(short.status >= 400 && short.status < 500, `a password under 6 characters is refused (${short.status})`);
  const wrong = await login(url, email, "not-it");
  check(wrong.status === 401 && errorOf(wrong.data) === "invalid_credentials", `a wrong password is refused (${errorOf(wrong.data)})`);
  const signedIn = await login(url, email, "hunter22");
  check(signedIn.status === 200 && typeof signedIn.data.token === "string", "sign in with the right password answers a token");
  const token = signedIn.data.token!;
  check((await http(url, "/auth/anonymous", { body: {} })).status === 404, "no anonymous accounts: guests don't need a row");

  // The account and its username.
  const acct = await http<{ account: Account }>(url, ACCOUNT_ROUTE, { token });
  check(acct.status === 200 && acct.data.account?.username === null, "a new account has no username yet");
  check((await http(url, ACCOUNT_ROUTE)).status === 401, "GET /account without a token is 401");
  check((await http(url, USERNAME_ROUTE, { body: { username: "Nobody" } })).status === 401, "claiming a username needs a session");
  const noName = await joinedAs(url, token);
  check(/^Guest-\d{4}$/.test(noName.name) && !noName.account, `an account without a username plays under a guest name (${noName.name})`);
  const claim = (tok: string, username: string) => http<ClaimResult>(url, USERNAME_ROUTE, { token: tok, body: { username } });
  const claimed = await claim(token, "SmokeHero");
  check(claimed.data.ok === true, "claiming a free username works");
  const victim = await h.account("Smoke_Victim");
  const other = await h.account(null);
  const taken = await claim(other.token, "smokehero");
  const tooShort = await claim(other.token, "ab");
  const bad = await claim(other.token, "no spaces!");
  check(
    !taken.data.ok && taken.data.reason === "taken" && !tooShort.data.ok && tooShort.data.reason === "invalid" && !bad.data.ok && bad.data.reason === "invalid",
    "a taken name (case-insensitive), a short one and bad characters are refused",
  );
  const rename = await claim(token, "SmokeHero");
  check(rename.data.ok === true, "claiming your own name again is fine");
  const userdata = await http<{ user: Account }>(url, "/auth/userdata", { token });
  check(userdata.data.user?.username === "SmokeHero", "GET /auth/userdata answers the account with its username");

  // Guests and bad tokens: always a guest, never a refused join.
  const guest = await joinedAs(url, undefined);
  check(/^Guest-\d{4}$/.test(guest.name) && !guest.account, `a join without a token is a guest with a generated name (${guest.name})`);
  const now = Math.floor(Date.now() / 1000);
  const forge = (secret: string, claims: Record<string, unknown>) =>
    new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(secret));
  const secret = jwtSecretFromEnv();
  const cases: [string, string][] = [
    ["garbage", "garbage.not-a.jwt"],
    ["expired", await forge(secret, { id: userdata.data.user?.id, tokenVersion: 0, iat: now - 600, exp: now - 120 })],
    ["signed with another secret", await forge("someone-else", { id: userdata.data.user?.id, tokenVersion: 0 })],
    ["for an account that doesn't exist", await forge(secret, { id: "no-such-user", tokenVersion: 0 })],
  ];
  for (const [label, bad] of cases) {
    const j = await joinedAs(url, bad).catch((e: unknown) => ({ name: `refused: ${e instanceof Error ? e.message : e}`, account: false }));
    check(/^Guest-\d{4}$/.test(j.name) && !j.account, `a token ${label} joins as a guest (${j.name})`);
  }

  // Two accounts play a whole match; stats land in the database.
  const hero = await joinWith(url, token);
  const victimRoom = await joinWith(url, victim.token, hero.roomId);
  const started = await waitFor(() => state(hero).phase === "playing" && !!me(hero) && !!me(victimRoom), 3000);
  check(started, "two account players start a match");
  check(me(hero)?.name === "SmokeHero" && me(hero)?.account === true, `a valid token joins under the account's username (${me(hero)?.name})`);
  const names: string[] = [];
  state(victimRoom).players.forEach((p) => names.push(p.name));
  check(names.sort().join(",") === "SmokeHero,Smoke_Victim", `both names are synced to the other client (${names.join(", ")})`);

  const recordedBefore = h.recorded.length;
  await playMatch(hero, victimRoom);
  const ended = await waitFor(() => state(hero).phase === "ended", 1000);
  check(ended && state(hero).winner === hero.sessionId, "the hero wins the match 5-0");
  await waitFor(() => h.recorded.length > recordedBefore, 3000);
  const rec = h.recorded.find((r) => r.players.some((p) => p.userId === victim.id));
  const heroId = userdata.data.user!.id;
  check(
    !!rec &&
      rec.players.length === 2 &&
      rec.players.some((p) => p.userId === heroId && p.won && p.kills === 5 && p.deaths === 0) &&
      rec.players.some((p) => p.userId === victim.id && !p.won && p.kills === 0 && p.deaths === 5),
    `match end records both players (${JSON.stringify(rec?.players)})`,
  );
  let heroStats: Stats | null = null;
  for (let i = 0; i < 50 && !heroStats?.matches; i++) {
    heroStats = await h.stats("smokehero");
    if (!heroStats?.matches) await sleep(50);
  }
  const victimStats = await h.stats("Smoke_Victim");
  check(
    sameStats(heroStats, { kills: 5, deaths: 0, wins: 1, losses: 0, matches: 1 }) &&
      sameStats(victimStats, { kills: 0, deaths: 5, wins: 0, losses: 1, matches: 1 }),
    `stats credited (hero ${JSON.stringify(heroStats)}, victim ${JSON.stringify(victimStats)})`,
  );
  const row = rec ? await h.matchRow(rec.matchId) : null;
  check(row?.mode === "duel" && row.placements.map((p) => p.place).sort().join(",") === "1,2", `the match row keeps the mode and the places (${JSON.stringify(row?.placements)})`);
  if (rec) {
    const retry = await writeMatch(rec.matchId, rec.players, "duel");
    const after = await h.stats("SmokeHero");
    check(
      retry.status === "duplicate" && after?.matches === 1 && after.kills === 5,
      `recording a match is idempotent per match id (retry: ${retry.status}, matches ${after?.matches})`,
    );
  }
  const board = await http<{ entries: LeaderboardEntry[] }>(url, LEADERBOARD_ROUTE);
  const heroRow = board.data.entries?.find((e) => e.username === "SmokeHero");
  const victimRow = board.data.entries?.find((e) => e.username === "Smoke_Victim");
  check(
    !!heroRow && !!victimRow && heroRow.rank < victimRow.rank && heroRow.wins === 1 && !board.data.entries.some((e) => e.matches === 0),
    `the leaderboard lists the accounts that played, most wins first (hero #${heroRow?.rank}, victim #${victimRow?.rank})`,
  );
  await victimRoom.leave();
  await hero.leave();

  // Forgot / reset password.
  const links: string[] = [];
  authHooks.onResetLink = (to, link) => {
    if (to === email.toLowerCase()) links.push(link);
  };
  const unknown = await http(url, FORGOT_PASSWORD_ROUTE, { body: { email: "nobody@smoke.test" } });
  const known = await http(url, FORGOT_PASSWORD_ROUTE, { body: { email: email.toUpperCase() } });
  check(unknown.data === true && known.data === true, "forgot password answers the same for an unknown email and a known one");
  await waitFor(() => links.length > 0, 2000);
  const link = links[0] ?? "";
  check(links.length === 1 && link.startsWith(`${SMOKE_PUBLIC_URL}${RESET_PASSWORD_PAGE}?token=`), `the reset link opens the client's reset page (${link.split("?")[0]})`);
  const resetToken = new URL(link || "http://x").searchParams.get("token") ?? "";
  const reset = (password: string, t = resetToken) => http<ResetPasswordResult>(url, RESET_PASSWORD_ROUTE, { body: { token: t, password } });
  const tooShortReset = await reset("abc");
  check(!tooShortReset.data.ok, "a new password under 6 characters is refused");
  const sessionAsReset = await reset("newpass1", token);
  check(!sessionAsReset.data.ok, "a session token is not a reset token");
  const done = await reset("newpass1");
  check(done.data.ok === true, "the reset link sets a new password");
  const reused = await reset("another1");
  check(!reused.data.ok, "a reset link works only once");
  const oldPassword = await login(url, email, "hunter22");
  const newPassword = await login(url, email, "newpass1");
  check(oldPassword.status === 401 && newPassword.status === 200, "after a reset the old password fails and the new one works");
  check((await http(url, ACCOUNT_ROUTE, { token })).status === 401, "a reset signs out the sessions from before it");
  const revoked = await joinedAs(url, token);
  check(!revoked.account && /^Guest-\d{4}$/.test(revoked.name), `a revoked session token joins as a guest (${revoked.name})`);
  authHooks.onResetLink = undefined;

  // Discord: the smoke server has it on with fake keys. The start route
  // redirects to Discord with the redirect URL @colyseus/auth built.
  const providers = await http<{ discord: boolean }>(url, AUTH_PROVIDERS_ROUTE);
  check(providers.data.discord === true, "the providers route says Discord is on when its keys are set");
  const start = await fetch(`${url}/auth/provider/discord`, { redirect: "manual" });
  const location = start.headers.get("location") ?? "";
  const redirectUri = location ? new URL(location).searchParams.get("redirect_uri") : null;
  check(
    start.status === 302 && location.startsWith("https://discord.com/") && redirectUri === discordRedirectUrl({ backendUrl: url }),
    `the Discord sign-in redirects to Discord with redirect_uri ${redirectUri}`,
  );
  const callback = await fetch(`${url}/auth/provider/discord/callback?error=access_denied`, {
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  }).catch((e: unknown) => ({ status: `failed: ${e instanceof Error ? e.message : e}` }));
  check(callback.status === 302, `the Discord callback route answers (without a sign-in under way, a redirect: ${callback.status})`);
  // The page @colyseus/auth's callback ends with (oauth-endpoints.ts, postMessageHtml).
  const upstream = `<!DOCTYPE html><html><head><script type="text/javascript">window.opener.postMessage(${JSON.stringify({ user: { id: "x" }, token: "t" })}, '*');</script></head><body></body></html>`;
  const restricted = restrictPostMessage(upstream, "https://bagarre.example");
  check(
    !!restricted && restricted.includes(`, "https://bagarre.example");</script>`) && !restricted.includes("'*'"),
    "the Discord callback page only hands the token to our own origin, never to '*'",
  );
  check(restrictPostMessage("<script>window.opener.postMessage({}, target)</script>", "https://bagarre.example") === null, "a callback page it doesn't recognise is refused");
}

/**
 * Hero stands at (0, -12) and shoots at the victim. The victim always
 * respawns at (12, 12) (the spawn farthest from the hero) and walks down the
 * clear x = 12 column to (12, -12), into the firing lane.
 */
async function playMatch(hero: Room, victim: Room) {
  // The smoke server pins every room to Yard (see smoke.ts).
  const { stepPlayer, readSim, mapById, PLAYER_SPEED, TICK_DT, MSG_INPUT } = await import("@bagarre/shared");
  const yard = mapById("yard");
  const drive = (room: Room, controls: () => { tx: number; tz: number; aim: number; fire: boolean }) => {
    let seq = 0;
    let sim = readSim(me(room)!);
    let wasAlive = true;
    const timer = setInterval(() => {
      const p = me(room);
      if (!p) return;
      // After a respawn, restart the local sim from the server's position.
      if (p.alive && !wasAlive) sim = readSim(p);
      wasAlive = p.alive;
      const c = controls();
      const dx = c.tx - sim.x;
      const dz = c.tz - sim.z;
      const dist = Math.hypot(dx, dz);
      const f = dist > 1e-9 ? Math.min(1, dist / (PLAYER_SPEED * TICK_DT)) / dist : 0;
      const input = { seq: ++seq, mx: dx * f, mz: dz * f, aim: c.aim, fire: c.fire, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0 };
      sim = stepPlayer(yard, sim, input, p.weapon, p.alive && state(room).phase !== "ended").sim;
      room.send(MSG_INPUT, input);
    }, TICK_MS);
    return () => clearInterval(timer);
  };
  const stopVictim = drive(victim, () => ({ tx: 12, tz: -12, aim: Math.PI, fire: false }));
  const stopHero = drive(hero, () => {
    const h = me(hero);
    let target: PlayerView | undefined;
    state(hero).players.forEach((p, id) => {
      if (id !== hero.sessionId) target = p;
    });
    const aim = h && target ? Math.atan2(target.z - h.z, target.x - h.x) : 0;
    // Only shoot once the victim is in the lane, so cover never eats the shots.
    return { tx: 0, tz: -12, aim, fire: !!target?.alive && target.z < -11 };
  });
  try {
    await waitFor(() => state(hero).phase === "ended", 90_000);
  } finally {
    stopHero();
    stopVictim();
  }
}

/** A player's synced skin, as a client sees it ("" before the server set one). */
const skinIn = (room: Room, sessionId = room.sessionId) =>
  (state(room)?.players?.get(sessionId) as { skin?: string } | undefined)?.skin ?? "";

/** Every seat's skin in the room, as `room`'s client sees them. */
function skinsIn(room: Room): string[] {
  const out: string[] = [];
  state(room).players.forEach((p) => out.push((p as { skin?: string }).skin ?? ""));
  return out;
}

/**
 * Skins: the saved skin route, the skin picked at join (the account's, else a
 * random one nobody in the room wears), kept through a reconnect, and the
 * `skin` join option ignored. The "ignored" checks are deterministic: the
 * option asks for a skin the room already has, which a random pick never
 * gives while another is free, and a saved skin always wins.
 */
export async function skinChecks(url: string, h: AccountsHarness, check: Check) {
  const [a, b] = SKINS.map((s) => s.id);
  const setSkin = (token: string | undefined, skin: unknown) =>
    http<SkinResult>(url, SKIN_ROUTE, { token, body: { skin } });

  // The route.
  const hero = await h.account("Skin_Hero");
  const fresh = await http<{ account: Account }>(url, ACCOUNT_ROUTE, { token: hero.token });
  check(fresh.status === 200 && fresh.data.account?.skin === null, `a new account has no saved skin: GET /account answers skin null (${JSON.stringify(fresh.data.account?.skin)})`);
  check((await setSkin(undefined, a)).status === 401, "POST /account/skin without a session is 401");
  const bogus = await setSkin(hero.token, "not-a-skin");
  const notString = await setSkin(hero.token, 3);
  check(
    bogus.status === 200 && !bogus.data.ok && !notString.data.ok,
    `an unknown skin id is refused (${JSON.stringify(bogus.data)}), so is a number`,
  );
  const saved = await setSkin(hero.token, a);
  const read = await http<{ account: Account }>(url, ACCOUNT_ROUTE, { token: hero.token });
  check(
    saved.data.ok === true && saved.data.skin === a && read.data.account?.skin === a,
    `a SKINS id is saved, and GET /account answers it (${JSON.stringify(saved.data)}, ${read.data.account?.skin})`,
  );

  // Signed in: the saved skin, whatever the join option says.
  const g1 = await joinWith(url, undefined);
  await waitFor(() => isSkinId(skinIn(g1)), 2000);
  const heroRoom = await joinWith(url, hero.token, g1.roomId, { skin: b });
  await waitFor(() => !!skinIn(heroRoom) && !!skinIn(g1, heroRoom.sessionId), 2000);
  check(
    skinIn(heroRoom) === a && skinIn(g1, heroRoom.sessionId) === a,
    `a signed-in player wears their saved skin, seen by the other client too, and their skin join option (${b}) is ignored (${skinIn(heroRoom)})`,
  );
  await Promise.all([heroRoom.leave(), g1.leave()]);

  // Back to random.
  const cleared = await setSkin(hero.token, null);
  const readCleared = await http<{ account: Account }>(url, ACCOUNT_ROUTE, { token: hero.token });
  check(cleared.data.ok === true && cleared.data.skin === null && readCleared.data.account?.skin === null, "POST { skin: null } goes back to random");
  const randomRoom = await joinWith(url, hero.token);
  await waitFor(() => !!skinIn(randomRoom), 2000);
  check(isSkinId(skinIn(randomRoom)), `...and the account then gets a random skin at join (${skinIn(randomRoom)})`);
  await randomRoom.leave();

  // An account without a username still has its saved skin.
  const nameless = await h.account(null);
  await setSkin(nameless.token, b);
  const namelessRoom = await joinWith(url, nameless.token);
  await waitFor(() => !!skinIn(namelessRoom), 2000);
  check(skinIn(namelessRoom) === b && me(namelessRoom)?.account === false, `an account without a username plays under a guest name, in its saved skin (${skinIn(namelessRoom)})`);
  await namelessRoom.leave();

  // Guests: a random skin, different from the other's, the option ignored.
  const first = await joinWith(url, undefined);
  await waitFor(() => !!skinIn(first), 2000);
  const firstSkin = skinIn(first);
  check(isSkinId(firstSkin), `a guest gets a skin from SKINS, set with the player (${firstSkin})`);
  const second = await joinWith(url, undefined, first.roomId, { skin: firstSkin });
  await waitFor(() => !!skinIn(second) && !!skinIn(first, second.sessionId), 2000);
  check(
    isSkinId(skinIn(second)) && skinIn(second) !== firstSkin && skinIn(first, second.sessionId) === skinIn(second),
    `two guests in a duel wear different skins, and a guest's skin join option is ignored (asked ${firstSkin}, got ${skinIn(second)})`,
  );

  // A reconnect keeps the roll.
  second.reconnection.minUptime = 0;
  const before = { id: second.sessionId, skin: skinIn(second) };
  let back = false;
  second.onReconnect(() => (back = true));
  const local = matchMaker.getLocalRoomById(first.roomId) as unknown as { clients: { sessionId: string; ref: { terminate(): void } }[] };
  local.clients.find((c) => c.sessionId === second.sessionId)?.ref.terminate();
  const reconnected = await waitFor(() => back && me(second)?.connected === true, 8000);
  check(
    reconnected && second.sessionId === before.id && skinIn(second) === before.skin && skinIn(first, second.sessionId) === before.skin,
    `a guest keeps their skin through a reconnect (${before.skin} -> ${skinIn(second)})`,
  );
  await Promise.all([first.leave(), second.leave()]);

  // Every mode goes through the same pick, a spectator taking a seat too.
  for (const name of [FFA_ROOM_NAME, TEAM_ROOM_NAME]) {
    const host = await joinWith(url, undefined, undefined, undefined, name);
    const rooms = [host];
    for (let i = 0; i < 3; i++) rooms.push(await joinWith(url, undefined, host.roomId, { skin: SKINS[0].id }));
    const spectator = await joinWith(url, undefined, host.roomId, { spectate: true });
    rooms.push(spectator);
    await waitFor(() => skinsIn(host).filter(Boolean).length === 4, 2000);
    const noSkinWatching = skinIn(host, spectator.sessionId) === "" && !state(host).players.get(spectator.sessionId);
    spectator.send(MSG_TAKE_SEAT, {});
    await waitFor(() => skinsIn(host).filter(Boolean).length === 5, 2000);
    const skins = skinsIn(host);
    check(
      noSkinWatching && skins.length === 5 && skins.every(isSkinId) && new Set(skins).size === 5,
      `${name}: five guests (one of them a spectator who took a seat) wear five different skins (${skins.join(", ")})`,
    );
    await Promise.all(rooms.map((r) => r.leave()));
  }
}

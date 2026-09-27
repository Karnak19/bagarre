// Account checks for the smoke test (see smoke.ts).
//
// Clerk is replaced by a throwaway RSA key generated here: the server is told
// to accept tokens signed with it through configureAccountsForTests, which
// refuses to run with NODE_ENV=production. Convex is exercised twice:
//   - in-process with convex-test (the real packages/backend/convex/ functions on a fake
//     database), which backs the server's username lookup and stats writes;
//   - against the live dev deployment (CONVEX_URL + GAME_SERVER_SECRET from
//     .env.local) for matches.record's secret check and idempotency.

import { Client, ErrorCode, type Room } from "@colyseus/sdk";
import { ROOM_NAME, TICK_MS, type PlayerView, type RoomStateView } from "@bagarre/shared";
import { convexTest } from "convex-test";
import { ConvexHttpClient } from "convex/browser";
import { SignJWT, exportSPKI, generateKeyPair, type CryptoKey } from "jose";
import { api } from "@bagarre/backend/api";
import schema from "@bagarre/backend/schema";
import { convexModules } from "@bagarre/backend/testing";
import { configureAccountsForTests, type MatchResult } from "./src/accounts.ts";

type Check = (cond: boolean, label: string) => void;

const TEST_ISSUER = "https://smoke-test.clerk.accounts.dev";

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

export interface AccountsHarness {
  sign(sub: string, opts?: { expiresIn?: number; key?: CryptoKey; audience?: string }): Promise<string>;
  t: ReturnType<typeof convexTest>;
  recorded: { matchId: string; players: MatchResult[] }[];
  otherKey: CryptoKey;
}

/** Must run before the first join. */
export async function setupTestAccounts(): Promise<AccountsHarness> {
  if (!process.env.GAME_SERVER_SECRET) process.env.GAME_SERVER_SECRET = "smoke-local-secret";
  const secret = process.env.GAME_SERVER_SECRET;
  const t = convexTest(schema, convexModules());

  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const recorded: AccountsHarness["recorded"] = [];

  configureAccountsForTests({
    jwtKey: await exportSPKI(publicKey),
    secretKey: undefined,
    issuer: TEST_ISSUER,
    authorizedParties: [],
    // Same call the real server makes (users.me with the player's identity),
    // on the convex-test database instead of the deployment.
    lookupUsername: async (clerkId) =>
      (await t.withIdentity({ subject: clerkId, issuer: TEST_ISSUER }).query(api.users.me, {}))?.username ?? null,
    recordMatch: async (matchId, players, mode) => {
      recorded.push({ matchId, players });
      await t.mutation(api.matches.record, { secret, matchId, mode, players });
    },
  });

  return {
    t,
    recorded,
    otherKey: other.privateKey,
    async sign(sub, opts = {}) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ azp: "http://localhost:5199" })
        .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "smoke" })
        .setSubject(sub)
        .setIssuer(TEST_ISSUER)
        .setAudience(opts.audience ?? "convex")
        .setIssuedAt(now - 5)
        .setNotBefore(now - 5)
        .setExpirationTime(now + (opts.expiresIn ?? 60))
        .sign(opts.key ?? privateKey);
    },
  };
}

async function joinWith(url: string, token: string | undefined, roomId?: string) {
  const c = new Client(url);
  if (token !== undefined) c.auth.token = token;
  return roomId ? c.joinById(roomId) : c.create(ROOM_NAME);
}

async function rejected(url: string, token: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const room = await joinWith(url, token);
    await room.leave();
    return { ok: false, detail: "join accepted" };
  } catch (err) {
    const e = err as { code?: number; message?: string };
    return { ok: e.code === ErrorCode.AUTH_FAILED, detail: `code ${e.code}: ${e.message}` };
  }
}

type Stats = { kills: number; deaths: number; wins: number; losses: number; matches: number };
const sameStats = (a: Stats | undefined, b: Stats) =>
  !!a && (Object.keys(b) as (keyof Stats)[]).every((k) => a[k] === b[k]);

/** Joins, identity and a full recorded match. */
export async function accountChecks(url: string, h: AccountsHarness, check: Check) {
  const heroId = "user_smoke_hero";
  const victimId = "user_smoke_victim";
  const claimed = await h.t.withIdentity({ subject: heroId }).mutation(api.users.claimUsername, { username: "SmokeHero" });
  await h.t.withIdentity({ subject: victimId }).mutation(api.users.claimUsername, { username: "Smoke_Victim" });
  check(claimed.ok, "claimUsername creates the user row");

  // Username rules.
  const asOther = h.t.withIdentity({ subject: "user_smoke_other" });
  const taken = await asOther.mutation(api.users.claimUsername, { username: "smokehero" });
  const short = await asOther.mutation(api.users.claimUsername, { username: "ab" });
  const bad = await asOther.mutation(api.users.claimUsername, { username: "no spaces!" });
  check(
    !taken.ok && taken.reason === "taken" && !short.ok && short.reason === "invalid" && !bad.ok && bad.reason === "invalid",
    "claimUsername refuses a taken name (case-insensitive), a short one and bad characters",
  );
  let anonThrows = false;
  try {
    await h.t.mutation(api.users.claimUsername, { username: "Anonymous" });
  } catch {
    anonThrows = true;
  }
  check(anonThrows, "claimUsername needs a signed-in user");

  // Guest.
  const guest = await joinWith(url, undefined);
  await waitFor(() => !!me(guest)?.name, 2000);
  check(/^Guest-\d{4}$/.test(me(guest)?.name ?? ""), `a join without a token is a guest with a generated name (${me(guest)?.name})`);
  await guest.leave();

  // Bad tokens.
  const garbage = await rejected(url, "garbage.not-a.jwt");
  check(garbage.ok, `a garbage token is rejected (${garbage.detail})`);
  const expired = await rejected(url, await h.sign(heroId, { expiresIn: -120 }));
  check(expired.ok, `an expired token is rejected (${expired.detail})`);
  const forged = await rejected(url, await h.sign(heroId, { key: h.otherKey }));
  check(forged.ok, `a token signed with another key is rejected (${forged.detail})`);
  const wrongAud = await rejected(url, await h.sign(heroId, { audience: "someone-else" }));
  check(wrongAud.ok, `a token for another audience is rejected (${wrongAud.detail})`);

  // Two accounts play a whole match; stats land in Convex.
  const hero = await joinWith(url, await h.sign(heroId));
  const victim = await joinWith(url, await h.sign(victimId), hero.roomId);
  const started = await waitFor(() => state(hero).phase === "playing" && !!me(hero) && !!me(victim), 3000);
  check(started, "two account players start a match");
  check(me(hero)?.name === "SmokeHero", `a valid token joins under the account's username (${me(hero)?.name})`);
  const names: string[] = [];
  state(victim).players.forEach((p) => names.push(p.name));
  check(names.sort().join(",") === "SmokeHero,Smoke_Victim", `both names are synced to the other client (${names.join(", ")})`);

  await playMatch(hero, victim);
  const ended = await waitFor(() => state(hero).phase === "ended", 1000);
  check(ended && state(hero).winner === hero.sessionId, "the hero wins the match 5-0");

  await waitFor(() => h.recorded.length > 0, 3000);
  await sleep(200);
  const rec = h.recorded[0];
  check(
    h.recorded.length === 1 &&
      rec.players.length === 2 &&
      rec.players.some((p) => p.clerkId === heroId && p.won && p.kills === 5 && p.deaths === 0) &&
      rec.players.some((p) => p.clerkId === victimId && !p.won && p.kills === 0 && p.deaths === 5),
    `match end calls matches.record once with both players (${JSON.stringify(rec?.players)})`,
  );
  const heroProfile = await h.t.query(api.users.publicProfile, { username: "smokehero" });
  const victimProfile = await h.t.query(api.users.publicProfile, { username: "Smoke_Victim" });
  check(
    sameStats(heroProfile?.stats, { kills: 5, deaths: 0, wins: 1, losses: 0, matches: 1 }) &&
      sameStats(victimProfile?.stats, { kills: 0, deaths: 5, wins: 0, losses: 1, matches: 1 }),
    `stats credited (hero ${JSON.stringify(heroProfile?.stats)}, victim ${JSON.stringify(victimProfile?.stats)})`,
  );

  // Retrying the same match changes nothing; a wrong secret is refused.
  const secret = process.env.GAME_SERVER_SECRET!;
  const again = await h.t.mutation(api.matches.record, { secret, matchId: rec.matchId, players: rec.players });
  const after = await h.t.query(api.users.publicProfile, { username: "SmokeHero" });
  check(
    again.status === "duplicate" && after?.stats.matches === 1 && after.stats.kills === 5,
    `matches.record is idempotent per match id (retry: ${again.status}, matches ${after?.stats.matches})`,
  );
  let wrongSecret = "accepted";
  try {
    await h.t.mutation(api.matches.record, { secret: secret + "x", matchId: "other-match", players: rec.players });
  } catch (err) {
    wrongSecret = err instanceof Error ? err.message : String(err);
  }
  check(/Unauthorized/.test(wrongSecret), `matches.record rejects a wrong secret (convex-test: ${wrongSecret.split("\n")[0]})`);

  await victim.leave();
  await hero.leave();
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

/** matches.record and users.* against the real dev deployment. */
export async function liveConvexChecks(check: Check) {
  const url = process.env.CONVEX_URL;
  const secret = process.env.GAME_SERVER_SECRET;
  if (!url || !secret || secret === "smoke-local-secret") {
    console.log("SKIP  live Convex checks (CONVEX_URL / GAME_SERVER_SECRET not set)");
    return;
  }
  const client = new ConvexHttpClient(url);
  let wrong = "accepted";
  try {
    await client.mutation(api.matches.record, { secret: "definitely-wrong", matchId: "smoke-wrong", players: [] });
  } catch (err) {
    wrong = `${err instanceof Error ? err.message : err} ${(err as { data?: unknown }).data ?? ""}`;
  }
  check(/Unauthorized/.test(wrong), `[live] matches.record rejects a wrong secret`);

  const matchId = `smoke:${crypto.randomUUID()}`;
  const first = await client.mutation(api.matches.record, { secret, matchId, players: [] });
  const second = await client.mutation(api.matches.record, { secret, matchId, players: [] });
  check(
    first.status === "recorded" && second.status === "duplicate",
    `[live] matches.record is idempotent per match id (${first.status}, then ${second.status})`,
  );
  check((await client.query(api.users.me, {})) === null, "[live] users.me is null without a token");
  check(
    (await client.query(api.users.publicProfile, { username: `nobody_${Date.now() % 100000}` })) === null,
    "[live] users.publicProfile is null for an unknown name",
  );
}

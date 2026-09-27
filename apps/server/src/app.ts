import { createAuthContext, createEndpoint, createRouter, defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { FFA_ROOM_NAME, GAMES_ROUTE, ROOM_NAME, TEAM_ROOM_NAME, WATCH_ROUTE, type ModeRules, type OpenGame, type RoomMeta } from "@bagarre/shared";
import { useDatabase } from "./accounts.ts";
import { configureAuth, databaseService, type AuthConfig } from "./auth.ts";
import { createDatabase, type DatabaseLocation } from "./db.ts";
import { DuelRoom, FfaRoom, GameRoom, TeamRoom } from "./GameRoom.ts";

/**
 * The menu's open games list: the public rooms of both modes, the ones with
 * a free seat first (Join), then the ones to watch (Watch): full, or a duel
 * under way. Newest first within each. A duel has a free seat while one
 * player waits for an opponent; a free-for-all or a team deathmatch while
 * it has a seat left, waiting or playing (players drop in). Private rooms never show up
 * (Colyseus keeps them out of `query({ private: false })`). Seats come from
 * the metadata, never from `clients`, which counts spectators too. `names`:
 * the room types to list (the smoke test lists its own).
 */
export async function openGames(names: readonly string[] = [ROOM_NAME, FFA_ROOM_NAME, TEAM_ROOM_NAME]): Promise<OpenGame[]> {
  const out: OpenGame[] = [];
  for (const name of names) {
    const rooms = await matchMaker.query({ name, private: false });
    for (const r of rooms) {
      const meta = r.metadata as RoomMeta | undefined;
      if (!meta || meta.players < 1) continue;
      const free = meta.players < meta.maxPlayers;
      out.push({
        roomId: r.roomId,
        mode: meta.mode,
        hostName: meta.hostName,
        mapId: meta.mapId,
        phase: meta.phase,
        players: meta.players,
        maxPlayers: meta.maxPlayers,
        ...(meta.teams ? { teams: meta.teams } : {}),
        spectators: meta.spectators ?? 0,
        joinable: free && !r.locked && (meta.mode !== "duel" || meta.phase === "waiting"),
        createdAt: meta.createdAt,
      });
    }
  }
  return out.sort((a, b) => Number(b.joinable) - Number(a.joinable) || b.createdAt - a.createdAt).slice(0, 20);
}

const listGames = createEndpoint(GAMES_ROUTE, { method: "GET" }, async () => ({ games: await openGames() }));

const GAME_ROOM_NAMES = new Set([ROOM_NAME, FFA_ROOM_NAME, TEAM_ROOM_NAME]);

/**
 * Watching a game: a spectator's place in a room, past the seat lock (a full
 * room is locked, and `joinById` refuses a locked room). It runs the room's
 * `onAuth` on the Authorization header like any join, then reserves a place
 * with `spectate: true`, which the room's seat count doesn't apply to (see
 * GameRoom.admitting). `reserveSeatFor` checks only the client slots, not
 * the lock. The answer is a seat reservation for
 * `client.consumeSeatReservation()`. `spectate` is set here, never read from
 * the body, so a player can't get into a full room this way.
 *
 * `allowRoom` lets the smoke test watch its own room types too.
 */
function watchEndpoint(allowRoom: (name: string) => boolean) {
  return createEndpoint(WATCH_ROUTE, { method: "POST" }, async (ctx) => {
    if (matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN) throw ctx.error(503);
    const roomId = String(ctx.params.roomId ?? "");
    const [listing] = roomId ? await matchMaker.query({ roomId }) : [];
    if (!listing || !allowRoom(listing.name))
      throw ctx.error(404, { message: `room "${roomId}" not found` });
    const body = (typeof ctx.body === "object" && ctx.body !== null ? ctx.body : {}) as Record<string, unknown>;
    const options = { spectate: true, guestName: typeof body.guestName === "string" ? body.guestName : undefined };
    try {
      const auth = createAuthContext({ headers: ctx.request?.headers ?? ctx.headers ?? new Headers(), req: ctx.request });
      const identity = await GameRoom.onAuth(auth.token, options, auth);
      return await matchMaker.reserveSeatFor(listing, options, identity);
    } catch (e) {
      const err = e as { code?: number; message?: string };
      // The status carries the Colyseus code when it is an HTTP one; a full
      // room (no client slot left) is 409.
      const status = (typeof err.code === "number" && err.code >= 400 && err.code < 600 ? err.code : 409) as 409;
      throw ctx.error(status, { message: err.message ?? String(e) });
    }
  });
}

/**
 * `mapId` pins every duel room to one duel map (the smoke test forces
 * "yard"), `ffaMapId` every FFA room to one FFA map, `teamMapId` every team
 * deathmatch room to one team map; without them each match picks a random
 * map of its mode's pool. `watchAnyRoom` opens the watch
 * route to every room type (the smoke test's own), not just "duel" and "ffa".
 * `duelRules` / `ffaRules` / `teamRules` tweak each mode's rules (the e2e
 * server's short kill target and countdown). `database` is where the
 * accounts live: "memory" for the smoke and e2e servers, else DATABASE_URL
 * (see db.ts). `auth` overrides the public URLs, Discord and mail settings
 * read from the environment (see auth.ts).
 */
export function createServer(
  options: {
    greet?: boolean;
    gracefullyShutdown?: boolean;
    mapId?: string;
    ffaMapId?: string;
    teamMapId?: string;
    watchAnyRoom?: boolean;
    duelRules?: Partial<ModeRules>;
    ffaRules?: Partial<ModeRules>;
    teamRules?: Partial<ModeRules>;
    database?: DatabaseLocation;
    auth?: Partial<AuthConfig>;
  } = {},
) {
  configureAuth(options.auth);
  const db = createDatabase(options.database);
  useDatabase(db);
  const watchGame = watchEndpoint((name) => options.watchAnyRoom === true || GAME_ROOM_NAMES.has(name));
  const duel = options.duelRules ? DuelRoom.withRules(options.duelRules) : DuelRoom;
  const ffa = options.ffaRules ? FfaRoom.withRules(options.ffaRules) : FfaRoom;
  const tdm = options.teamRules ? TeamRoom.withRules(options.teamRules) : TeamRoom;
  return defineServer({
    greet: options.greet ?? false,
    gracefullyShutdown: options.gracefullyShutdown ?? true,
    transport: new WebSocketTransport(),
    rooms: {
      [ROOM_NAME]: defineRoom(options.mapId ? duel.pinnedTo(options.mapId) : duel),
      [FFA_ROOM_NAME]: defineRoom(options.ffaMapId ? ffa.pinnedTo(options.ffaMapId) : ffa),
      [TEAM_ROOM_NAME]: defineRoom(options.teamMapId ? tdm.pinnedTo(options.teamMapId) : tdm),
    },
    // Booted before the server listens; adds the auth and account routes.
    database: databaseService(db),
    routes: createRouter({ listGames, watchGame }),
  });
}

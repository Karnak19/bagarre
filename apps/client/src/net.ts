import { Client, CloseCode, ErrorCode, type Room } from "@colyseus/sdk";
import {
  GAMES_ROUTE,
  MODES,
  MSG_INPUT,
  MSG_PICK,
  MSG_PING,
  MSG_PONG,
  MSG_TAKE_SEAT,
  MSG_TEAM,
  NO_TEAM,
  PLAYER_VIEW_KEYS,
  emptyKit,
  isGameMode,
  parseTiebreak,
  readKit,
  rulesOf,
  watchPath,
  type OpenGame,
  type BulletView,
  type CrateView,
  type FloorItemView,
  type GameMode,
  type GrenadeView,
  type InputMessage,
  type KillView,
  type Phase,
  type PlayerView,
  type PickMessage,
  type RoomStateView,
  type SmokeView,
  type TiebreakReason,
  type ZoneView,
} from "@bagarre/shared";
import { account } from "./auth.ts";

/** A plain copy of the room state at one server tick, stamped on arrival. */
export interface Snapshot {
  /** performance.now() when the snapshot was received (after artificial lag). */
  t: number;
  /**
   * Connection number it arrived on: 0 from the join, +1 after each
   * automatic reconnection. A new epoch is a hard boundary, see match.ts.
   */
  epoch: number;
  tick: number;
  /** "duel", "ffa", "tdm" or "royale" (never changes in a room). */
  mode: GameMode;
  phase: Phase;
  winner: string;
  /** Why the winner won when level on kills (see RoomStateView.tiebreak), "" outright. */
  tiebreak: TiebreakReason;
  /** Team deathmatch: each team's kills, and the winning team once ended (NO_TEAM before, or no teams). */
  redScore: number;
  blueScore: number;
  winningTeam: number;
  /** The map this snapshot is on. A change is a hard boundary, see match.ts. */
  mapId: string;
  /** Tick the current match started on, and ended on (0 while it runs). */
  startTick: number;
  endTick: number;
  killsToWin: number;
  /** Seconds (0: no time limit). */
  timeLimit: number;
  /** Ticks left of the pre-match countdown (0: none). */
  countdown: number;
  /** Warmup: the server tick it ends on (0 outside warmup). See `warmupLeft`. */
  warmupEnd: number;
  suddenDeath: boolean;
  players: Map<string, PlayerView>;
  bullets: Map<string, BulletView>;
  grenades: Map<string, GrenadeView>;
  /** Smoke clouds on the ground. */
  smokes: Map<string, SmokeView>;
  /** The last few deaths, oldest first. */
  feed: KillView[];
  /** Spectators watching the room right now. */
  spectators: number;
  /** Seats in this game (the mode's cap). */
  maxPlayers: number;
  /** Battle royale: the items on the floor, the crates still standing, and the zone (`end` 0: none). */
  items: Map<string, FloorItemView>;
  crates: Map<string, CrateView>;
  zone: ZoneView;
}

const NO_ZONE: ZoneView = { x0: 0, z0: 0, x1: 0, z1: 0, r0: 0, r1: 0, start: 0, end: 0 };

function capture(state: RoomStateView): Omit<Snapshot, "t" | "epoch"> {
  const players = new Map<string, PlayerView>();
  state.players.forEach((p, id) => {
    const copy = {} as Record<string, unknown>;
    for (const k of PLAYER_VIEW_KEYS) copy[k] = p[k];
    // The kit is a child schema: a plain copy of its own (an older server has none).
    copy.kit = p.kit ? readKit(p.kit) : emptyKit();
    copy.outTick = p.outTick ?? 0;
    players.set(id, copy as unknown as PlayerView);
  });
  const bullets = new Map<string, BulletView>();
  state.bullets.forEach((b, id) => bullets.set(id, { x: b.x, z: b.z, owner: b.owner }));
  const grenades = new Map<string, GrenadeView>();
  state.grenades.forEach((g, id) =>
    grenades.set(id, {
      x: g.x,
      y: g.y,
      z: g.z,
      tx: g.tx,
      tz: g.tz,
      landed: g.landed,
      exploded: g.exploded,
      owner: g.owner,
      kind: g.kind ?? 0,
    }),
  );
  const smokes = new Map<string, SmokeView>();
  state.smokes?.forEach((c, id) => smokes.set(id, { x: c.x, z: c.z, start: c.start, end: c.end, owner: c.owner, team: c.team }));
  const items = new Map<string, FloorItemView>();
  state.items?.forEach((it, id) => items.set(id, { x: it.x, z: it.z, kind: it.kind, item: it.item, amount: it.amount, blockedFor: it.blockedFor ?? "" }));
  const crates = new Map<string, CrateView>();
  state.crates?.forEach((c, id) => crates.set(id, { x: c.x, z: c.z }));
  const z = state.zone;
  const zone: ZoneView = z ? { x0: z.x0, z0: z.z0, x1: z.x1, z1: z.z1, r0: z.r0, r1: z.r1, start: z.start, end: z.end } : NO_ZONE;
  const feed: KillView[] = [];
  state.feed?.forEach((k) =>
    feed.push({
      n: k.n,
      tick: k.tick,
      killer: k.killer,
      killerName: k.killerName,
      killerSlot: k.killerSlot,
      victim: k.victim,
      victimName: k.victimName,
      victimSlot: k.victimSlot,
      killerTeam: k.killerTeam,
      victimTeam: k.victimTeam,
      weapon: k.weapon,
    }),
  );
  return {
    tick: state.tick,
    mode: isGameMode(state.mode) ? state.mode : "duel",
    phase: state.phase,
    winner: state.winner,
    tiebreak: parseTiebreak(state.tiebreak),
    redScore: state.redScore ?? 0,
    blueScore: state.blueScore ?? 0,
    winningTeam: state.winningTeam ?? NO_TEAM,
    mapId: state.mapId,
    startTick: state.startTick,
    endTick: state.endTick,
    killsToWin: state.killsToWin,
    timeLimit: state.timeLimit,
    countdown: state.countdown,
    warmupEnd: state.warmupEnd ?? 0,
    suddenDeath: state.suddenDeath,
    players,
    bullets,
    grenades,
    smokes,
    feed,
    spectators: state.spectators ?? 0,
    maxPlayers: rulesOf(state.mode).maxPlayers,
    items,
    crates,
    zone,
  };
}

/**
 * `reconnecting`: the connection dropped and the SDK is retrying on its own
 * (the server holds our seat for RECONNECT_GRACE_S). `disconnected`: for good.
 */
export type NetStatus = "connected" | "reconnecting" | "disconnected";

// --- Resuming after a page reload ------------------------------------------------
//
// The SDK's automatic reconnection lives in the Room object, which a reload
// destroys. So the reconnection token of the game being played is kept in
// sessionStorage (per tab, gone with the tab); reopening that game's page
// within the grace period resumes the same seat with `client.reconnect()`.
// A deliberate leave or a closed connection forgets it.

const RESUME_KEY = "bagarre:resume";

interface ResumeRecord {
  roomId: string;
  sessionId: string;
  /** `roomId:token`, what `client.reconnect()` takes. Refreshed on every (re)connection. */
  token: string;
  /** We created it as a private game (the waiting card's wording). */
  isPrivate: boolean;
}

function readResume(): ResumeRecord | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    const r = raw ? (JSON.parse(raw) as Partial<ResumeRecord>) : null;
    return r && typeof r.roomId === "string" && typeof r.sessionId === "string" && typeof r.token === "string"
      ? { roomId: r.roomId, sessionId: r.sessionId, token: r.token, isPrivate: r.isPrivate === true }
      : null;
  } catch {
    return null;
  }
}

function writeResume(r: ResumeRecord | null) {
  try {
    if (r) sessionStorage.setItem(RESUME_KEY, JSON.stringify(r));
    else sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // Storage blocked: a reload simply won't resume.
  }
}

/** The stored resume record of this room, if there is one. */
export function resumeFor(roomId: string): ResumeRecord | null {
  const r = readResume();
  return r?.roomId === roomId ? r : null;
}

/**
 * How to get into a game: quick match or a new private game of a mode, a
 * given room of either mode (its /game/<code> page), or watching one (its
 * /game/<code>/watch page).
 */
export type JoinRequest =
  | { kind: "quick"; mode: GameMode }
  | { kind: "private"; mode: GameMode }
  | { kind: "id"; roomId: string }
  | { kind: "watch"; roomId: string };

/** A player in a seat, or a spectator (no seat: nothing we send counts). */
export type NetRole = "player" | "spectator";

/** The matchmaking room name of a mode. */
const roomName = (mode: GameMode) => MODES[mode].roomName;

export type JoinFailure =
  /** The room exists but every player seat is taken. */
  | "full"
  /** No such room: a stale or mistyped link, or everyone left and it closed. */
  | "gone"
  /** The game server didn't answer. */
  | "unreachable"
  | "error";

export class JoinError extends Error {
  constructor(
    readonly reason: JoinFailure,
    message: string,
  ) {
    super(message);
  }
}

/** joinById of a room that is gone, or locked because it is full. */
const INVALID_ROOM_ID = ErrorCode.MATCHMAKE_INVALID_ROOM_ID;

function toJoinError(err: unknown): JoinError {
  if (err instanceof JoinError) return err;
  const e = err as { code?: number; message?: string };
  const message = String(e?.message ?? err);
  if (e?.code === INVALID_ROOM_ID) return new JoinError(/locked|full/i.test(message) ? "full" : "gone", message);
  // The watch route answers over plain HTTP: 404 for a missing room, 409 when even the spectator places are taken.
  if (e?.code === 404) return new JoinError("gone", message);
  if (e?.code === 409) return new JoinError("full", message);
  // fetch() failing (server down, wrong ?server=) has no Colyseus code.
  if (e?.code === undefined && (err instanceof TypeError || /fetch|network|connect/i.test(message)))
    return new JoinError("unreachable", message);
  return new JoinError("error", message);
}

/**
 * Joins a game with the account's session token when signed in (sent as the
 * Colyseus auth token, read by GameRoom.onAuth), or without one as a guest.
 * The server treats a bad or expired token as a guest too; the player
 * state's `account` flag says what it saw (see Net's onStateChange). The
 * token is read fresh on every join, so signing in or out from the menu
 * applies to the next game without a reload.
 *
 * `options` carries the dev `?map=` toggle (the server ignores it in
 * production).
 */
export async function joinGame(url: string, req: JoinRequest, options: Record<string, unknown> = {}): Promise<Room> {
  // This tab was in that game a moment ago (a reload): take the held seat back.
  // Watching resumes the same way (spectators get a grace period too).
  const resume = req.kind === "id" || req.kind === "watch" ? resumeFor(req.roomId) : null;
  if (resume) {
    try {
      return await new Client(url).reconnect(resume.token);
    } catch (err) {
      // The grace period is over, or the room is gone: join like anyone else.
      console.info("[net] couldn't resume the previous session, joining again:", err);
      writeResume(null);
    }
  }
  const token = await account.getJoinToken();
  const client = new Client(url);
  // A new Client picks up the stored token by itself; say exactly what to send.
  client.http.authToken = token;
  try {
    if (req.kind === "quick") return await client.joinOrCreate(roomName(req.mode), options);
    if (req.kind === "private") return await client.create(roomName(req.mode), { ...options, private: true });
    if (req.kind === "watch") return await watch(client, req.roomId, options);
    return await client.joinById(req.roomId, options);
  } catch (err) {
    throw toJoinError(err);
  }
}

/**
 * A spectator's place in a room, through the watch route (POST
 * /games/<id>/watch): it gets past the seat lock of a full room, which
 * `joinById` can't. The route answers with a seat reservation, consumed
 * like any join (the auth token rides along in both requests).
 */
async function watch(client: Client, roomId: string, options: Record<string, unknown>): Promise<Room> {
  const res = await client.http.post(watchPath(roomId), {
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: { guestName: options.guestName },
  });
  return client.consumeSeatReservation(res.data as Parameters<Client["consumeSeatReservation"]>[0]);
}

/** The public games, both modes: the joinable ones first, then the ones to watch (GET /games on the game server). */
export async function fetchOpenGames(url: string, signal?: AbortSignal): Promise<OpenGame[]> {
  // Appended, not `new URL(GAMES_ROUTE, url)`: that would drop a path prefix
  // such as the production `/colyseus` (the route starts with "/").
  const res = await fetch(`${url.replace(/\/$/, "")}${GAMES_ROUTE}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { games?: OpenGame[] };
  return Array.isArray(body.games) ? body.games : [];
}

/**
 * One joined room. Every message in and out goes through `delay`, which
 * implements the `?lag=` dev toggle: the value is extra round-trip time, split
 * half on the way out and half on the way back. `leave()` really leaves (the
 * server sees a consented leave at once) and silences everything, including
 * snapshots still sitting in the lag queue.
 *
 * A dropped connection is not the end: the SDK reconnects the same Room
 * object on its own (status `reconnecting`, then `connected` again, with a
 * new `epoch`), within the server's grace period. Nothing is sent meanwhile.
 */
export class Net {
  readonly room: Room;
  readonly sessionId: string;
  readonly roomId: string;
  status: NetStatus = "connected";
  error = "";
  /** The close code once `disconnected` (CloseCode: 4001 server shutdown, 4003 failed to reconnect...). */
  closeCode = 0;
  /** Bumped by every automatic reconnection; stamped on each snapshot. */
  epoch = 0;
  readonly lagMs: number;
  readonly isPrivate: boolean;
  /**
   * Whether we hold a seat, from each snapshot (`state.players` has us or
   * not). Before the first one, what we asked for. It flips to "player" when
   * a spectator takes a seat, on the same Room.
   */
  role: NetRole;
  onSnapshot: (s: Snapshot) => void = () => {};
  /** The server closed the connection, or it dropped for good (not called after `leave()`). */
  onClosed: (code: number) => void = () => {};
  private closed = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(room: Room, lagMs: number, opts: { isPrivate?: boolean; role?: NetRole } = {}) {
    this.room = room;
    this.sessionId = room.sessionId;
    this.roomId = room.roomId;
    this.lagMs = Math.max(0, lagMs);
    this.isPrivate = opts.isPrivate ?? false;
    this.role = opts.role ?? "player";
    // Retry every 2 s at most (the default backs off to 5 s): with the SDK's
    // 15 attempts that is about 25 s, a little past the server's grace period,
    // after which the server answers FAILED_TO_RECONNECT (4003) at once.
    room.reconnection.maxDelay = 2000;
    this.remember();
    room.onStateChange((state) => {
      if (this.closed) return;
      // Copy now (the live state object keeps mutating), deliver later.
      const snap = capture(state as unknown as RoomStateView);
      const mine = snap.players.get(room.sessionId);
      if (mine?.name) account.setPlayingAs(mine.name, !!mine.account);
      this.role = mine ? "player" : "spectator";
      const epoch = this.epoch;
      this.delay(() => this.onSnapshot({ ...snap, epoch, t: performance.now() }));
    });
    // Fires again on every failed retry: idempotent.
    room.onDrop(() => {
      if (this.closed || this.status !== "connected") return;
      this.status = "reconnecting";
    });
    room.onReconnect(() => {
      if (this.closed) return;
      this.status = "connected";
      this.epoch++;
      this.remember();
    });
    room.onLeave((code) => {
      if (this.closed) return;
      this.status = "disconnected";
      this.closeCode = code;
      this.forget();
      this.onClosed(code);
    });
    room.onError((code, message) => {
      this.error = `${code} ${message ?? ""}`;
    });
    // The server's latency probe: answered at once (through the `?lag=`
    // delay both ways, so the measured ping includes it).
    room.onMessage(MSG_PING, (m: unknown) => this.delay(() => this.delay(() => this.send(MSG_PONG, m))));
  }

  /** The server restarted (a deploy) rather than the connection failing. */
  get serverRestarted(): boolean {
    return this.closeCode === CloseCode.SERVER_SHUTDOWN;
  }

  /** Keeps the current reconnection token for a reload (see resumeFor). */
  private remember() {
    writeResume({ roomId: this.roomId, sessionId: this.sessionId, token: this.room.reconnectionToken, isPrivate: this.isPrivate });
  }

  /** Forgets it, if it is still ours (a newer game may have replaced it). */
  private forget() {
    if (readResume()?.sessionId === this.sessionId) writeResume(null);
  }

  private delay(fn: () => void) {
    const half = this.lagMs / 2;
    if (half <= 0) {
      fn();
      return;
    }
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.closed) fn();
    }, half);
    this.timers.add(t);
  }

  /**
   * Sends now if connected. While reconnecting nothing goes out (the SDK
   * would queue it and flush stale inputs on reconnect).
   */
  private send(type: string, payload: unknown) {
    if (this.status === "connected") this.room.send(type, payload);
  }

  /** A spectator's input would be dropped by the server anyway; it never leaves. */
  sendInput(input: InputMessage) {
    if (this.status !== "connected" || this.role === "spectator") return;
    this.delay(() => this.send(MSG_INPUT, input));
  }

  /** The loadout for the next spawn: a weapon, a grenade type, or both. */
  sendPick(pick: PickMessage) {
    if (this.status !== "connected" || this.role === "spectator") return;
    this.delay(() => this.send(MSG_PICK, pick));
  }

  /** Team deathmatch, while waiting: ask to move to `team` (the server refuses it if it would unbalance the teams). */
  sendTeam(team: number) {
    if (this.status !== "connected" || this.role === "spectator") return;
    this.delay(() => this.send(MSG_TEAM, { team }));
  }

  /** Spectator: take the free seat (the role flips on the snapshot that has us in `players`). */
  takeSeat() {
    if (this.role !== "spectator") return;
    this.delay(() => this.send(MSG_TAKE_SEAT, {}));
  }

  /** Leaves the room for good. Safe to call twice. */
  async leave() {
    if (this.closed) return;
    const reconnecting = this.status === "reconnecting";
    this.closed = true;
    this.status = "disconnected";
    this.forget();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.onSnapshot = () => {};
    this.onClosed = () => {};
    this.room.onStateChange.clear();
    // No reconnection attempts: this is a deliberate leave.
    this.room.reconnection.enabled = false;
    if (reconnecting) {
      // The socket is down, so there is nothing to send the leave on, and
      // the SDK may already have a retry scheduled (it can't be cancelled).
      // No retry after that one; if it lands, leave for real right away.
      // Otherwise the server frees the seat when its grace period ends.
      this.room.reconnection.maxRetries = 0;
      this.room.onReconnect(() => void this.room.leave(true).finally(() => this.room.removeAllListeners()));
      return;
    }
    try {
      await this.room.leave(true);
    } catch (err) {
      console.warn("[net] leave failed", err);
    } finally {
      this.room.removeAllListeners();
    }
  }
}

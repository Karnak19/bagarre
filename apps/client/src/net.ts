import { Client, CloseCode, ErrorCode, type Room } from "@colyseus/sdk";
import {
  GAMES_ROUTE,
  MSG_INPUT,
  MSG_PICK,
  MSG_PING,
  MSG_PONG,
  PLAYER_VIEW_KEYS,
  ROOM_NAME,
  type OpenGame,
  type BulletView,
  type GrenadeView,
  type InputMessage,
  type Phase,
  type PlayerView,
  type RoomStateView,
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
  phase: Phase;
  winner: string;
  /** The map this snapshot is on. A change is a hard boundary, see match.ts. */
  mapId: string;
  /** Tick the current match started on, and ended on (0 while it runs). */
  startTick: number;
  endTick: number;
  players: Map<string, PlayerView>;
  bullets: Map<string, BulletView>;
  grenades: Map<string, GrenadeView>;
}

function capture(state: RoomStateView): Omit<Snapshot, "t" | "epoch"> {
  const players = new Map<string, PlayerView>();
  state.players.forEach((p, id) => {
    const copy = {} as Record<string, unknown>;
    for (const k of PLAYER_VIEW_KEYS) copy[k] = p[k];
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
    }),
  );
  return {
    tick: state.tick,
    phase: state.phase,
    winner: state.winner,
    mapId: state.mapId,
    startTick: state.startTick,
    endTick: state.endTick,
    players,
    bullets,
    grenades,
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

/** How to get into a game: quick match, a new private game, or a given room (its /game/<code> page). */
export type JoinRequest = { kind: "quick" } | { kind: "private" } | { kind: "id"; roomId: string };

export type JoinFailure =
  /** The room exists but both seats are taken. */
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
  if (e?.code === INVALID_ROOM_ID) return new JoinError(/locked/i.test(message) ? "full" : "gone", message);
  // fetch() failing (server down, wrong ?server=) has no Colyseus code.
  if (e?.code === undefined && (err instanceof TypeError || /fetch|network|connect/i.test(message)))
    return new JoinError("unreachable", message);
  return new JoinError("error", message);
}

/**
 * Joins a game with the Clerk token when signed in (sent as the Colyseus auth
 * header, read by DuelRoom.onAuth), or without one as a guest. If the server
 * refuses the token, joins again as a guest and says so. The token is read
 * fresh on every join, so signing in or out from the menu applies to the
 * next game without a reload.
 *
 * `options` carries the dev `?map=` toggle (the server ignores it in
 * production).
 */
export async function joinGame(url: string, req: JoinRequest, options: Record<string, unknown> = {}): Promise<Room> {
  // This tab was in that game a moment ago (a reload): take the held seat back.
  const resume = req.kind === "id" ? resumeFor(req.roomId) : null;
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
  const attempt = (client: Client) => {
    if (req.kind === "quick") return client.joinOrCreate(ROOM_NAME, options);
    if (req.kind === "private") return client.create(ROOM_NAME, { ...options, private: true });
    return client.joinById(req.roomId, options);
  };
  const client = new Client(url);
  if (token) client.auth.token = token;
  try {
    return await attempt(client);
  } catch (err) {
    if (!token || (err as { code?: number }).code !== ErrorCode.AUTH_FAILED) throw toJoinError(err);
    console.warn("[net] session token refused, joining as guest:", err);
    account.setNotice("Your session couldn't be verified, so you're playing as a guest.");
    try {
      return await attempt(new Client(url));
    } catch (err2) {
      throw toJoinError(err2);
    }
  }
}

/** The public games waiting for a second player (GET /games on the game server). */
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
  onSnapshot: (s: Snapshot) => void = () => {};
  /** The server closed the connection, or it dropped for good (not called after `leave()`). */
  onClosed: (code: number) => void = () => {};
  private closed = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(room: Room, lagMs: number, opts: { isPrivate?: boolean } = {}) {
    this.room = room;
    this.sessionId = room.sessionId;
    this.roomId = room.roomId;
    this.lagMs = Math.max(0, lagMs);
    this.isPrivate = opts.isPrivate ?? false;
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
      if (mine?.name) account.setPlayingAs(mine.name);
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

  sendInput(input: InputMessage) {
    if (this.status !== "connected") return;
    this.delay(() => this.send(MSG_INPUT, input));
  }

  sendPick(weapon: number) {
    if (this.status !== "connected") return;
    this.delay(() => this.send(MSG_PICK, { weapon }));
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

import { Client, ErrorCode, type Room } from "@colyseus/sdk";
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

function capture(state: RoomStateView): Omit<Snapshot, "t"> {
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

export type NetStatus = "connected" | "disconnected";

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

/** Colyseus' MATCHMAKE_INVALID_ROOM_ID: joinById of a room that is gone, or locked because it is full. */
const INVALID_ROOM_ID = 522;

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
 */
export class Net {
  readonly room: Room;
  readonly sessionId: string;
  readonly roomId: string;
  status: NetStatus = "connected";
  error = "";
  readonly lagMs: number;
  onSnapshot: (s: Snapshot) => void = () => {};
  /** The server closed the connection, or it dropped (not called after `leave()`). */
  onClosed: () => void = () => {};
  private closed = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(room: Room, lagMs: number) {
    this.room = room;
    this.sessionId = room.sessionId;
    this.roomId = room.roomId;
    this.lagMs = Math.max(0, lagMs);
    room.onStateChange((state) => {
      if (this.closed) return;
      // Copy now (the live state object keeps mutating), deliver later.
      const snap = capture(state as unknown as RoomStateView);
      const mine = snap.players.get(room.sessionId);
      if (mine?.name) account.setPlayingAs(mine.name);
      this.delay(() => this.onSnapshot({ ...snap, t: performance.now() }));
    });
    room.onLeave(() => {
      if (this.closed) return;
      this.status = "disconnected";
      this.onClosed();
    });
    room.onError((code, message) => {
      this.error = `${code} ${message ?? ""}`;
    });
    // The server's latency probe: answered at once (through the `?lag=`
    // delay both ways, so the measured ping includes it).
    room.onMessage(MSG_PING, (m: unknown) => this.delay(() => this.delay(() => this.room.send(MSG_PONG, m))));
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

  sendInput(input: InputMessage) {
    if (this.status !== "connected") return;
    this.delay(() => this.room.send(MSG_INPUT, input));
  }

  sendPick(weapon: number) {
    if (this.status !== "connected") return;
    this.delay(() => this.room.send(MSG_PICK, { weapon }));
  }

  /** Leaves the room for good. Safe to call twice. */
  async leave() {
    if (this.closed) return;
    this.closed = true;
    this.status = "disconnected";
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.onSnapshot = () => {};
    this.onClosed = () => {};
    this.room.onStateChange.clear();
    try {
      // No reconnection attempts: this is a deliberate leave.
      this.room.reconnection.enabled = false;
      await this.room.leave(true);
    } catch (err) {
      console.warn("[net] leave failed", err);
    } finally {
      this.room.removeAllListeners();
    }
  }
}

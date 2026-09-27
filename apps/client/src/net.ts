import { Client, ErrorCode, type Room } from "@colyseus/sdk";
import {
  MSG_INPUT,
  MSG_PICK,
  PLAYER_VIEW_KEYS,
  ROOM_NAME,
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
  /** The map this snapshot is on. A change is a hard boundary, see main.ts. */
  mapId: string;
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
  return { tick: state.tick, phase: state.phase, winner: state.winner, mapId: state.mapId, players, bullets, grenades };
}

export type NetStatus = "connecting" | "connected" | "disconnected";

/**
 * Wraps the Colyseus room. Every message in and out goes through `delay`, which
 * implements the `?lag=` dev toggle: the value is extra round-trip time, split
 * half on the way out and half on the way back.
 */
export class Net {
  room: Room | null = null;
  sessionId = "";
  status: NetStatus = "connecting";
  error = "";
  readonly lagMs: number;
  /** Join options: `{ map }` from the dev `?map=` toggle (the server ignores it in production). */
  private readonly joinOptions: Record<string, unknown>;
  onSnapshot: (s: Snapshot) => void = () => {};

  constructor(lagMs: number, map: string | null = null) {
    this.lagMs = Math.max(0, lagMs);
    this.joinOptions = map ? { map } : {};
  }

  private delay(fn: () => void) {
    const half = this.lagMs / 2;
    if (half <= 0) fn();
    else setTimeout(fn, half);
  }

  /**
   * Joins with the Clerk token when signed in (sent as the Colyseus auth
   * header, read by DuelRoom.onAuth), or without one as a guest. If the server
   * refuses the token, joins again as a guest and says so.
   */
  private async join(url: string): Promise<Room> {
    const token = await account.getJoinToken();
    const client = new Client(url);
    if (token) client.auth.token = token;
    try {
      return await client.joinOrCreate(ROOM_NAME, this.joinOptions);
    } catch (err) {
      if (!token || (err as { code?: number }).code !== ErrorCode.AUTH_FAILED) throw err;
      console.warn("[net] session token refused, joining as guest:", err);
      account.setNotice("Your session couldn't be verified, so you're playing as a guest.");
      return await new Client(url).joinOrCreate(ROOM_NAME, this.joinOptions);
    }
  }

  async connect(url: string) {
    try {
      const room = await this.join(url);
      this.room = room;
      this.sessionId = room.sessionId;
      this.status = "connected";
      room.onStateChange((state) => {
        // Copy now (the live state object keeps mutating), deliver later.
        const snap = capture(state as unknown as RoomStateView);
        const mine = snap.players.get(room.sessionId);
        if (mine?.name) account.setPlayingAs(mine.name);
        this.delay(() => this.onSnapshot({ ...snap, t: performance.now() }));
      });
      room.onLeave(() => {
        this.status = "disconnected";
      });
      room.onError((code, message) => {
        this.error = `${code} ${message ?? ""}`;
      });
    } catch (err) {
      this.status = "disconnected";
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  sendInput(input: InputMessage) {
    const room = this.room;
    if (!room || this.status !== "connected") return;
    this.delay(() => room.send(MSG_INPUT, input));
  }

  sendPick(weapon: number) {
    const room = this.room;
    if (!room || this.status !== "connected") return;
    this.delay(() => room.send(MSG_PICK, { weapon }));
  }
}

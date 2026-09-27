// The game room, for both modes. A duel and a free-for-all run the same
// simulation (inputs, bullets, grenades, damage); what differs is in the
// mode's rules (@bagarre/shared modes.ts): seats, win condition, map pool,
// countdown, spawns, respawn delay. `DuelRoom` and `FfaRoom` at the bottom
// only pick the rules.
//
// Seats and clients. A client is not a player: a player is a seat, which is
// an entry in `state.players` (plus its `internals`), and the seat number is
// the player's `slot` (colour, bullet ids). A seat is taken in `onJoin`, kept
// through a dropped connection (onDrop / onReconnect, RECONNECT_GRACE_S) and
// freed in `onLeave`. The player cap is enforced on seats, never through
// `maxClients`, which leaves SPECTATOR_ROOM clients of room for spectators:
// clients with no seat and no player entity. Every handler already ignores a
// client without a seat (no input, no pick, no ping), so a spectator only
// needs its branch in `onJoin` (see `wantsSeat`) and a way in past the seat
// lock (see `hasReachedMaxClients`). Nothing builds spectating yet.

import {
  CloseCode,
  ErrorCode,
  Room,
  ServerError,
  matchMaker,
  type AuthContext,
  type Client,
  type RoomException,
  type RoomMethodName,
} from "@colyseus/core";
import {
  BULLET_RADIUS,
  DEFAULT_MAP_ID,
  DUEL_RULES,
  FFA_RULES,
  FFA_SUDDEN_DEATH_MAX,
  GRENADE_FUSE_TICKS,
  INPUT_BURST,
  KILL_FEED_SIZE,
  KILL_GRENADE,
  MAX_HP,
  MAX_INPUT_QUEUE,
  MAX_MESSAGES_PER_SECOND,
  MSG_INPUT,
  MSG_PICK,
  MSG_PING,
  MSG_PONG,
  PLAYER_RADIUS,
  RECONNECT_GRACE_S,
  SHIELD,
  SHIELD_TICKS,
  SPECTATOR_ROOM,
  TICK_RATE,
  bulletId,
  bulletLifeTicks,
  circlesOverlap,
  ffaRespawnPoint,
  ffaStartSpawns,
  grenadeArc,
  grenadeDamage,
  grenadeFlightTicks,
  mapById,
  placements,
  readSim,
  respawnPoint,
  shotPellets,
  spawnSim,
  stepBullet,
  stepPlayer,
  parseInput,
  parsePick,
  parsePong,
  ticks,
  weaponDef,
  writeSim,
  type FfaMapDef,
  type InputMessage,
  type MapDef,
  type ModeRules,
  type Phase,
  type RoomMeta,
  type Spawn,
  type Vec2,
} from "@bagarre/shared";
import { AuthRejected, guestName, recordMatch, resolveIdentity, type Identity, type MatchResult } from "./accounts.ts";
import { Bullet, GameState, Grenade, KillEvent, Player } from "./state.ts";

/**
 * Error code of a join refused for a bad Clerk token: Colyseus' own
 * AUTH_FAILED (it doubles as the HTTP status, so it must stay in 200-599).
 * The client then falls back to guest.
 */
export const AUTH_REJECTED_CODE = ErrorCode.AUTH_FAILED;

/** Server-only bookkeeping per seat. Never synced. */
interface PlayerInternal {
  queue: InputMessage[];
  /** Input budget, see INPUT_BURST. */
  tokens: number;
  /** Who this is, from onAuth. */
  identity: Identity;
  /** Deaths in the current match (kills are synced on Player). */
  deaths: number;
  /** The latency probe in flight: its number and when it was sent (performance.now()). */
  ping: { n: number; at: number } | null;
  /**
   * The press counters of this seat's first input are taken as the baseline
   * (see applyInput). False from a fresh join until that input; a reconnect
   * keeps it true and resumes from the synced counters.
   */
  baselined: boolean;
}

/** Server-only bookkeeping per bullet. */
interface BulletInternal {
  vx: number;
  vz: number;
  ticksLeft: number;
  damage: number;
  weapon: number;
}

/** Server-only bookkeeping per grenade. */
interface GrenadeInternal {
  ox: number;
  oz: number;
  flightTicks: number;
  age: number;
  fuseLeft: number;
}

const PING_INTERVAL_MS = 2000;
let pingCounter = 0;

const optionsRecord = (options: unknown): Record<string, unknown> =>
  typeof options === "object" && options !== null ? (options as Record<string, unknown>) : {};

/** The `guestName` join option, when it has the server's own guest name format. */
function requestedGuestName(options: unknown): string | null {
  const v = optionsRecord(options).guestName;
  return typeof v === "string" && /^Guest-\d{4}$/.test(v) ? v : null;
}

/**
 * Whether this join takes a player seat. Always, for now. The seam for
 * spectators: a `spectate: true` join option would return false here, and
 * onJoin would then register the client with no Player (every handler
 * already ignores clients without a seat).
 */
function wantsSeat(_options: unknown): boolean {
  return true;
}

/** The map's own spawns for the match start of a duel slot. */
const duelSpawn = (map: MapDef, slot: number): Spawn => map.spawns[slot % map.spawns.length];

export class GameRoom extends Room<{ state: GameState; metadata: RoomMeta }> {
  /** The mode this room class plays. Subclasses (DuelRoom, FfaRoom, `withRules`) set it. */
  static rules: ModeRules = DUEL_RULES;
  protected readonly rules: ModeRules = (this.constructor as typeof GameRoom).rules;
  /** Seats plus room for spectators: the player cap is on seats (hasReachedMaxClients), never here. */
  maxClients = this.rules.maxPlayers + SPECTATOR_ROOM;
  state = new GameState();
  /** Flood protection: past this the client is disconnected (4002, no seat held). */
  maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  /** Seconds a dropped player's seat is held. A property so the smoke test can shorten it in a subclass. */
  protected reconnectGrace = RECONNECT_GRACE_S;

  /**
   * Every client message. Each payload goes through its parser from
   * @bagarre/shared first: anything malformed is dropped, never coerced.
   * Handlers read the sender from `client`, never from the payload, and do
   * nothing for a client without a seat.
   */
  messages = {
    [MSG_INPUT]: (client: Client, raw: unknown) => {
      const input = parseInput(raw);
      const internal = this.internals.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!input || !internal || !player?.connected) return;
      if (input.seq <= player.lastSeq || internal.queue.length >= MAX_INPUT_QUEUE) return;
      internal.queue.push(input);
    },

    // Weapon pick: only valid ids, only while dead or between matches. It is
    // stored as `pick` and only put in hand on the next (re)spawn.
    [MSG_PICK]: (client: Client, raw: unknown) => {
      const pick = parsePick(raw);
      const player = this.state.players.get(client.sessionId);
      if (!pick || !player) return;
      if (player.alive && this.state.phase === "playing") return;
      player.pick = pick.weapon;
    },

    // Latency: one probe per client every PING_INTERVAL_MS; the answer's
    // round trip becomes the player's synced `ping`. Only the probe in flight
    // is accepted, so a client can't make its ping up.
    [MSG_PONG]: (client: Client, raw: unknown) => {
      const pong = parsePong(raw);
      const internal = this.internals.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!pong || !internal?.ping || !player || pong.n !== internal.ping.n) return;
      // At least 1 ms, so 0 keeps meaning "not measured yet".
      player.ping = Math.min(9999, Math.max(1, Math.round(performance.now() - internal.ping.at)));
      internal.ping = null;
    },

    // Any other type is dropped. Without this fallback Colyseus closes the
    // sender's connection in production (and answers with an error in dev).
    "*": () => {},
  };

  private internals = new Map<string, PlayerInternal>();
  private bulletInternals = new Map<string, BulletInternal>();
  private grenadeInternals = new Map<string, GrenadeInternal>();
  private nextGrenadeId = 0;
  private nextKill = 0;
  private matchResetTicks = 0;
  /** Unique per match, so a retried stats write is applied once. */
  private matchId = "";
  /** The map being played; `state.mapId` mirrors it. Only changes between matches (see `pickMap`). */
  private map: MapDef = this.rules.maps[0] ?? mapById(DEFAULT_MAP_ID);
  /** Pinned (`pinnedTo`) or forced by the dev `?map=` option: every match stays on `map`. */
  private fixedMap = false;
  /** A match has been started on `map`, so the next one moves to another map. */
  private mapPlayed = false;
  private createdAt = Date.now();
  /** Session ids in join order: the first one is the host shown in the open games list. */
  private joinOrder: string[] = [];
  /** Last metadata written, to skip no-op writes. */
  private metaKey = "";

  /**
   * Runs before a seat is reserved (Colyseus 0.18 only calls the static
   * version). The token is the one the client put in `client.auth.token`,
   * sent as an Authorization header. What we return becomes `client.auth`.
   */
  static async onAuth(token: string | undefined, _options: unknown, _context: AuthContext): Promise<Identity> {
    // Shutting down (SIGTERM, see index.ts): no new seat anywhere. The
    // client's join fails and it offers to try again.
    if (matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN)
      throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, "The game server is restarting.");
    try {
      return await resolveIdentity(token || undefined);
    } catch (err) {
      if (err instanceof AuthRejected) throw new ServerError(AUTH_REJECTED_CODE, err.message);
      throw err;
    }
  }

  /**
   * A room class pinned to one map of its mode's pool, for
   * `createServer({ mapId })` and the smoke test. A subclass rather than a
   * room option: clients' join options are merged into the room options, so
   * an option could be spoofed.
   */
  static pinnedTo<T extends typeof GameRoom>(this: T, mapId: string): T {
    const found = this.rules.maps.find((m) => m.id === mapId);
    if (!found) throw new Error(`Unknown ${this.rules.mode} map "${mapId}" (known: ${this.rules.maps.map((m) => m.id).join(", ")})`);
    const map: MapDef = found;
    return class PinnedRoom extends (this as typeof GameRoom) {
      protected override pinnedMap: MapDef | null = map;
    } as unknown as T;
  }

  /** The same room with some rules changed (the smoke test's short time limit and countdown). */
  static withRules<T extends typeof GameRoom>(this: T, overrides: Partial<ModeRules>): T {
    const rules = { ...this.rules, ...overrides };
    return class TunedRoom extends (this as typeof GameRoom) {
      static override rules = rules;
    } as unknown as T;
  }

  /** Set by `pinnedTo`: every match of this room is on that map. */
  protected pinnedMap: MapDef | null = null;

  /** A map of this room's pool with that id, or null. Never another mode's map, never a fallback. */
  private knownMap(id: unknown): MapDef | null {
    return typeof id === "string" ? (this.rules.maps.find((m) => m.id === id) ?? null) : null;
  }

  /**
   * The dev-only `?map=<id>` join option (the client passes it as `map`),
   * among this room's own maps. Honoured only when NODE_ENV isn't
   * "production", read at join time.
   */
  private devMap(options: unknown): MapDef | null {
    if (process.env.NODE_ENV === "production") return null;
    return this.knownMap(optionsRecord(options).map);
  }

  onCreate(options?: unknown) {
    const rules = this.rules;
    this.state.mode = rules.mode;
    this.state.killsToWin = rules.killsToWin;
    this.state.timeLimit = rules.timeLimit;
    // A private room is never listed nor quick-matched, only joined by id
    // (its invite link). Only the creator's options reach onCreate, so no one
    // can make someone else's room private; join options are never read for it.
    if (optionsRecord(options).private === true) void this.setPrivate(true);
    // Map: pinned by the server, else by the dev `?map=` option of whoever
    // created the room, else random, always from this mode's pool.
    const pinned = this.pinnedMap ?? this.devMap(options);
    if (pinned) {
      this.map = pinned;
      this.fixedMap = true;
    } else {
      this.map = rules.maps[Math.floor(Math.random() * rules.maps.length)];
    }
    this.state.mapId = this.map.id;
    this.syncListing();

    this.clock.setInterval(() => this.probeLatency(), PING_INTERVAL_MS);

    // Fixed-timestep loop with an accumulator (Colyseus runs a whole number of
    // steps per interval from the measured time), so the long-run tick rate is
    // exactly TICK_RATE even if the timer fires at 34 ms instead of 33.3 ms.
    // Clients send inputs at exactly TICK_RATE too; a slower server would
    // build a growing input backlog, i.e. ever-increasing input latency.
    this.setFixedTimestep(() => this.tick(), TICK_RATE);

    // We broadcast one patch per simulation tick ourselves (end of `tick`),
    // so every snapshot the client gets corresponds to exactly one tick.
    // Order matters: disabling patches BEFORE the loop exists makes Colyseus
    // start its own clock-ticking interval, which steals the measured time
    // from the fixed-step accumulator (we measured 14 ticks/s instead of 30).
    this.patchRate = null;
  }

  // --- Seats -----------------------------------------------------------------------

  /** Seats taken, dropped players included. */
  get seats(): number {
    return this.state.players.size;
  }

  /** Seats whose player is connected right now. */
  private connectedSeats(): number {
    let n = 0;
    this.state.players.forEach((p) => (n += p.connected ? 1 : 0));
    return n;
  }

  /**
   * Seats taken plus seats promised: reservations made by the matchmaker for
   * clients that haven't joined yet. A held reconnection is already a seat
   * (its player is still in `state.players`), so it is not counted twice.
   */
  private claimedSeats(): number {
    const reserved = (this as unknown as { _reservedSeats: Record<string, [unknown, ...unknown[]]> })._reservedSeats;
    let pending = 0;
    for (const id of Object.keys(reserved)) if (!this.state.players.has(id) && wantsSeat(reserved[id]?.[0])) pending++;
    return this.seats + pending;
  }

  /**
   * The seat lock. Colyseus asks this before reserving a seat and locks the
   * room (no quick match, no join by id: "This game is full") while it is
   * true, then unlocks when a client leaves. Counting player seats here,
   * rather than setting `maxClients` to the player cap, keeps the rest of
   * `maxClients` free for spectators; two joins racing for the last seat are
   * settled here too (the second gets a new room from quick match).
   *
   * For spectators later: a spectator must get past this lock (it also
   * blocks joinById on a locked room), so its join needs its own entry, e.g.
   * a seat reserved by a room method that skips the seat count.
   */
  override hasReachedMaxClients(): boolean {
    return super.hasReachedMaxClients() || this.claimedSeats() >= this.rules.maxPlayers;
  }

  /** The lowest seat number nobody holds. */
  private freeSlot(): number {
    const taken = new Set<number>();
    this.state.players.forEach((p) => taken.add(p.slot));
    let slot = 0;
    while (taken.has(slot)) slot++;
    return slot;
  }

  onJoin(client: Client, options?: unknown) {
    if (!wantsSeat(options)) return; // Spectators, later: no Player, no internals.
    // The seat lock settles races, so this only trips on a bug; refuse
    // rather than seat a 7th player.
    if (this.seats >= this.rules.maxPlayers)
      throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${this.roomId}" is full`);

    // A dev `?map=` from a later player pins the room too, unless a match is
    // running (a duel can't be mid-match here: the room holds two). A
    // server-pinned map wins.
    const asked = this.devMap(options);
    if (asked && !this.pinnedMap && this.state.phase !== "playing") {
      this.fixedMap = true;
      if (asked.id !== this.map.id) this.switchMap(asked);
    }

    const names = new Set<string>();
    this.state.players.forEach((p) => names.add(p.name));
    const slot = this.freeSlot();
    const identity: Identity = (client.auth as Identity | undefined) ?? { kind: "guest", name: guestName() };
    const hasUsername = identity.kind === "account" && !!identity.username;
    // A guest keeps the guest name the client shows on its menu, if it is one
    // (`Guest-` and four digits: nobody can pick a real-looking name this way).
    let name = hasUsername ? identity.name : (requestedGuestName(options) ?? identity.name);
    // Two guests could draw the same number.
    if (names.has(name) && !hasUsername) name = guestName(names);

    const player = new Player();
    player.slot = slot;
    player.name = name;
    player.account = hasUsername;
    if (this.rules.mode === "duel") {
      const spawn = duelSpawn(this.map, slot);
      writeSim(player, spawnSim(spawn.x, spawn.z, player.weapon));
      // Face the centre of the map.
      player.aim = Math.atan2(-spawn.z, -spawn.x);
    } else {
      // FFA: out of everyone's sight, whatever the phase (a drop-in mid-match
      // lands here too), facing the hub.
      const spawn = ffaRespawnPoint(this.map, this.map.spawns, this.livingPositions(null));
      writeSim(player, spawnSim(spawn.x, spawn.z, player.weapon));
      player.aim = this.hubAim(spawn);
    }
    this.state.players.set(client.sessionId, player);
    this.internals.set(client.sessionId, { queue: [], tokens: INPUT_BURST, identity, deaths: 0, ping: null, baselined: false });
    this.joinOrder.push(client.sessionId);

    this.maybeStart();
    this.syncListing();
  }

  /**
   * The connection dropped without a leave (network loss, tab reload, a
   * closed laptop). The seat is held for `reconnectGrace` seconds: the
   * character stays where it is, takes no input (the queue is dropped, and
   * inputs are refused while `connected` is false) and can still be shot.
   * The SDK retries on its own; `onReconnect` or, after the grace period,
   * `onLeave` follows.
   *
   * No seat is held when the server itself closed the connection: a flood
   * or protocol error (4002), or a shutdown (4001, the room is going away).
   */
  onDrop(client: Client, code: number) {
    if (code === CloseCode.WITH_ERROR || code === CloseCode.SERVER_SHUTDOWN) return;
    const player = this.state.players.get(client.sessionId);
    const internal = this.internals.get(client.sessionId);
    if (!player || !internal) return;
    player.connected = false;
    internal.queue.length = 0;
    internal.ping = null;
    // Not awaited: the outcome comes back as onReconnect or onLeave. It
    // rejects at once when the room is disposing; onLeave follows then too.
    this.allowReconnection(client, this.reconnectGrace).catch(() => {});
  }

  /** Back within the grace period: same session id, same seat, score and weapon. */
  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const internal = this.internals.get(client.sessionId);
    if (!player || !internal) return;
    player.connected = true;
    internal.queue.length = 0;
    internal.tokens = INPUT_BURST;
    internal.ping = null;
    // Someone took the other seat while this player was away.
    this.maybeStart();
  }

  /** Enough players, connected enough, for a match to start. */
  private ready(): boolean {
    const r = this.rules;
    if (this.seats < r.minPlayers) return false;
    return r.startNeedsAll ? this.connectedSeats() === this.seats : this.connectedSeats() >= r.minPlayers;
  }

  /** While waiting: start now if the mode has no countdown (the countdown itself runs in `tick`). */
  private maybeStart() {
    if (this.state.phase === "waiting" && this.rules.countdown === 0 && this.ready()) this.startMatch();
  }

  /**
   * Room errors (a throwing tick, message handler or timer) are logged here
   * instead of reaching the process: without this hook, Colyseus' uncaught
   * exception handler shuts the whole server down.
   */
  onUncaughtException(err: RoomException, methodName: RoomMethodName) {
    console.error(`[room ${this.roomId}] ${methodName} failed:`, err.cause ?? err);
  }

  /** Gone for good: a Leave, the grace period running out, or a shutdown. Frees the seat. */
  onLeave(client: Client) {
    const id = client.sessionId;
    if (!this.state.players.has(id)) return; // No seat (a refused join, later a spectator).
    this.state.players.delete(id);
    this.internals.delete(id);
    this.joinOrder = this.joinOrder.filter((s) => s !== id);

    if (this.rules.mode === "duel") {
      this.clearProjectiles();
      this.setPhase("waiting");
      this.state.winner = "";
      // The remaining player keeps playing alone, with a clean slate.
      this.resetScoreboard();
      this.state.startTick = 0;
      this.state.endTick = 0;
      this.state.players.forEach((p) => {
        p.hp = MAX_HP;
        p.alive = true;
        p.respawnTicks = 0;
      });
      return;
    }

    // FFA: the others play on. The leaver's bullets go (a newcomer may reuse
    // the slot, and so the bullet ids); their grenades still go off.
    this.state.bullets.forEach((b, bid) => {
      if (b.owner !== id) return;
      this.state.bullets.delete(bid);
      this.bulletInternals.delete(bid);
    });
    if (this.state.phase === "playing") {
      if (this.seats < this.rules.minToContinue) this.endMatch();
      else if (this.state.suddenDeath && this.soleLeader()) this.endMatch();
    }
    this.syncListing();
  }

  private probeLatency() {
    for (const client of this.clients) {
      const internal = this.internals.get(client.sessionId);
      if (!internal) continue;
      internal.ping = { n: ++pingCounter, at: performance.now() };
      client.send(MSG_PING, { n: internal.ping.n });
    }
  }

  /** Clears everyone's scoreboard counters (match start, or back to waiting). */
  private resetScoreboard() {
    this.state.players.forEach((p) => {
      p.kills = 0;
      p.deaths = 0;
      p.shots = 0;
      p.hits = 0;
      p.damage = 0;
    });
  }

  private setPhase(phase: Phase) {
    this.state.phase = phase;
    if (phase !== "waiting") this.state.countdown = 0;
    this.syncListing();
  }

  /**
   * Keeps the matchmaking metadata (mode, host, map, phase, seats) in step
   * with the room, for the menu's open games list. Written only when it
   * changed.
   */
  private syncListing() {
    const host = this.joinOrder.length > 0 ? this.state.players.get(this.joinOrder[0]) : undefined;
    const meta: RoomMeta = {
      mode: this.rules.mode,
      hostName: host?.name ?? "",
      mapId: this.map.id,
      phase: this.state.phase as Phase,
      players: this.seats,
      maxPlayers: this.rules.maxPlayers,
      createdAt: this.createdAt,
    };
    const key = JSON.stringify(meta);
    if (key === this.metaKey) return;
    this.metaKey = key;
    this.setMetadata(meta).catch((err) => console.warn("[room] metadata update failed", err));
  }

  /**
   * The map for the match about to start: the pinned one, or the current one
   * for a room's first match (the waiting players are already on it), or a
   * random other one of this mode's pool after that.
   */
  private pickMap() {
    const pool = this.rules.maps;
    if (!this.fixedMap && this.mapPlayed && pool.length > 1) {
      const others = pool.filter((m) => m.id !== this.map.id);
      this.switchMap(others[Math.floor(Math.random() * others.length)]);
    }
    this.mapPlayed = true;
  }

  /**
   * Changes the map. Only called between matches or while waiting, and always
   * together with putting the players on the new spawns (startMatch does it
   * right after, and it is done here for players waiting), before the tick's
   * patch goes out: clients get the new mapId and the new positions in the
   * same snapshot.
   */
  private switchMap(map: MapDef) {
    this.map = map;
    this.state.mapId = map.id;
    this.syncListing();
    this.clearProjectiles();
    const starts = this.rules.mode === "duel" ? null : ffaStartSpawns(map, map.spawns, this.seats);
    let i = 0;
    this.state.players.forEach((p) => {
      const spawn = starts ? starts[i++ % starts.length] : duelSpawn(map, p.slot);
      writeSim(p, spawnSim(spawn.x, spawn.z, p.weapon, readSim(p)));
    });
  }

  private startMatch() {
    this.pickMap();
    this.clearProjectiles();
    this.state.winner = "";
    this.state.suddenDeath = false;
    this.state.feed.clear();
    this.matchId = `${this.roomId}:${crypto.randomUUID()}`;
    this.internals.forEach((i) => (i.deaths = 0));
    this.resetScoreboard();
    if (this.rules.mode === "duel") {
      this.state.players.forEach((p) => {
        const spawn = duelSpawn(this.map, p.slot);
        this.spawnAt(p, spawn.x, spawn.z);
      });
    } else {
      // Spread out, each out of the others' sight, in a random order, facing the hub.
      const ids = [...this.state.players.keys()].sort(() => Math.random() - 0.5);
      const starts = ffaStartSpawns(this.map, this.map.spawns, ids.length);
      ids.forEach((id, i) => {
        const p = this.state.players.get(id)!;
        const spawn = starts[i % starts.length];
        this.spawnAt(p, spawn.x, spawn.z);
        p.aim = this.hubAim(spawn);
      });
    }
    this.state.startTick = this.state.tick;
    this.state.endTick = 0;
    this.setPhase("playing");
  }

  /** Aim from a spawn toward the FFA map's hub (the centre on other maps). */
  private hubAim(s: Spawn): number {
    const hub = (this.map as Partial<FfaMapDef>).hub ?? { x: 0, z: 0 };
    return Math.atan2(hub.z - s.z, hub.x - s.x);
  }

  /** Puts a player back in the game: picked weapon in hand, fresh HP, ammo and cooldowns. */
  private spawnAt(p: Player, x: number, z: number) {
    p.weapon = p.pick;
    writeSim(p, spawnSim(x, z, p.weapon, readSim(p)));
    p.hp = MAX_HP;
    p.alive = true;
    p.respawnTicks = 0;
    p.shieldTicks = 0;
    p.shieldHp = 0;
  }

  private clearProjectiles() {
    this.state.bullets.clear();
    this.bulletInternals.clear();
    this.state.grenades.clear();
    this.grenadeInternals.clear();
  }

  private tick() {
    this.state.tick++;

    // 1. Apply queued inputs. One input == one fixed step of TICK_DT, exactly
    //    like the client's prediction. The token budget allows catching up a
    //    few inputs after jitter but caps the average at one per tick, which is
    //    also what makes the tick-counted cooldowns (fire interval, dash, ...)
    //    impossible to beat by sending inputs faster.
    this.state.players.forEach((player, id) => {
      const internal = this.internals.get(id);
      if (!internal) return;
      internal.tokens = Math.min(INPUT_BURST, internal.tokens + 1);
      while (internal.tokens >= 1 && internal.queue.length > 0) {
        const input = internal.queue.shift()!;
        internal.tokens -= 1;
        this.applyInput(id, player, input);
      }
    });

    // 2. Move bullets and grenades, resolve hits and blasts.
    this.stepBullets();
    this.stepGrenades();

    // 3. Timers: shields, respawns and match reset.
    this.state.players.forEach((player, id) => {
      if (player.shieldTicks > 0) {
        player.shieldTicks--;
        if (player.shieldTicks === 0) player.shieldHp = 0;
      }
      if (player.alive) return;
      player.respawnTicks--;
      if (player.respawnTicks <= 0) this.respawn(id, player);
    });

    // 4. The match clock: countdown before, time limit during, rematch after.
    if (this.state.phase === "waiting") this.stepCountdown();
    else if (this.state.phase === "playing") this.stepTimeLimit();
    else if (this.state.phase === "ended") {
      // After the result delay: the rematch, or back to waiting if too few
      // are left. In a duel, a player who dropped holds the result card up
      // until they are back (or their grace period ends and onLeave sends the
      // room back to waiting): a match never starts against an empty seat.
      if (this.matchResetTicks > 0) this.matchResetTicks--;
      if (this.matchResetTicks <= 0) {
        if (this.seats < this.rules.minPlayers) this.setPhase("waiting");
        else if (this.ready()) this.startMatch();
        else if (!this.rules.startNeedsAll) this.setPhase("waiting");
      }
    }

    this.broadcastPatch();
  }

  /** Pre-match countdown (FFA): runs while enough players are connected, cancelled when they aren't. */
  private stepCountdown() {
    if (this.rules.countdown === 0) return;
    if (!this.ready()) {
      this.state.countdown = 0;
      return;
    }
    if (this.state.countdown === 0) {
      this.state.countdown = ticks(this.rules.countdown);
      return;
    }
    this.state.countdown--;
    if (this.state.countdown === 0) this.startMatch();
  }

  /** Time limit: the most kills wins; a tie goes to sudden death (see FFA_SUDDEN_DEATH_MAX). */
  private stepTimeLimit() {
    const limit = this.rules.timeLimit;
    if (limit <= 0) return;
    const elapsed = this.state.tick - this.state.startTick;
    if (this.state.suddenDeath) {
      if (elapsed >= ticks(limit + FFA_SUDDEN_DEATH_MAX)) this.endMatch();
      return;
    }
    if (elapsed < ticks(limit)) return;
    if (this.soleLeader()) this.endMatch();
    else this.state.suddenDeath = true;
  }

  /** The one player with the most kills, or null on a tie. */
  private soleLeader(): string | null {
    let best = -1;
    let who: string | null = null;
    this.state.players.forEach((p, id) => {
      if (p.kills > best) {
        best = p.kills;
        who = id;
      } else if (p.kills === best) who = null;
    });
    return who;
  }

  private applyInput(id: string, player: Player, input: InputMessage) {
    // Always acknowledge, even when the input has no effect (dead, match
    // over): the client needs the ack to drop it from its replay buffer.
    player.lastSeq = input.seq;
    // A fresh seat: the client's press counters are running totals from
    // before this game (same tab, earlier games), so its first input's
    // counters are the baseline, not presses. Only a later increase fires.
    const internal = this.internals.get(id);
    if (internal && !internal.baselined) {
      internal.baselined = true;
      player.dashSeen = Math.max(player.dashSeen, input.dash);
      player.grenadeSeen = Math.max(player.grenadeSeen, input.grenade);
      player.shieldSeen = Math.max(player.shieldSeen, input.shield);
      player.reloadSeen = Math.max(player.reloadSeen, input.reload);
    }
    const canAct = player.alive && this.state.phase !== "ended";
    // The same function the client predicts with. It enforces the fire
    // interval, magazine, reload and ability cooldowns.
    const res = stepPlayer(this.map, readSim(player), input, player.weapon, canAct);
    writeSim(player, res.sim);
    if (!canAct) return;
    player.aim = input.aim;

    if (res.fired) this.spawnShot(id, player, input);
    if (res.grenade) this.spawnGrenade(id, player, res.grenade);
    if (res.shield) {
      player.shieldTicks = SHIELD_TICKS;
      player.shieldHp = SHIELD.absorb;
    }
  }

  private spawnShot(owner: string, player: Player, input: InputMessage) {
    const w = weaponDef(player.weapon);
    const pellets = shotPellets(player.weapon, player.x, player.z, input.aim, input.seq);
    // Scoreboard: every bullet fired in a match, pellets included.
    if (this.state.phase === "playing") player.shots = Math.min(0xffff, player.shots + pellets.length);
    pellets.forEach((b, i) => {
      const id = bulletId(player.slot, input.seq, i);
      const bullet = new Bullet();
      bullet.x = b.x;
      bullet.z = b.z;
      bullet.owner = owner;
      this.state.bullets.set(id, bullet);
      this.bulletInternals.set(id, { vx: b.vx, vz: b.vz, ticksLeft: bulletLifeTicks(w), damage: w.damage, weapon: player.weapon });
    });
  }

  private spawnGrenade(owner: string, player: Player, target: Vec2) {
    const id = String(this.nextGrenadeId++);
    const g = new Grenade();
    const start = grenadeArc(player.x, player.z, target.x, target.z, 0);
    g.x = start.x;
    g.y = start.y;
    g.z = start.z;
    g.tx = target.x;
    g.tz = target.z;
    g.owner = owner;
    this.state.grenades.set(id, g);
    const dist = Math.hypot(target.x - player.x, target.z - player.z);
    this.grenadeInternals.set(id, {
      ox: player.x,
      oz: player.z,
      flightTicks: grenadeFlightTicks(dist),
      age: 0,
      fuseLeft: GRENADE_FUSE_TICKS,
    });
  }

  private stepBullets() {
    const dead: string[] = [];
    this.state.bullets.forEach((bullet, id) => {
      const internal = this.bulletInternals.get(id);
      if (!internal) {
        dead.push(id);
        return;
      }
      const sim = { x: bullet.x, z: bullet.z, vx: internal.vx, vz: internal.vz };
      const alive = stepBullet(this.map, sim, (bx, bz) => {
        let hit = false;
        this.state.players.forEach((target, targetId) => {
          if (hit || targetId === bullet.owner || !target.alive) return;
          if (circlesOverlap(bx, bz, BULLET_RADIUS, target.x, target.z, PLAYER_RADIUS)) {
            hit = true;
            const shooter = this.state.players.get(bullet.owner);
            if (shooter && this.state.phase === "playing") shooter.hits = Math.min(0xffff, shooter.hits + 1);
            this.damage(bullet.owner, targetId, target, internal.damage, internal.weapon);
          }
        });
        return hit;
      });
      bullet.x = sim.x;
      bullet.z = sim.z;
      internal.ticksLeft--;
      if (!alive || internal.ticksLeft <= 0) dead.push(id);
    });
    for (const id of dead) {
      this.state.bullets.delete(id);
      this.bulletInternals.delete(id);
    }
  }

  private stepGrenades() {
    const dead: string[] = [];
    const blasts: { owner: string; x: number; z: number }[] = [];
    this.state.grenades.forEach((g, id) => {
      const internal = this.grenadeInternals.get(id);
      // An exploded grenade stays for exactly one snapshot so clients see the blast.
      if (!internal || g.exploded) {
        dead.push(id);
        return;
      }
      if (!g.landed) {
        internal.age++;
        const t = Math.min(1, internal.age / internal.flightTicks);
        const p = grenadeArc(internal.ox, internal.oz, g.tx, g.tz, t);
        g.x = p.x;
        g.y = p.y;
        g.z = p.z;
        if (t >= 1) g.landed = true;
        return;
      }
      internal.fuseLeft--;
      if (internal.fuseLeft <= 0) {
        g.exploded = true;
        blasts.push({ owner: g.owner, x: g.tx, z: g.tz });
      }
    });
    for (const id of dead) {
      this.state.grenades.delete(id);
      this.grenadeInternals.delete(id);
    }
    for (const b of blasts) this.explode(b.owner, b.x, b.z);
  }

  private explode(owner: string, x: number, z: number) {
    // Collect first: a kill can end the match and clear the state mid-loop.
    const hits: { id: string; p: Player; dmg: number }[] = [];
    this.state.players.forEach((p, id) => {
      if (!p.alive) return;
      const edge = Math.hypot(p.x - x, p.z - z) - PLAYER_RADIUS;
      const dmg = grenadeDamage(edge, id === owner);
      if (dmg !== null && dmg > 0) hits.push({ id, p, dmg });
    });
    for (const h of hits) {
      if (this.state.phase === "ended") break;
      this.damage(owner, h.id, h.p, h.dmg, KILL_GRENADE);
    }
  }

  /**
   * Shield first, then HP. The kill goes to whoever dealt the killing blow;
   * a self-kill (your own grenade) credits no one and counts as a death, with
   * no kill taken away.
   */
  private damage(attackerId: string, targetId: string, target: Player, amount: number, weapon = 0) {
    if (!target.alive) return;
    // Scoreboard: what actually came off the opponent (shield, then HP down to 0).
    const dealt = Math.min(amount, target.shieldHp + target.hp);
    const attacker = attackerId === targetId ? undefined : this.state.players.get(attackerId);
    if (attacker && this.state.phase === "playing") attacker.damage = Math.min(0xffff, attacker.damage + dealt);
    let left = amount;
    if (target.shieldHp > 0) {
      const absorbed = Math.min(target.shieldHp, left);
      target.shieldHp -= absorbed;
      left -= absorbed;
      if (target.shieldHp === 0) target.shieldTicks = 0;
    }
    if (left <= 0) return;
    target.hp = Math.max(0, target.hp - left);
    if (target.hp > 0) return;

    target.alive = false;
    target.respawnTicks = ticks(this.rules.respawnDelay);
    target.shieldTicks = 0;
    target.shieldHp = 0;
    // Waiting mode (alone in the room) still lets you shoot, but kills only
    // count during a real match.
    if (this.state.phase !== "playing") return;
    const targetInternal = this.internals.get(targetId);
    if (targetInternal) targetInternal.deaths++;
    target.deaths = Math.min(0xff, target.deaths + 1);
    const shooter = attackerId === targetId ? undefined : this.state.players.get(attackerId);
    this.addToFeed(shooter ? attackerId : "", shooter, targetId, target, weapon);
    if (!shooter) return;

    shooter.kills = Math.min(0xff, shooter.kills + 1);
    if (shooter.kills >= this.rules.killsToWin) this.endMatch(attackerId);
    else if (this.state.suddenDeath && this.soleLeader()) this.endMatch();
  }

  private addToFeed(killerId: string, killer: Player | undefined, victimId: string, victim: Player, weapon: number) {
    const e = new KillEvent();
    e.n = ++this.nextKill;
    e.tick = this.state.tick;
    e.killer = killerId;
    e.killerName = killer?.name ?? "";
    e.killerSlot = killer?.slot ?? 0;
    e.victim = victimId;
    e.victimName = victim.name;
    e.victimSlot = victim.slot;
    e.weapon = weapon;
    this.state.feed.push(e);
    while (this.state.feed.length > KILL_FEED_SIZE) this.state.feed.shift();
  }

  /**
   * The match is over: first to the kill target (`winnerId`), the time limit,
   * sudden death, or too few players left. Places come from `placements`
   * (kills, then deaths); `winner` is the sole first place, "" if shared.
   */
  private endMatch(winnerId?: string) {
    const standings: { id: string; kills: number; deaths: number }[] = [];
    this.state.players.forEach((p, id) => standings.push({ id, kills: p.kills, deaths: this.internals.get(id)?.deaths ?? p.deaths }));
    const places = placements(standings);
    const firsts = places.filter((p) => p.place === 1);
    this.state.winner = winnerId ?? (firsts.length === 1 ? firsts[0].player.id : "");
    this.state.endTick = this.state.tick;
    this.setPhase("ended");
    this.matchResetTicks = ticks(this.rules.endDelay);
    this.clearProjectiles();
    this.recordStats(new Map(places.map((p) => [p.player.id, p.place])));
  }

  /**
   * Sends the finished match to Convex for the account players (guests are
   * skipped). A win is first place (a shared first counts for each); every
   * other place is a loss.
   */
  private recordStats(places: Map<string, number>) {
    const results: MatchResult[] = [];
    this.state.players.forEach((p, id) => {
      const internal = this.internals.get(id);
      if (internal?.identity.kind !== "account") return;
      const place = places.get(id) ?? places.size;
      results.push({ clerkId: internal.identity.clerkId, kills: p.kills, deaths: internal.deaths, won: place === 1, place });
    });
    // Fire and forget: the game loop never waits on Convex.
    void recordMatch(this.matchId, results, this.rules.mode);
  }

  /** Where the living players other than `except` stand. */
  private livingPositions(except: string | null): Vec2[] {
    const out: Vec2[] = [];
    this.state.players.forEach((p, id) => {
      if (id !== except && p.alive) out.push({ x: p.x, z: p.z });
    });
    return out;
  }

  /**
   * Duel: out of the opponent's sight if possible, then as far from them as
   * possible. FFA: out of every living opponent's sight (ffaRespawnPoint).
   */
  private respawn(id: string, player: Player) {
    if (this.rules.mode === "duel") {
      let opponent: Player | null = null;
      this.state.players.forEach((p, pid) => {
        if (pid !== id) opponent = p;
      });
      const spawn = respawnPoint(this.map, this.map.spawns, opponent, duelSpawn(this.map, player.slot));
      this.spawnAt(player, spawn.x, spawn.z);
      return;
    }
    const spawn = ffaRespawnPoint(this.map, this.map.spawns, this.livingPositions(id));
    this.spawnAt(player, spawn.x, spawn.z);
  }
}

/** 1v1, first to KILLS_TO_WIN, matchmaking room "duel". */
export class DuelRoom extends GameRoom {
  static override rules = DUEL_RULES;
}

/** Free for all: 3-6 players, first to FFA_KILLS_TO_WIN or the most kills after FFA_TIME_LIMIT. Room "ffa". */
export class FfaRoom extends GameRoom {
  static override rules = FFA_RULES;
}

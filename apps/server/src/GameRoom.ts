// The game room, for every mode. A duel, a free-for-all, a team deathmatch
// and a battle royale run the same simulation (inputs, bullets, grenades,
// damage); what differs is in the mode's rules (@bagarre/shared modes.ts):
// seats, win condition, map pool, countdown, spawns, respawn delay, teams.
// `DuelRoom`, `FfaRoom`, `TeamRoom` and `RoyaleRoom` at the bottom only pick
// the rules.
//
// Battle royale (rules.royale): one life, so a death during the match is a
// knock-out (`outTick`) with no respawn, and the last one standing wins
// (`checkLastStanding`, at the end of the tick, so players knocked out on the
// same tick are all out before anyone is ranked: rankRoyale). Everyone
// carries gun slots, counted grenades, healing items and shield charges (the
// kit, KitMode "slots" in the shared step, which also runs the heals), found
// in crates and on the floor (floor.ts), and the zone
// (`state.zone`, royale.ts' zoneAt) closes in and hurts whoever is outside.
// No loadout picks, no joining once the match started (`closedToJoins`),
// and a player who leaves mid-match is knocked out then: their seat stays in
// `state.players` (not connected, `gone`) until the result is over, so their
// place is shown and recorded.
//
// Teams (rules.teams): every seat gets a team (`Player.team`) when it is
// taken, the smaller one (`pickTeam`). Friendly fire is one rule,
// `canDamage` from @bagarre/shared, applied where a hit lands: a bullet flies
// through a teammate (stepBullets), a blast skips teammates and the thrower
// (explode), and `damage` refuses the rest. Kills also count for the team
// (`redScore` / `blueScore`), which is what wins. Outside a team mode every
// player is NO_TEAM, for which `canDamage` is always true and none of the
// team branches run, so a duel and an FFA play exactly as before.
//
// Seats and clients. A client is not a player: a player is a seat, which is
// an entry in `state.players` (plus its `internals`), and the seat number is
// the player's `slot` (colour, bullet ids). A seat is taken in `onJoin`, kept
// through a dropped connection (onDrop / onReconnect, RECONNECT_GRACE_S) and
// freed in `onLeave`. The player cap is enforced on seats, never through
// `maxClients`, which leaves SPECTATOR_ROOM clients of room for spectators:
// clients with no seat and no player entity (`spectators`, a set of session
// ids). A spectator joins with `spectate: true` (see `wantsSeat`), through
// the watch route (app.ts), which gets past the seat lock with a
// reservation the seat count doesn't apply to (see `admitting`). It gets the
// full state (no StateView), sends nothing that counts (every handler drops
// its messages), keeps its place through rematches and map changes, and can
// take a free seat on the same connection (MSG_TAKE_SEAT).

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
  NO_TEAM,
  TEAM_BLUE,
  TEAM_RED,
  TEAM_RULES,
  ROYALE_MIN_RECORDED,
  ROYALE_RULES,
  DEFAULT_GRENADE,
  PISTOL,
  GRENADES,
  GRENADE_FUSE_TICKS,
  HIT_HISTORY_FRAMES,
  HIT_REWIND_TICKS,
  SMOKE_TICKS,
  STUN,
  STUN_TICKS,
  blastEdge,
  flashTicks,
  healAmount,
  INPUT_BURST,
  KILL_FEED_SIZE,
  KILL_GRENADE,
  KILL_ZONE,
  MAX_HP,
  MAX_INPUT_QUEUE,
  MAX_MESSAGES_PER_SECOND,
  MSG_INPUT,
  MSG_PICK,
  MSG_PING,
  MSG_PONG,
  MSG_START,
  MSG_TAKE_SEAT,
  MSG_TEAM,
  CLOSE_NO_PLAYERS,
  SPECTATOR_IDLE_S,
  PLAYER_RADIUS,
  RECONNECT_GRACE_S,
  SHIELD,
  SHIELD_TICKS,
  SPECTATOR_ROOM,
  TICK_RATE,
  bulletId,
  bulletLifeTicks,
  canDamage,
  circlesOverlap,
  ffaRespawnPoint,
  ffaStartSpawns,
  grenadeArc,
  grenadeAffects,
  grenadeDamage,
  grenadeFlightTicks,
  mapById,
  isSkinId,
  randomSkin,
  acceptsStart,
  hostOf,
  rank,
  rankRoyale,
  NO_GUN,
  emptyKit,
  gunInHand,
  outsideZone,
  pickZone,
  startKit,
  zoneDamage,
  HEAL_STOP,
  cancelHeal,
  readSim,
  respawnPoint,
  shotPellets,
  spawnSim,
  equipSim,
  playerCan,
  stepBullet,
  stepPlayer,
  parseInput,
  parsePick,
  parsePong,
  parseStart,
  parseTakeSeat,
  parseTeam,
  sameTeam,
  teamSpawns,
  ticks,
  weaponDef,
  writeSim,
  type FfaMapDef,
  type GrenadeDef,
  type GrenadeEffect,
  type InputMessage,
  type KitMode,
  type KitSim,
  type MapDef,
  type ModeRules,
  type Phase,
  type RoomMeta,
  type Spawn,
  type Standing,
  type Vec2,
} from "@bagarre/shared";
import { guestName, recordMatch, resolveIdentity, type Identity, type MatchResult } from "./accounts.ts";
import { Floor } from "./floor.ts";
import { Bullet, GameState, Grenade, KillEvent, Player, Smoke } from "./state.ts";

/** Server-only bookkeeping per seat. Never synced. */
interface PlayerInternal {
  queue: InputMessage[];
  /** Input budget, see INPUT_BURST. */
  tokens: number;
  /** Who this is, from onAuth. */
  identity: Identity;
  /** Deaths in the current match (kills are synced on Player). */
  deaths: number;
  /**
   * Tick at which the player reached their current kill count: their latest
   * kill, or the match start with none. A tiebreak (see `rank`).
   */
  reachedAt: number;
  /** The latency probe in flight: its number and when it was sent (performance.now()). */
  ping: { n: number; at: number } | null;
  /**
   * The press counters of this seat's first input are taken as the baseline
   * (see applyInput). False from a fresh join until that input; a reconnect
   * keeps it true and resumes from the synced counters.
   */
  baselined: boolean;
  /**
   * Battle royale: left mid-match (a leave, or the grace period ran out).
   * Knocked out then, the seat kept until the result is over (`purgeGone`)
   * so the place still shows and is recorded.
   */
  gone: boolean;
}

/** Server-only bookkeeping per bullet. */
interface BulletInternal {
  vx: number;
  vz: number;
  ticksLeft: number;
  damage: number;
  weapon: number;
  /** The shooter's team when it was fired (NO_TEAM outside a team mode): it flies through that team. */
  team: number;
}

/** Where a player stood at the end of one tick's movement (see `history`). */
interface PastPose {
  x: number;
  z: number;
  alive: boolean;
}

/** One tick of player poses, by session id. */
interface HistoryFrame {
  tick: number;
  poses: Map<string, PastPose>;
}

/** A grenade going off this tick: where, whose, and its type (a GRENADES index). */
interface Blast {
  owner: string;
  x: number;
  z: number;
  /** The thrower's team at the throw. */
  team: number;
  kind: number;
}

/** Server-only bookkeeping per grenade. */
interface GrenadeInternal {
  ox: number;
  oz: number;
  flightTicks: number;
  age: number;
  fuseLeft: number;
  /** The thrower's team when it was thrown: its blast spares that team (and the thrower, with teams). */
  team: number;
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
 * Whether this join takes a player seat: every join but a `spectate: true`
 * one, which onJoin registers with no Player.
 */
function wantsSeat(options: unknown): boolean {
  return optionsRecord(options).spectate !== true;
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
  /** Seconds a room with spectators and no player stays open. Shortened by the smoke test like `reconnectGrace`. */
  protected spectatorIdle = SPECTATOR_IDLE_S;

  /**
   * Every client message. Each payload goes through its parser from
   * @bagarre/shared first: anything malformed is dropped, never coerced.
   * Handlers read the sender from `client`, never from the payload, and do
   * nothing for a client without a seat.
   */
  messages = {
    [MSG_INPUT]: (client: Client, raw: unknown) => {
      // Spectators first, before any parsing: dropped, never an error.
      if (this.spectators.has(client.sessionId)) return;
      const input = parseInput(raw);
      const internal = this.internals.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!input || !internal || !player?.connected) return;
      if (input.seq <= player.lastSeq || internal.queue.length >= MAX_INPUT_QUEUE) return;
      internal.queue.push(input);
    },

    // Loadout pick (weapon, grenade type, or both): only valid ids, only
    // while dead, between matches or during warmup. Stored as `pick` /
    // `grenadePick` and put in hand on the next (re)spawn (spawnAt); during
    // warmup, a living player gets it in hand at once (equip).
    [MSG_PICK]: (client: Client, raw: unknown) => {
      if (this.spectators.has(client.sessionId)) return;
      const pick = parsePick(raw);
      const player = this.state.players.get(client.sessionId);
      if (!pick || !player) return;
      // Battle royale: no loadout, ever (everyone starts with the Pistol).
      if (this.rules.royale) return;
      if (player.alive && this.state.phase === "playing") return;
      if (pick.weapon !== undefined) player.pick = pick.weapon;
      if (pick.grenade !== undefined) player.grenadePick = pick.grenade;
      if (player.alive && this.state.phase === "warmup") this.equip(player);
    },

    // Latency: one probe per client every PING_INTERVAL_MS; the answer's
    // round trip becomes the player's synced `ping`. Only the probe in flight
    // is accepted, so a client can't make its ping up.
    [MSG_PONG]: (client: Client, raw: unknown) => {
      if (this.spectators.has(client.sessionId)) return;
      const pong = parsePong(raw);
      const internal = this.internals.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!pong || !internal?.ping || !player || pong.n !== internal.ping.n) return;
      // At least 1 ms, so 0 keeps meaning "not measured yet".
      player.ping = Math.min(9999, Math.max(1, Math.round(performance.now() - internal.ping.at)));
      internal.ping = null;
    },

    // Team deathmatch, while waiting: move to the other team if that keeps
    // the teams balanced (see switchTeam).
    [MSG_TEAM]: (client: Client, raw: unknown) => {
      if (this.spectators.has(client.sessionId)) return;
      const msg = parseTeam(raw);
      if (msg) this.switchTeam(client.sessionId, msg.team);
    },

    // A spectator takes a free seat, on the same connection (see takeSeat).
    [MSG_TAKE_SEAT]: (client: Client, raw: unknown) => {
      if (!parseTakeSeat(raw)) return;
      this.takeSeat(client);
    },

    // Battle royale: the host starts the match (see startRequested).
    [MSG_START]: (client: Client, raw: unknown) => {
      if (this.spectators.has(client.sessionId) || !parseStart(raw)) return;
      this.startRequested(client.sessionId);
    },

    // Any other type is dropped. Without this fallback Colyseus closes the
    // sender's connection in production (and answers with an error in dev).
    "*": () => {},
  };

  private internals = new Map<string, PlayerInternal>();
  /**
   * Clients with no seat, by session id, with their join options (the guest
   * name, used if they take a seat). Never in `state.players`.
   */
  private spectators = new Map<string, unknown>();
  /** Seconds the room has had spectators and no player (see `spectatorIdle`). */
  private emptyFor = 0;
  /**
   * True while Colyseus reserves a spectator's place: the seat count is left
   * out of `hasReachedMaxClients` for that one call (see the constructor).
   */
  private admitting = false;
  private bulletInternals = new Map<string, BulletInternal>();
  private grenadeInternals = new Map<string, GrenadeInternal>();
  /**
   * The last HIT_HISTORY_FRAMES ticks of player poses, a ring indexed by
   * `tick % HIT_HISTORY_FRAMES`. Bullets test their hits against the frame
   * HIT_REWIND_TICKS old: the poses the shooter saw (see stepBullets).
   */
  private history: (HistoryFrame | undefined)[] = [];
  private nextGrenadeId = 0;
  private nextKill = 0;
  private matchResetTicks = 0;
  /** Unique per match, so a retried stats write is applied once. Also the seed of the tiebreak lot. */
  private matchId = "";
  /**
   * Teams: each team's damage dealt this match (red, blue), counted as it is
   * dealt so a leaver's damage still counts for the team, and the tick of
   * each team's latest kill (the match start with none). Tiebreaks, see
   * endTeamMatch.
   */
  private teamDamage: [number, number] = [0, 0];
  private teamReachedAt: [number, number] = [0, 0];
  /** The map being played; `state.mapId` mirrors it. Only changes between matches (see `pickMap`). */
  private map: MapDef = this.rules.maps[0] ?? mapById(DEFAULT_MAP_ID);
  /** Pinned (`pinnedTo`) or forced by the dev `?map=` option: every match stays on `map`. */
  private fixedMap = false;
  /** A match has been started on `map`, so the next one moves to another map. */
  private mapPlayed = false;
  private createdAt = Date.now();
  /**
   * Session ids of the seated players in join order (spectators never are):
   * the first one still seated is the host (`hostOf`, synced as
   * `state.host`), shown in the open games list and, in a battle royale,
   * the one who starts the match.
   */
  private joinOrder: string[] = [];
  /** Last metadata written, to skip no-op writes. */
  private metaKey = "";
  /** Battle royale: the crates and the items on the floor. */
  private floor = new Floor(this.state, () => this.map);
  /** Battle royale: players in the match when it started (below ROYALE_MIN_RECORDED it isn't recorded). */
  private royaleStarters = 0;
  /** Battle royale: someone was knocked out this tick; see who is left at its end (checkLastStanding). */
  private knockedOut = false;

  /** How the players of this mode carry their guns and grenades (the shared step's KitMode). */
  protected get kitMode(): KitMode {
    return this.rules.royale ? "slots" : "loadout";
  }

  /** What a fresh player carries: the royale's Pistol kit, or nothing in the other modes. */
  private freshKit(): KitSim {
    return this.rules.royale ? startKit() : emptyKit();
  }

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
    // A bad or expired token joins as a guest (see accounts.ts).
    return await resolveIdentity(token || undefined);
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

  constructor() {
    super();
    // Colyseus reserves every place through `_reserveSeat(sessionId, options,
    // ...)`, which asks `hasReachedMaxClients()` first, synchronously. The
    // seat count must not refuse a spectator (their route is the only way
    // into a full room), so it is left out while a spectator's options go
    // through. `_reserveSeat` is private in the typings, hence the cast; it
    // is looked up on the instance (MatchMaker.remoteRoomCall), so an own
    // property wraps it.
    const self = this as unknown as { _reserveSeat: (id: string, options: unknown, ...rest: unknown[]) => Promise<boolean> };
    const reserve = self._reserveSeat.bind(this);
    self._reserveSeat = (id, options, ...rest) => {
      this.admitting = !wantsSeat(options);
      try {
        return reserve(id, options, ...rest);
      } finally {
        this.admitting = false;
      }
    };
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
    this.clock.setInterval(() => this.everySecond(), 1000);

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
   * clients that haven't joined yet. A held reconnection (the entry's 4th
   * field) is never a new seat: a player's is already in `state.players`, a
   * spectator's holds none, and one whose grace just ran out is on its way
   * out (onLeave).
   */
  private claimedSeats(): number {
    const reserved = (this as unknown as { _reservedSeats: Record<string, [unknown, unknown, unknown, unknown]> })._reservedSeats;
    let pending = 0;
    for (const id of Object.keys(reserved)) {
      const [options, , , reconnection] = reserved[id] ?? [];
      if (!reconnection && !this.state.players.has(id) && wantsSeat(options)) pending++;
    }
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
   * A spectator's reservation skips the seat count (`admitting`): it only
   * needs a client slot. The lock itself is kept explicit (see
   * `updateSeatLock`), so a spectator leaving never unlocks a full room.
   */
  override hasReachedMaxClients(): boolean {
    return super.hasReachedMaxClients() || (!this.admitting && (this.claimedSeats() >= this.rules.maxPlayers || this.closedToJoins()));
  }

  /**
   * No new player may take a seat right now: a mode without drop-in (a duel,
   * a battle royale) once its match started, until its result is up.
   * Spectators still get in. (A duel is full then anyway.)
   */
  private closedToJoins(): boolean {
    return !this.rules.dropIn && (this.state.phase === "warmup" || this.state.phase === "playing");
  }

  /**
   * Locks the room by hand while every seat is taken, and unlocks it when
   * one frees (and none is promised to a join in flight). By hand, because
   * Colyseus' own lock is lifted by any client leaving, a spectator
   * included, which would let quick match land in a full room.
   */
  private updateSeatLock() {
    if (this.seats >= this.rules.maxPlayers || this.closedToJoins()) void this.lock();
    else if (this.claimedSeats() < this.rules.maxPlayers && this.locked) void this.unlock();
  }

  /** Once a second: the seat lock (a promised seat may have expired) and the spectators-only timeout. */
  private everySecond() {
    this.updateSeatLock();
    if (this.state.players.size > 0 || this.spectators.size === 0) {
      this.emptyFor = 0;
      return;
    }
    if (++this.emptyFor >= this.spectatorIdle) void this.disconnect(CLOSE_NO_PLAYERS);
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
    // The seat lock settles races, so a player arriving with every seat taken
    // is a lost race: they watch rather than be thrown out (their client sees
    // it isn't in `state.players`).
    if (!wantsSeat(options) || this.seats >= this.rules.maxPlayers || this.closedToJoins()) {
      this.addSpectator(client, options);
      return;
    }
    this.seat(client, options);
    this.maybeStart();
    this.syncListing();
    this.updateSeatLock();
  }

  private addSpectator(client: Client, options: unknown) {
    this.spectators.set(client.sessionId, options);
    this.state.spectators = Math.min(255, this.spectators.size);
    this.syncListing();
  }

  /**
   * MSG_TAKE_SEAT: a spectator takes a free seat, through the same code as a
   * player's join. Refused (silently) for a player, when no seat is free (a
   * join in flight counts), or mid-match in a mode without drop-in. The
   * client keeps its Room; its role flips when `state.players` gains it.
   */
  private takeSeat(client: Client) {
    const id = client.sessionId;
    if (!this.spectators.has(id) || this.claimedSeats() >= this.rules.maxPlayers) return;
    if (!this.rules.dropIn && this.state.phase !== "waiting" && !(this.rules.royale && this.state.phase === "ended")) return;
    const options = this.spectators.get(id);
    this.spectators.delete(id);
    this.state.spectators = Math.min(255, this.spectators.size);
    // A dev `?map=` is only read at the first join.
    this.seat(client, { guestName: optionsRecord(options).guestName });
    this.maybeStart();
    this.syncListing();
    this.updateSeatLock();
  }

  /** Gives this client a seat: a Player on a spawn, and its internals. The caller checked that one is free. */
  private seat(client: Client, options: unknown) {
    // A dev `?map=` from a later player pins the room too, unless a match is
    // running (a duel can't be mid-match here: the room holds two). A
    // server-pinned map wins.
    const asked = this.devMap(options);
    if (asked && !this.pinnedMap && (this.state.phase === "waiting" || this.state.phase === "ended")) {
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
    player.skin = this.skinFor(identity);
    // Battle royale: the Pistol, already while waiting.
    if (this.rules.royale) player.weapon = PISTOL;
    if (this.rules.mode === "duel") {
      const spawn = duelSpawn(this.map, slot);
      writeSim(player, spawnSim(spawn.x, spawn.z, player.weapon));
      // Face the centre of the map.
      player.aim = Math.atan2(-spawn.z, -spawn.x);
    } else {
      // Teams: the smaller team (see pickTeam), before the spawn is picked.
      if (this.rules.teams) player.team = this.pickTeam();
      // FFA: out of everyone's sight, whatever the phase (a drop-in mid-match
      // lands here too), facing the hub. Teams: on the team's own side, out
      // of every enemy's sight.
      const spawn = ffaRespawnPoint(this.map, this.spawnsOf(player.team), this.livingEnemies(null, player.team));
      writeSim(player, spawnSim(spawn.x, spawn.z, player.weapon, undefined, this.freshKit()));
      player.aim = this.hubAim(spawn);
    }
    this.state.players.set(client.sessionId, player);
    // A drop-in reached its 0 kills at the match start, like everyone else.
    const reachedAt = this.state.startTick;
    this.internals.set(client.sessionId, { queue: [], tokens: INPUT_BURST, identity, deaths: 0, reachedAt, ping: null, baselined: false, gone: false });
    this.joinOrder.push(client.sessionId);
  }

  /**
   * The skin a new seat wears: a signed-in player's saved one (read from the
   * database by onAuth, even without a username), else a random one, among
   * those nobody in the room wears when one is left. Rolled once per seat:
   * a reconnect keeps the Player, so the skin too. Never read from the join
   * options.
   */
  private skinFor(identity: Identity): string {
    if (identity.kind === "account" && isSkinId(identity.skin)) return identity.skin;
    const worn: string[] = [];
    this.state.players.forEach((p) => worn.push(p.skin));
    return randomSkin(worn);
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
    // A spectator holds nothing, but gets the same grace so the SDK's retry
    // (or a reload's `client.reconnect`) brings them back.
    if (this.spectators.has(client.sessionId)) {
      this.allowReconnection(client, this.reconnectGrace).catch(() => {});
      return;
    }
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
    if (r.teams) {
      const [red, blue] = this.teamCounts(true);
      if (red < r.minPerTeam || blue < r.minPerTeam) return false;
    }
    return r.startNeedsAll ? this.connectedSeats() === this.seats : this.connectedSeats() >= r.minPlayers;
  }

  /**
   * While waiting: start now if the mode has no countdown (the countdown
   * itself runs in `tick`). Never in a mode whose host starts it.
   */
  private maybeStart() {
    if (this.state.phase === "waiting" && !this.rules.hostStarts && this.rules.countdown === 0 && this.ready()) this.startMatch();
  }

  /**
   * MSG_START: the match starts now, straight into the usual warmup, if the
   * sender is the host, the room is waiting and enough players are in
   * (`acceptsStart`). Anything else is ignored: the client is never trusted.
   */
  private startRequested(sender: string) {
    const ok = acceptsStart(this.rules, { phase: this.state.phase, sender, host: this.state.host, ready: this.ready() });
    if (ok) this.startMatch();
  }

  /** The seated player who hosts the room, "" with none (see `joinOrder`). */
  private hostId(): string {
    return hostOf(this.joinOrder, (id) => this.state.players.has(id) && !this.internals.get(id)?.gone);
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
    if (this.spectators.delete(id)) {
      this.state.spectators = Math.min(255, this.spectators.size);
      this.syncListing();
      return;
    }
    if (!this.state.players.has(id)) return; // No seat (a refused join).
    // Battle royale, from the start of play to the end of the result:
    // leaving is a knock-out, now (if still in). The seat stays, not
    // connected and `gone`, so the place shows and is recorded; purgeGone
    // frees it once the result is over.
    if (this.rules.royale && (this.state.phase === "playing" || this.state.phase === "ended")) {
      const p = this.state.players.get(id)!;
      const internal = this.internals.get(id);
      p.connected = false;
      if (internal) {
        internal.gone = true;
        internal.queue.length = 0;
      }
      if (this.state.phase === "playing" && p.alive) {
        this.knockOut(p);
        // Now, not at the next tick: the room may be empty (and gone) by then.
        this.checkLastStanding();
      }
      this.syncListing();
      return;
    }
    this.state.players.delete(id);
    this.updateSeatLock();
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
    if (this.state.phase === "warmup") {
      // Nothing has been played yet: too few left (or, with teams, a team
      // left empty) goes back to waiting, with no result, like a duel.
      const emptyTeam = this.rules.teams && this.teamCounts(false).includes(0);
      if (this.seats < this.rules.minToContinue || emptyTeam) {
        this.setPhase("waiting");
        this.state.startTick = 0;
        this.state.endTick = 0;
        if (this.rules.teams) this.rebalance();
      }
    } else if (this.state.phase === "playing") {
      // Teams: a team with nobody left loses, whatever the score (checked
      // first: the last player standing wins for their team even when the
      // room is then too small to go on).
      if (this.rules.teams && this.seats > 0 && this.teamCounts(false).includes(0))
        this.endTeamMatch(this.teamCounts(false)[TEAM_RED] > 0 ? TEAM_RED : TEAM_BLUE);
      else if (this.seats < this.rules.minToContinue) this.endMatch();
      else if (this.state.suddenDeath && this.hasLeader()) this.endMatch();
    } else if (this.state.phase === "waiting" && this.rules.teams) this.rebalance();
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
    // A mode without drop-in closes its seats while the match is played.
    this.updateSeatLock();
    if (phase !== "waiting") this.state.countdown = 0;
    if (phase !== "warmup") this.state.warmupEnd = 0;
    // The final places and the tiebreak only mean something on the result.
    if (phase !== "ended") {
      this.state.tiebreak = "";
      this.state.players.forEach((p) => (p.place = 0));
    }
    this.syncListing();
  }

  /**
   * Keeps the matchmaking metadata (mode, host, map, phase, seats) in step
   * with the room, for the menu's open games list, and the synced host.
   * Written only when it changed.
   */
  private syncListing() {
    // The host changes with the join order, so it is kept in step here too.
    this.state.host = this.hostId();
    const host = this.state.host ? this.state.players.get(this.state.host) : undefined;
    const meta: RoomMeta = {
      mode: this.rules.mode,
      hostName: host?.name ?? "",
      mapId: this.map.id,
      phase: this.state.phase as Phase,
      players: this.seats,
      maxPlayers: this.rules.maxPlayers,
      teams: this.rules.teams ? this.teamCounts(false) : undefined,
      spectators: this.spectators.size,
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
    if (this.rules.teams) {
      for (const [id, spawn] of this.teamStarts(map)) {
        const p = this.state.players.get(id)!;
        writeSim(p, spawnSim(spawn.x, spawn.z, p.weapon, readSim(p)));
      }
      return;
    }
    const starts = this.rules.mode === "duel" ? null : ffaStartSpawns(map, map.spawns, this.seats);
    let i = 0;
    this.state.players.forEach((p) => {
      const spawn = starts ? starts[i++ % starts.length] : duelSpawn(map, p.slot);
      writeSim(p, spawnSim(spawn.x, spawn.z, p.weapon, readSim(p), this.freshKit()));
    });
  }

  /**
   * A match starts: the map, everyone on their start spot with their pick in
   * hand, the scoreboard cleared, then the warmup (`rules.warmup` seconds,
   * see beginPlay for what starts after it). With no warmup, straight to
   * playing.
   */
  private startMatch() {
    this.purgeGone();
    this.pickMap();
    this.clearProjectiles();
    this.state.winner = "";
    this.state.winningTeam = NO_TEAM;
    this.state.redScore = 0;
    this.state.blueScore = 0;
    this.state.suddenDeath = false;
    this.state.feed.clear();
    this.matchId = `${this.roomId}:${crypto.randomUUID()}`;
    this.resetScoreboard();
    if (this.rules.mode === "duel") {
      this.state.players.forEach((p) => {
        const spawn = duelSpawn(this.map, p.slot);
        this.spawnAt(p, spawn.x, spawn.z);
      });
    } else if (this.rules.teams) {
      // Each team on its own side, spread out, facing the hub.
      for (const [id, spawn] of this.teamStarts(this.map)) {
        const p = this.state.players.get(id)!;
        this.spawnAt(p, spawn.x, spawn.z);
        p.aim = this.hubAim(spawn);
      }
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
    // Battle royale: a crate on every crate spot, no zone until play starts.
    if (this.rules.royale) {
      this.floor.reset(this.map.royale?.crates ?? []);
      this.state.zone.end = 0;
      this.knockedOut = false;
    }
    // Not started yet: the clock, the time limit and the tiebreaks begin
    // with `playing` (beginPlay).
    this.state.startTick = 0;
    this.state.endTick = 0;
    this.internals.forEach((i) => (i.deaths = 0));
    this.teamDamage = [0, 0];
    if (this.rules.warmup <= 0) {
      this.beginPlay();
      return;
    }
    this.setPhase("warmup");
    // A tick, not a duration: every client counts down to the same one.
    this.state.warmupEnd = this.state.tick + ticks(this.rules.warmup);
  }

  /**
   * The warmup is over (or there was none): the match itself starts now. The
   * match clock and the time limit count from here (`startTick`), and so does
   * the "reached that kill score first" tiebreak (`reachedAt`), for everyone,
   * drop-ins during warmup included.
   */
  private beginPlay() {
    this.state.startTick = this.state.tick;
    this.state.endTick = 0;
    this.internals.forEach((i) => {
      i.deaths = 0;
      i.reachedAt = this.state.startTick;
    });
    this.teamDamage = [0, 0];
    this.teamReachedAt = [this.state.startTick, this.state.startTick];
    // Battle royale: the zone waits `zoneWait`, then closes by `zoneClose`,
    // round a centre drawn from the match id.
    const royale = this.rules.royale;
    if (royale) {
      // Who plays it (a leave during warmup doesn't count): a small one isn't recorded.
      this.royaleStarters = this.seats;
      const t = this.state.startTick;
      const z = pickZone(this.map, this.matchId, t + ticks(royale.zoneWait), t + ticks(Math.max(royale.zoneWait, royale.zoneClose)));
      Object.assign(this.state.zone, z);
    }
    this.setPhase("playing");
  }

  /**
   * A pick during warmup, for a living player: the picked weapon and grenade
   * type in hand at once, with a full magazine and nothing of the old gun
   * left over (equipSim), and the grenade ready. Where they stand doesn't change.
   */
  private equip(p: Player) {
    p.weapon = p.pick;
    p.grenade = p.grenadePick;
    writeSim(p, equipSim(readSim(p), p.weapon));
  }

  /** Aim from a spawn toward the FFA map's hub (the centre on other maps). */
  private hubAim(s: Spawn): number {
    const hub = (this.map as Partial<FfaMapDef>).hub ?? { x: 0, z: 0 };
    return Math.atan2(hub.z - s.z, hub.x - s.x);
  }

  /**
   * Puts a player back in the game: picked weapon and grenade type in hand,
   * fresh HP, ammo and cooldowns (the grenade ready, and its next throw on
   * the new type's cooldown), no stun, no flash.
   */
  private spawnAt(p: Player, x: number, z: number) {
    // Battle royale: the Pistol and no grenades, whatever was picked (nothing can be).
    p.weapon = this.rules.royale ? PISTOL : p.pick;
    p.grenade = this.rules.royale ? DEFAULT_GRENADE : p.grenadePick;
    p.flashEnd = 0;
    p.flashTicks = 0;
    p.outTick = 0;
    writeSim(p, spawnSim(x, z, p.weapon, readSim(p), this.freshKit()));
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
    this.state.smokes.clear();
    // A new match must not rewind into the previous one's poses.
    this.history = [];
  }

  /**
   * Stores this tick's player poses. Called once positions are final for the
   * tick (inputs applied) and before any bullet moves.
   */
  private recordHistory() {
    const tick = this.state.tick;
    const slot = tick % HIT_HISTORY_FRAMES;
    const frame = this.history[slot] ?? { tick, poses: new Map<string, PastPose>() };
    frame.tick = tick;
    frame.poses.clear();
    this.state.players.forEach((p, id) => frame.poses.set(id, { x: p.x, z: p.z, alive: p.alive }));
    this.history[slot] = frame;
  }

  /** The frame of `tick`, or undefined if it is not (or no longer) in the ring. */
  private historyAt(tick: number): HistoryFrame | undefined {
    if (tick < 0) return undefined;
    const frame = this.history[tick % HIT_HISTORY_FRAMES];
    return frame && frame.tick === tick ? frame : undefined;
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

    // Battle royale: crates broken open and items picked up, where the
    // players now stand. Only the living and connected take anything.
    if (this.rules.royale && this.state.phase === "playing") {
      const takers: { id: string; p: Player }[] = [];
      this.state.players.forEach((p, id) => {
        if (p.alive && p.connected) takers.push({ id, p });
      });
      this.floor.step(takers);
    }

    // 2. Move bullets and grenades, resolve hits and blasts. The poses are
    //    recorded first: final for this tick, and untouched by combat yet.
    this.recordHistory();
    this.stepBullets();
    this.stepGrenades();

    // 3. Timers: shields, respawns and match reset.
    this.state.players.forEach((player, id) => {
      if (player.shieldTicks > 0) {
        player.shieldTicks--;
        if (player.shieldTicks === 0) player.shieldHp = 0;
      }
      if (player.alive) return;
      // Battle royale: one life. Knocked out stays out (a death while
      // waiting for the match is practice, and respawns as usual).
      if (player.outTick > 0) return;
      player.respawnTicks--;
      if (player.respawnTicks <= 0) this.respawn(id, player);
    });

    // The zone hurts whoever is outside it, a little more as it closes.
    if (this.rules.royale && this.state.phase === "playing") this.stepZone();

    // 4. The match clock: countdown before, time limit during, rematch after.
    if (this.state.phase === "waiting") this.stepCountdown();
    else if (this.state.phase === "warmup") {
      if (this.state.tick >= this.state.warmupEnd) this.beginPlay();
    } else if (this.state.phase === "playing") this.stepTimeLimit();
    else if (this.state.phase === "ended") {
      // After the result delay: the rematch, or back to waiting if too few
      // are left. A mode whose host starts it goes back to waiting either
      // way: the host starts the next match too. In a duel, a player who dropped holds the result card up
      // until they are back (or their grace period ends and onLeave sends the
      // room back to waiting): a match never starts against an empty seat.
      if (this.matchResetTicks > 0) this.matchResetTicks--;
      if (this.matchResetTicks <= 0) {
        // Battle royale: the seats of those who left go now.
        this.purgeGone();
        // Teams: leavers may have left them lopsided; even them out first.
        if (this.rules.teams) this.rebalance();
        if (this.seats < this.rules.minPlayers || this.rules.hostStarts) this.backToWaiting();
        else if (this.ready()) this.startMatch();
        else if (!this.rules.startNeedsAll) this.setPhase("waiting");
      }
    }

    // Battle royale: knock-outs this tick (every one of them, so players out
    // on the same tick are ranked together) may leave one standing.
    if (this.knockedOut) this.checkLastStanding();

    this.broadcastPatch();
  }

  /**
   * After a result: back to waiting. Battle royale: everyone knocked out is
   * back on their feet in the lobby (with the Pistol, spread out), as they
   * were before the match; the next match is started by the host.
   */
  private backToWaiting() {
    this.setPhase("waiting");
    if (!this.rules.royale) return;
    const starts = ffaStartSpawns(this.map, this.map.spawns, this.seats);
    let i = 0;
    this.state.players.forEach((p) => {
      const spawn = starts[i++ % starts.length];
      this.spawnAt(p, spawn.x, spawn.z);
      p.aim = this.hubAim(spawn);
    });
  }

  /** Pre-match countdown (FFA): runs while enough players are connected, cancelled when they aren't. Never with `hostStarts`. */
  private stepCountdown() {
    if (this.rules.countdown === 0 || this.rules.hostStarts) return;
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

  /**
   * Time limit: the most kills wins; a tie goes to sudden death, for at most
   * `rules.suddenDeathMax` seconds, after which the match ends and the
   * tiebreaks decide (endMatch).
   */
  private stepTimeLimit() {
    const limit = this.rules.timeLimit;
    if (limit <= 0) return;
    const elapsed = this.state.tick - this.state.startTick;
    if (this.state.suddenDeath) {
      if (elapsed >= ticks(limit + this.rules.suddenDeathMax)) this.endMatch();
      return;
    }
    if (elapsed < ticks(limit)) return;
    if (this.hasLeader()) this.endMatch();
    else this.state.suddenDeath = true;
  }

  /** Someone leads alone: a player, or a team with teams. */
  private hasLeader(): boolean {
    return this.rules.teams ? this.leadingTeam() !== NO_TEAM : this.soleLeader() !== null;
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
      player.kit.switchSeen = Math.max(player.kit.switchSeen, input.switch ?? 0);
      player.kit.swapSeen = Math.max(player.kit.swapSeen, input.swap ?? 0);
      player.kit.useSeen = Math.max(player.kit.useSeen, input.use ?? 0);
    }
    // Moving, and (not in warmup) shooting, throwing and the shield: the
    // same rule and the same function the client predicts with. It enforces
    // the fire interval, magazine, reload and ability cooldowns.
    const can = playerCan(player.alive, this.state.phase);
    const res = stepPlayer(this.map, readSim(player), input, player.weapon, can, player.grenade, this.kitMode);
    writeSim(player, res.sim);
    // Slots (royale): the gun in hand is the kit's, switched by the step
    // itself; `weapon` follows it for the shot, the kill feed and the views.
    if (this.kitMode === "slots") {
      const hand = gunInHand(player.kit);
      if (hand !== NO_GUN) player.weapon = hand;
    }
    if (!can.act) return;
    player.aim = input.aim;
    // F: swap the gun in hand for one on the floor (royale, while playing).
    // A new gun in hand cancels a heal, like a switch does in the step.
    if (res.swap && this.rules.royale && this.state.phase === "playing" && this.floor.swap(id, player)) cancelHeal(player.kit, HEAL_STOP.switch);

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
      this.bulletInternals.set(id, { vx: b.vx, vz: b.vz, ticksLeft: bulletLifeTicks(w), damage: w.damage, weapon: player.weapon, team: player.team });
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
    g.kind = player.grenade;
    this.state.grenades.set(id, g);
    const dist = Math.hypot(target.x - player.x, target.z - player.z);
    this.grenadeInternals.set(id, {
      ox: player.x,
      oz: player.z,
      flightTicks: grenadeFlightTicks(dist),
      age: 0,
      fuseLeft: GRENADE_FUSE_TICKS,
      team: player.team,
    });
  }

  private stepBullets() {
    const dead: string[] = [];
    // Lag compensation: the shooter aimed at poses drawn INTERP_DELAY_MS in
    // the past, so hits are tested against the poses of that tick. The whole
    // flight is shifted by the same amount, like the shooter's own screen.
    const past = this.historyAt(this.state.tick - HIT_REWIND_TICKS);
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
          // A teammate is not in the way: the bullet flies through (canDamage).
          if (hit || targetId === bullet.owner || !target.alive || !canDamage(internal.team, target.team, false)) return;
          // No past pose (just joined) or dead back then: nothing to hit.
          const pose = past?.poses.get(targetId);
          if (!pose || !pose.alive) return;
          if (circlesOverlap(bx, bz, BULLET_RADIUS, pose.x, pose.z, PLAYER_RADIUS)) {
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
    const blasts: Blast[] = [];
    // Smoke clouds that have cleared go first.
    this.state.smokes.forEach((s, id) => {
      if (s.end <= this.state.tick) this.state.smokes.delete(id);
    });
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
        blasts.push({ owner: g.owner, x: g.tx, z: g.tz, team: internal.team, kind: g.kind });
      }
    });
    for (const id of dead) {
      this.state.grenades.delete(id);
      this.grenadeInternals.delete(id);
    }
    for (const b of blasts) {
      // Nothing goes off in warmup (nothing can be thrown then either).
      if (this.state.phase === "warmup") continue;
      const def = GRENADES[b.kind];
      if (def) this.blastEffects[def.effect](b, def);
    }
  }

  /** What a blast does, by its type's `effect` (GrenadeDef): one handler per effect. */
  private readonly blastEffects: Record<GrenadeEffect, (b: Blast, def: GrenadeDef) => void> = {
    damage: (b, def) => this.explode(b, def),
    cloud: (b) => this.smoke(b),
    stun: (b, def) => this.stun(b, def),
    flash: (b, def) => this.flash(b, def),
    heal: (b, def) => this.heal(b, def),
  };

  /**
   * The players alive that a blast may affect, by its type's `affects`
   * (grenadeAffects: for "enemies", canDamage, so teammates are spared with
   * teams, and in a duel or FFA it gets its thrower too; for "allies", the
   * thrower and their teammates). In state order.
   */
  private blastTargets(b: Blast, def: GrenadeDef): { id: string; p: Player }[] {
    const out: { id: string; p: Player }[] = [];
    this.state.players.forEach((p, id) => {
      if (p.alive && grenadeAffects(def.affects, b.team, p.team, id === b.owner)) out.push({ id, p });
    });
    return out;
  }

  /** A smoke grenade went off: a cloud for SMOKE_TICKS. Who it hides is up to each client (smokeVeil); it remembers who threw it. */
  private smoke({ x, z, owner, team }: Blast) {
    const s = new Smoke();
    s.x = x;
    s.z = z;
    s.start = this.state.tick;
    s.end = this.state.tick + SMOKE_TICKS;
    s.owner = owner;
    s.team = team;
    this.state.smokes.set(String(this.nextGrenadeId++), s);
  }

  /**
   * A stun went off: everyone it may affect (blastTargets) in the radius gets
   * STUN_TICKS of stun, or keeps a longer one already running. `stepPlayer`
   * does the slowing, on the server and in the victim's own prediction
   * alike. No damage.
   */
  private stun(b: Blast, def: GrenadeDef) {
    for (const { p } of this.blastTargets(b, def)) {
      if (blastEdge(b.x, b.z, p.x, p.z) <= STUN.radius) p.stunTicks = Math.max(p.stunTicks, STUN_TICKS);
    }
  }

  /**
   * A flash went off: each player it may affect (blastTargets, like the stun)
   * gets the white screen `flashTicks` gives from where they stand and aim
   * right now, cover included. The end tick is synced, so the victim's
   * screen matches the server. A longer flash still running is kept. No damage.
   */
  private flash(b: Blast, def: GrenadeDef) {
    const tick = this.state.tick;
    for (const { p } of this.blastTargets(b, def)) {
      const n = flashTicks(this.map, p, p.aim, { x: b.x, z: b.z });
      if (n <= 0 || tick + n <= p.flashEnd) continue;
      p.flashEnd = tick + n;
      p.flashTicks = n;
    }
  }

  /**
   * A heal went off: each player it may affect (blastTargets: the thrower
   * and their teammates, alive) gets `healAmount` back at once, capped at
   * MAX_HP, if the blast reaches them with no cover in the way. Only HP: no
   * shield, no kill feed, no damage stat. Clients see it as HP going up.
   */
  private heal(b: Blast, def: GrenadeDef) {
    for (const { p } of this.blastTargets(b, def)) {
      const n = healAmount(this.map, p, p.hp, { x: b.x, z: b.z });
      if (n > 0) p.hp += n;
    }
  }

  /**
   * A frag went off: damage with falloff, the only grenade that hurts (and the
   * kill feed's "Grenade"). Teams: it spares the thrower's team and the thrower
   * (canDamage, its `affects`).
   */
  private explode(b: Blast, def: GrenadeDef) {
    // Collect first: a kill can end the match and clear the state mid-loop.
    const hits: { id: string; p: Player; dmg: number }[] = [];
    for (const { id, p } of this.blastTargets(b, def)) {
      const dmg = grenadeDamage(blastEdge(b.x, b.z, p.x, p.z), id === b.owner);
      if (dmg !== null && dmg > 0) hits.push({ id, p, dmg });
    }
    for (const h of hits) {
      if (this.state.phase === "ended") break;
      this.damage(b.owner, h.id, h.p, h.dmg, KILL_GRENADE);
    }
  }

  /**
   * Shield first, then HP. The kill goes to whoever dealt the killing blow;
   * a self-kill (your own grenade) credits no one and counts as a death, with
   * no kill taken away.
   */
  private damage(attackerId: string, targetId: string, target: Player, amount: number, weapon = 0) {
    // No damage at all in warmup.
    if (!target.alive || this.state.phase === "warmup") return;
    // No friendly fire, and no hurting yourself, with teams. (Bullets and
    // blasts already skip them; this also covers any other path.)
    if (!canDamage(this.teamOf(attackerId), target.team, attackerId === targetId)) return;
    // Scoreboard: what actually came off the opponent (shield, then HP down to 0).
    const dealt = Math.min(amount, target.shieldHp + target.hp);
    const attacker = attackerId === targetId ? undefined : this.state.players.get(attackerId);
    if (attacker && this.state.phase === "playing") {
      attacker.damage = Math.min(0xffff, attacker.damage + dealt);
      // Teams: the team's own total, which outlives a leaver's seat.
      if (attacker.team === TEAM_RED || attacker.team === TEAM_BLUE) this.teamDamage[attacker.team] += dealt;
    }
    let left = amount;
    if (target.shieldHp > 0) {
      const absorbed = Math.min(target.shieldHp, left);
      target.shieldHp -= absorbed;
      left -= absorbed;
      if (target.shieldHp === 0) target.shieldTicks = 0;
    }
    if (left <= 0) return;
    target.hp = Math.max(0, target.hp - left);
    // Battle royale: damage to HP (what the shield soaked doesn't count)
    // cancels a heal in progress, the zone's included. Inputs run before
    // any damage in a tick, so a heal due this tick has already completed.
    cancelHeal(target.kit, weapon === KILL_ZONE ? HEAL_STOP.zone : HEAL_STOP.hurt);
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
    // Battle royale: out for good, their loot on the floor. Who is left is
    // looked at once the whole tick is done (checkLastStanding).
    if (this.rules.royale) this.knockOut(target);
    if (!shooter) return;

    shooter.kills = Math.min(0xff, shooter.kills + 1);
    const shooterInternal = this.internals.get(attackerId);
    if (shooterInternal) shooterInternal.reachedAt = this.state.tick;
    // Battle royale: no kill target, the last one standing wins.
    if (this.rules.royale) return;
    if (this.rules.teams) {
      // The kill counts for the team, and the team's kills are what win.
      const score = this.addTeamKill(shooter.team);
      if (score >= this.rules.killsToWin) this.endMatch();
      else if (this.state.suddenDeath && this.hasLeader()) this.endMatch();
      return;
    }
    if (shooter.kills >= this.rules.killsToWin) this.endMatch();
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
    e.killerTeam = killer?.team ?? NO_TEAM;
    e.victimTeam = victim.team;
    e.weapon = weapon;
    this.state.feed.push(e);
    while (this.state.feed.length > KILL_FEED_SIZE) this.state.feed.shift();
  }

  /**
   * The match is over: first to the kill target, the time limit, sudden
   * death (won, or its cap ran out), or too few players left. There is
   * always one winner: the places come from `rank` (kills, then damage,
   * then first to the score, then the lot), all different, and `winner` is
   * 1st. Whoever reached the kill target is alone on top on kills, so 1st.
   */
  private endMatch() {
    if (this.rules.teams) {
      this.endTeamMatch();
      return;
    }
    // Battle royale: the order of knock-outs (rankRoyale), not the kills.
    const { order, reason } = this.rules.royale ? rankRoyale(this.royaleStandings(), this.matchId) : rank(this.standings(), this.matchId);
    order.forEach(({ entry, place }) => (this.state.players.get(entry.id)!.place = place));
    this.state.winner = order[0]?.entry.id ?? "";
    this.state.tiebreak = reason;
    this.state.endTick = this.state.tick;
    this.setPhase("ended");
    this.matchResetTicks = ticks(this.rules.endDelay);
    this.clearProjectiles();
    // Battle royale: the floor and the zone go with the match.
    if (this.rules.royale) {
      this.floor.clear();
      this.state.zone.end = 0;
      this.knockedOut = false;
    }
    this.recordStats();
  }

  /** Every seat's standing for `rank`: kills, damage dealt, and when the kill count was reached. */
  private standings(): Standing[] {
    const out: Standing[] = [];
    this.state.players.forEach((p, id) =>
      out.push({ id, kills: p.kills, damage: p.damage, reachedAt: this.internals.get(id)?.reachedAt ?? this.state.startTick }),
    );
    return out;
  }

  /** Every seat's standing for `rankRoyale`: when they were knocked out (0: still in), kills, damage. */
  private royaleStandings() {
    const out: { id: string; outTick: number; kills: number; damage: number }[] = [];
    this.state.players.forEach((p, id) => out.push({ id, outTick: p.alive ? 0 : p.outTick || this.state.tick, kills: p.kills, damage: p.damage }));
    return out;
  }

  // --- Battle royale (rules.royale) ---------------------------------------------------

  /**
   * Out of the match for good (killed, the zone, or left): the tick is kept
   * (`outTick`, the place follows from it), and everything they carried
   * (guns, grenades, healing items, shield charges) drops where they fell.
   * What they carried is cleared, so nothing is left twice. Nobody respawns
   * (see the tick's timers).
   */
  private knockOut(p: Player) {
    if (p.outTick > 0) return;
    p.alive = false;
    p.respawnTicks = 0;
    p.shieldTicks = 0;
    p.shieldHp = 0;
    p.outTick = this.state.tick;
    this.floor.scatter(p, p.x, p.z);
    const sim = readSim(p);
    writeSim(p, { ...sim, kit: { ...startKit(), switchSeen: sim.kit.switchSeen, swapSeen: sim.kit.swapSeen, useSeen: sim.kit.useSeen } });
    p.weapon = PISTOL;
    this.knockedOut = true;
  }

  /**
   * The match ends when one player is left standing (connected or not: a
   * dropped player is still in until their grace period runs out), or none:
   * the last ones out went together. Never on who is connected: dead players
   * stay and watch.
   */
  private checkLastStanding() {
    this.knockedOut = false;
    if (!this.rules.royale || this.state.phase !== "playing") return;
    let alive = 0;
    this.state.players.forEach((p) => (alive += p.alive ? 1 : 0));
    if (alive <= 1) this.endMatch();
  }

  /**
   * The zone, once a tick: whoever stands outside it takes `zoneDamage`
   * (whole HP, growing as it closes), through the usual damage path (the
   * shield first). A death there shows in the kill feed like a self-kill
   * (no killer), as "Zone".
   */
  private stepZone() {
    const zone = this.state.zone;
    const tick = this.state.tick;
    const dmg = zoneDamage(zone, tick);
    if (dmg <= 0) return;
    const hurt: { id: string; p: Player }[] = [];
    this.state.players.forEach((p, id) => {
      if (p.alive && outsideZone(zone, tick, p.x, p.z)) hurt.push({ id, p });
    });
    for (const { id, p } of hurt) this.damage("", id, p, dmg, KILL_ZONE);
  }

  /** Frees the seats of the players who left a royale match (kept for their place until the result was over). */
  private purgeGone() {
    const gone = [...this.internals].filter(([, i]) => i.gone).map(([id]) => id);
    if (gone.length === 0) return;
    for (const id of gone) {
      this.state.players.delete(id);
      this.internals.delete(id);
      this.joinOrder = this.joinOrder.filter((s) => s !== id);
    }
    this.updateSeatLock();
    this.syncListing();
  }

  /**
   * Records the finished match for the account players (guests are
   * skipped), with the places set on the players. A win is first place (the
   * one winner); every other place is a loss. A battle royale that started
   * with fewer than ROYALE_MIN_RECORDED players isn't recorded (one kill
   * would be a win).
   */
  private recordStats(winningTeam = NO_TEAM) {
    if (this.rules.royale && this.royaleStarters < ROYALE_MIN_RECORDED) return;
    const results: MatchResult[] = [];
    this.state.players.forEach((p, id) => {
      const internal = this.internals.get(id);
      if (internal?.identity.kind !== "account") return;
      const place = p.place;
      // Teams: a win for everyone on the winning team, a loss for the others.
      if (this.rules.teams) {
        results.push({ userId: internal.identity.userId, kills: p.kills, deaths: internal.deaths, won: p.team === winningTeam, place, team: p.team });
        return;
      }
      results.push({ userId: internal.identity.userId, kills: p.kills, deaths: internal.deaths, won: place === 1, place });
    });
    // Fire and forget: the game loop never waits on the database.
    void recordMatch(this.matchId, results, this.rules.mode);
  }

  /**
   * Where the living enemies of `team` other than `except` stand: everyone
   * but `except` outside a team mode (NO_TEAM has no teammates).
   */
  private livingEnemies(except: string | null, team: number): Vec2[] {
    const out: Vec2[] = [];
    this.state.players.forEach((p, id) => {
      if (id !== except && p.alive && !sameTeam(p.team, team)) out.push({ x: p.x, z: p.z });
    });
    return out;
  }

  /** The spawns a player of `team` uses on the current map: the team's side with teams, else all of them. */
  private spawnsOf(team: number): readonly Spawn[] {
    return this.rules.teams ? teamSpawns(this.map, team) : this.map.spawns;
  }

  // --- Teams (rules.teams) -------------------------------------------------------------

  /** A seat's team (NO_TEAM outside a team mode, or for someone without a seat). */
  teamOf(id: string): number {
    return this.state.players.get(id)?.team ?? NO_TEAM;
  }

  /** Seats on red and on blue: all of them, or only the connected ones. */
  private teamCounts(connectedOnly: boolean): [number, number] {
    const n: [number, number] = [0, 0];
    this.state.players.forEach((p) => {
      if ((p.team === TEAM_RED || p.team === TEAM_BLUE) && (!connectedOnly || p.connected)) n[p.team]++;
    });
    return n;
  }

  /**
   * The team a new seat goes to: the smaller one. On a tie, the one with
   * fewer players connected (a dropped player may not come back), then the
   * one behind on kills (mid-match, the newcomer helps the losing side),
   * then red.
   */
  private pickTeam(): number {
    const all = this.teamCounts(false);
    if (all[TEAM_RED] !== all[TEAM_BLUE]) return all[TEAM_RED] < all[TEAM_BLUE] ? TEAM_RED : TEAM_BLUE;
    const on = this.teamCounts(true);
    if (on[TEAM_RED] !== on[TEAM_BLUE]) return on[TEAM_RED] < on[TEAM_BLUE] ? TEAM_RED : TEAM_BLUE;
    if (this.state.phase === "playing" && this.state.redScore !== this.state.blueScore)
      return this.state.redScore < this.state.blueScore ? TEAM_RED : TEAM_BLUE;
    return TEAM_RED;
  }

  /** One more kill for `team`; returns its new score. */
  private addTeamKill(team: number): number {
    if (team !== TEAM_RED && team !== TEAM_BLUE) return 0;
    this.teamReachedAt[team] = this.state.tick;
    if (team === TEAM_RED) return (this.state.redScore = Math.min(0xffff, this.state.redScore + 1));
    return (this.state.blueScore = Math.min(0xffff, this.state.blueScore + 1));
  }

  /** The team ahead on kills, or NO_TEAM on a tie. */
  private leadingTeam(): number {
    const { redScore: r, blueScore: b } = this.state;
    return r === b ? NO_TEAM : r > b ? TEAM_RED : TEAM_BLUE;
  }

  /**
   * MSG_TEAM: while waiting, a player moves to the other team if the sizes
   * still differ by at most one afterwards (so only from the bigger team of
   * an odd count: 3v2 -> 2v3). Anything else is refused silently. The
   * player moves to a spawn on the new side.
   */
  private switchTeam(id: string, team: number) {
    const player = this.state.players.get(id);
    if (!player || !this.rules.teams || this.state.phase !== "waiting" || player.team === team) return;
    const sizes = this.teamCounts(false);
    sizes[player.team]--;
    sizes[team]++;
    if (Math.abs(sizes[TEAM_RED] - sizes[TEAM_BLUE]) > 1) return;
    player.team = team;
    this.toOwnSide(id, player);
    this.syncListing();
  }

  /**
   * Evens the teams out between matches (a leave can make them 3v1): while
   * they differ by more than one, the latest joiner of the bigger team moves
   * to the other one, and to its side.
   */
  private rebalance() {
    for (;;) {
      const [red, blue] = this.teamCounts(false);
      if (Math.abs(red - blue) <= 1) return;
      const from = red > blue ? TEAM_RED : TEAM_BLUE;
      const id = [...this.joinOrder].reverse().find((s) => this.state.players.get(s)?.team === from);
      const p = id ? this.state.players.get(id) : undefined;
      if (!id || !p) return;
      p.team = from === TEAM_RED ? TEAM_BLUE : TEAM_RED;
      this.toOwnSide(id, p);
      this.syncListing();
    }
  }

  /** Puts a player on a spawn of their own team's side, out of the enemies' sight, facing the hub. */
  private toOwnSide(id: string, p: Player) {
    const spawn = ffaRespawnPoint(this.map, this.spawnsOf(p.team), this.livingEnemies(id, p.team));
    writeSim(p, spawnSim(spawn.x, spawn.z, p.weapon, readSim(p)));
    p.aim = this.hubAim(spawn);
  }

  /** Match start with teams: each team spread over its own side (ffaStartSpawns on the side's spawns). */
  private teamStarts(map: MapDef): Map<string, Spawn> {
    const out = new Map<string, Spawn>();
    const ids = [...this.state.players.keys()].sort(() => Math.random() - 0.5);
    for (const team of [TEAM_RED, TEAM_BLUE]) {
      const mine = ids.filter((id) => this.state.players.get(id)?.team === team);
      if (mine.length === 0) continue;
      const starts = ffaStartSpawns(map, teamSpawns(map, team), mine.length);
      mine.forEach((id, i) => out.set(id, starts[i % starts.length]));
    }
    return out;
  }

  /**
   * The end of a team match: `forced` wins (the only team with players
   * left), else the team with the most kills; level on kills, `rank` on the
   * team totals decides (the team's damage, then first to the score, then
   * the lot). Never a draw, and no single winner. Places are all different:
   * the winning team's players first, then the others, each team in `rank`
   * order of its players' own kills, damage and so on.
   */
  private endTeamMatch(forced?: number) {
    const team = (t: number): Standing => ({
      id: String(t),
      kills: t === TEAM_RED ? this.state.redScore : this.state.blueScore,
      damage: this.teamDamage[t],
      reachedAt: this.teamReachedAt[t],
    });
    const decided = rank([team(TEAM_RED), team(TEAM_BLUE)], this.matchId);
    const winningTeam = forced ?? Number(decided.order[0].entry.id);
    this.state.winner = "";
    this.state.winningTeam = winningTeam;
    this.state.tiebreak = forced === undefined ? decided.reason : "";
    const players = rank(this.standings(), this.matchId).order.map((o) => this.state.players.get(o.entry.id)!);
    const inOrder = [...players.filter((p) => p.team === winningTeam), ...players.filter((p) => p.team !== winningTeam)];
    inOrder.forEach((p, i) => (p.place = i + 1));
    this.state.endTick = this.state.tick;
    this.setPhase("ended");
    this.matchResetTicks = ticks(this.rules.endDelay);
    this.clearProjectiles();
    this.recordStats(winningTeam);
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
    // Teams: on the team's own side, out of every enemy's sight.
    const spawn = ffaRespawnPoint(this.map, this.spawnsOf(player.team), this.livingEnemies(id, player.team));
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

/** Team deathmatch: red against blue, up to 4v4, first team to TEAM_KILLS_TO_WIN or the most after TEAM_TIME_LIMIT. Room "tdm". */
export class TeamRoom extends GameRoom {
  static override rules = TEAM_RULES;
}

/** Battle royale: 2-10 players, one life, crates and a closing zone; the last one standing wins. Room "royale". */
export class RoyaleRoom extends GameRoom {
  static override rules = ROYALE_RULES;
}

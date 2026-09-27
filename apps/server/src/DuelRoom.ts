import { ErrorCode, Room, ServerError, type AuthContext, type Client } from "@colyseus/core";
import {
  BULLET_RADIUS,
  DEFAULT_MAP_ID,
  GRENADE_FUSE_TICKS,
  INPUT_BURST,
  KILLS_TO_WIN,
  MATCH_END_DELAY,
  MAX_HP,
  MAX_INPUT_QUEUE,
  MAX_PLAYERS,
  MSG_INPUT,
  MAPS,
  MSG_PICK,
  MSG_PING,
  MSG_PONG,
  PLAYER_RADIUS,
  RESPAWN_DELAY,
  SHIELD,
  SHIELD_TICKS,
  TICK_RATE,
  bulletId,
  bulletLifeTicks,
  circlesOverlap,
  grenadeArc,
  grenadeDamage,
  grenadeFlightTicks,
  isWeaponId,
  mapById,
  readSim,
  respawnPoint,
  shotPellets,
  spawnSim,
  stepBullet,
  stepPlayer,
  ticks,
  weaponDef,
  writeSim,
  type InputMessage,
  type MapDef,
  type Phase,
  type RoomMeta,
  type Vec2,
} from "@bagarre/shared";
import { AuthRejected, guestName, recordMatch, resolveIdentity, type Identity, type MatchResult } from "./accounts.ts";
import { Bullet, DuelState, Grenade, Player } from "./state.ts";

/**
 * Error code of a join refused for a bad Clerk token: Colyseus' own
 * AUTH_FAILED (it doubles as the HTTP status, so it must stay in 200-599).
 * The client then falls back to guest.
 */
export const AUTH_REJECTED_CODE = ErrorCode.AUTH_FAILED;

/** Server-only bookkeeping per player. Never synced. */
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
}

/** Server-only bookkeeping per bullet. */
interface BulletInternal {
  vx: number;
  vz: number;
  ticksLeft: number;
  damage: number;
}

/** Server-only bookkeeping per grenade. */
interface GrenadeInternal {
  ox: number;
  oz: number;
  flightTicks: number;
  age: number;
  fuseLeft: number;
}

const MAX_COUNTER = 0xffffffff;
const PING_INTERVAL_MS = 2000;
let pingCounter = 0;

/** A map id that exists, or null. */
function knownMap(id: unknown): MapDef | null {
  return typeof id === "string" ? (MAPS.find((m) => m.id === id) ?? null) : null;
}

/**
 * The dev-only `?map=<id>` join option (the client passes it as `map`). Honoured
 * only when NODE_ENV isn't "production", read at join time.
 */
function devMap(options: unknown): MapDef | null {
  if (process.env.NODE_ENV === "production") return null;
  return typeof options === "object" && options !== null ? knownMap((options as Record<string, unknown>).map) : null;
}

/** The `guestName` join option, when it has the server's own guest name format. */
function requestedGuestName(options: unknown): string | null {
  const v = typeof options === "object" && options !== null ? (options as Record<string, unknown>).guestName : undefined;
  return typeof v === "string" && /^Guest-\d{4}$/.test(v) ? v : null;
}

function sanitizeInput(raw: unknown): InputMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const seq = m.seq;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0 || seq > MAX_COUNTER) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const counter = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_COUNTER ? v : 0;
  // Move length is clamped inside the step (clampMove) and the grenade target
  // to GRENADE.range (grenadeTarget), whatever the client sends.
  return {
    seq,
    mx: num(m.mx),
    mz: num(m.mz),
    aim: num(m.aim),
    fire: m.fire === true,
    gx: num(m.gx),
    gz: num(m.gz),
    dash: counter(m.dash),
    grenade: counter(m.grenade),
    shield: counter(m.shield),
    reload: counter(m.reload),
  };
}

export class DuelRoom extends Room<{ state: DuelState; metadata: RoomMeta }> {
  maxClients = MAX_PLAYERS;
  state = new DuelState();

  private internals = new Map<string, PlayerInternal>();
  private bulletInternals = new Map<string, BulletInternal>();
  private grenadeInternals = new Map<string, GrenadeInternal>();
  private nextGrenadeId = 0;
  private matchResetTicks = 0;
  /** Unique per match, so a retried stats write is applied once. */
  private matchId = "";
  /** The map being played; `state.mapId` mirrors it. Only changes between matches (see `pickMap`). */
  private map: MapDef = mapById(DEFAULT_MAP_ID);
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
    try {
      return await resolveIdentity(token || undefined);
    } catch (err) {
      if (err instanceof AuthRejected) throw new ServerError(AUTH_REJECTED_CODE, err.message);
      throw err;
    }
  }

  /**
   * A room class pinned to one map, for `createServer({ mapId })` and the
   * smoke test. A subclass rather than a room option: clients' join options
   * are merged into the room options, so an option could be spoofed.
   */
  static pinnedTo(mapId: string): typeof DuelRoom {
    const map = knownMap(mapId);
    if (!map) throw new Error(`Unknown map "${mapId}" (known: ${MAPS.map((m) => m.id).join(", ")})`);
    return class PinnedDuelRoom extends DuelRoom {
      protected override pinnedMap: MapDef | null = map;
    };
  }

  /** Set by `pinnedTo`: every match of this room is on that map. */
  protected pinnedMap: MapDef | null = null;

  onCreate(options?: unknown) {
    // A private room is never listed nor quick-matched, only joined by id
    // (its invite link). Only the creator's options reach onCreate, so no one
    // can make someone else's room private; join options are never read for it.
    if (typeof options === "object" && options !== null && (options as Record<string, unknown>).private === true) {
      void this.setPrivate(true);
    }
    // Map: pinned by the server, else by the dev `?map=` option of whoever
    // created the room, else random.
    const pinned = this.pinnedMap ?? devMap(options);
    if (pinned) {
      this.map = pinned;
      this.fixedMap = true;
    } else {
      this.map = MAPS[Math.floor(Math.random() * MAPS.length)];
    }
    this.state.mapId = this.map.id;
    this.syncListing();

    this.onMessage(MSG_INPUT, (client, raw: unknown) => {
      const input = sanitizeInput(raw);
      const internal = this.internals.get(client.sessionId);
      if (!input || !internal) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || input.seq <= player.lastSeq) return;
      if (internal.queue.length >= MAX_INPUT_QUEUE) return;
      internal.queue.push(input);
    });

    // Weapon pick: only valid ids, only while dead or between matches. It is
    // stored as `pick` and only put in hand on the next (re)spawn.
    this.onMessage(MSG_PICK, (client, raw: unknown) => {
      const player = this.state.players.get(client.sessionId);
      const weapon = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).weapon : undefined;
      if (!player || !isWeaponId(weapon)) return;
      if (player.alive && this.state.phase === "playing") return;
      player.pick = weapon;
    });

    // Latency: one probe per client every PING_INTERVAL_MS; the answer's
    // round trip becomes the player's synced `ping`. Only the probe in flight
    // is accepted, so a client can't make its ping up.
    this.onMessage(MSG_PONG, (client, raw: unknown) => {
      const internal = this.internals.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      const n = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).n : undefined;
      if (!internal?.ping || !player || n !== internal.ping.n) return;
      // At least 1 ms, so 0 keeps meaning "not measured yet".
      player.ping = Math.min(9999, Math.max(1, Math.round(performance.now() - internal.ping.at)));
      internal.ping = null;
    });
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

  onJoin(client: Client, options?: unknown) {
    // A dev `?map=` from the second player pins the room too. A join can
    // only happen while waiting (the room holds two), so this is never
    // mid-match. A server-pinned map wins.
    const asked = devMap(options);
    if (asked && !this.pinnedMap && this.state.phase !== "playing") {
      this.fixedMap = true;
      if (asked.id !== this.map.id) this.switchMap(asked);
    }

    const taken = new Set<number>();
    const names = new Set<string>();
    this.state.players.forEach((p) => {
      taken.add(p.slot);
      names.add(p.name);
    });
    const slot = taken.has(0) ? 1 : 0;
    const identity: Identity = (client.auth as Identity | undefined) ?? { kind: "guest", name: guestName() };
    const hasUsername = identity.kind === "account" && !!identity.username;
    // A guest keeps the guest name the client shows on its menu, if it is one
    // (`Guest-` and four digits: nobody can pick a real-looking name this way).
    let name = hasUsername ? identity.name : (requestedGuestName(options) ?? identity.name);
    // Two guests could draw the same number.
    if (names.has(name) && !hasUsername) name = guestName(names);

    const spawn = this.map.spawns[slot];
    const player = new Player();
    player.slot = slot;
    player.name = name;
    writeSim(player, spawnSim(spawn.x, spawn.z, player.weapon));
    // Face the centre of the map.
    player.aim = Math.atan2(-spawn.z, -spawn.x);
    this.state.players.set(client.sessionId, player);
    player.account = hasUsername;
    this.internals.set(client.sessionId, { queue: [], tokens: INPUT_BURST, identity, deaths: 0, ping: null });
    this.joinOrder.push(client.sessionId);

    if (this.state.players.size === MAX_PLAYERS) this.startMatch();
    this.syncListing();
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.internals.delete(client.sessionId);
    this.joinOrder = this.joinOrder.filter((id) => id !== client.sessionId);
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
    this.syncListing();
  }

  /**
   * Keeps the matchmaking metadata (host, map, phase, player count) in step
   * with the room, for the menu's open games list. Written only when it
   * changed.
   */
  private syncListing() {
    const host = this.joinOrder.length > 0 ? this.state.players.get(this.joinOrder[0]) : undefined;
    const meta: RoomMeta = {
      hostName: host?.name ?? "",
      mapId: this.map.id,
      phase: this.state.phase as Phase,
      players: this.state.players.size,
      createdAt: this.createdAt,
    };
    const key = JSON.stringify(meta);
    if (key === this.metaKey) return;
    this.metaKey = key;
    this.setMetadata(meta).catch((err) => console.warn("[room] metadata update failed", err));
  }

  /**
   * The map for the match about to start: the pinned one, or the current one
   * for a room's first match (the waiting player is already on it), or a
   * random other one after that.
   */
  private pickMap() {
    if (!this.fixedMap && this.mapPlayed && MAPS.length > 1) {
      const others = MAPS.filter((m) => m.id !== this.map.id);
      this.switchMap(others[Math.floor(Math.random() * others.length)]);
    }
    this.mapPlayed = true;
  }

  /**
   * Changes the map. Only called between matches or while waiting, and always
   * together with putting the players on the new spawns (startMatch does it
   * right after, and it is done here for a player waiting alone), before the
   * tick's patch goes out: clients get the new mapId and the new positions in
   * the same snapshot.
   */
  private switchMap(map: MapDef) {
    this.map = map;
    this.state.mapId = map.id;
    this.syncListing();
    this.clearProjectiles();
    this.state.players.forEach((p) => {
      const spawn = map.spawns[p.slot];
      writeSim(p, spawnSim(spawn.x, spawn.z, p.weapon, readSim(p)));
    });
  }

  private startMatch() {
    this.pickMap();
    this.clearProjectiles();
    this.state.winner = "";
    this.matchId = `${this.roomId}:${crypto.randomUUID()}`;
    this.internals.forEach((i) => (i.deaths = 0));
    this.resetScoreboard();
    this.state.players.forEach((p) => {
      const spawn = this.map.spawns[p.slot];
      this.spawnAt(p, spawn.x, spawn.z);
    });
    this.state.startTick = this.state.tick;
    this.state.endTick = 0;
    this.setPhase("playing");
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

    if (this.state.phase === "ended") {
      this.matchResetTicks--;
      if (this.matchResetTicks <= 0) {
        if (this.state.players.size === MAX_PLAYERS) this.startMatch();
        else this.setPhase("waiting");
      }
    }

    this.broadcastPatch();
  }

  private applyInput(id: string, player: Player, input: InputMessage) {
    // Always acknowledge, even when the input has no effect (dead, match
    // over): the client needs the ack to drop it from its replay buffer.
    player.lastSeq = input.seq;
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
      this.bulletInternals.set(id, { vx: b.vx, vz: b.vz, ticksLeft: bulletLifeTicks(w), damage: w.damage });
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
            this.damage(bullet.owner, targetId, target, internal.damage);
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
      this.damage(owner, h.id, h.p, h.dmg);
    }
  }

  /** Shield first, then HP. Kills are credited to the attacker, never for self-damage. */
  private damage(attackerId: string, targetId: string, target: Player, amount: number) {
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
    target.respawnTicks = ticks(RESPAWN_DELAY);
    target.shieldTicks = 0;
    target.shieldHp = 0;
    // Waiting mode (alone in the room) still lets you shoot, but kills only
    // count during a real match.
    if (this.state.phase !== "playing") return;
    const targetInternal = this.internals.get(targetId);
    if (targetInternal) targetInternal.deaths++;
    target.deaths = Math.min(0xff, target.deaths + 1);
    if (attackerId === targetId) return;

    const shooter = this.state.players.get(attackerId);
    if (!shooter) return;
    shooter.kills++;
    if (shooter.kills >= KILLS_TO_WIN) {
      this.state.winner = attackerId;
      this.state.endTick = this.state.tick;
      this.setPhase("ended");
      this.matchResetTicks = ticks(MATCH_END_DELAY);
      this.clearProjectiles();
      this.recordStats(attackerId);
    }
  }

  /** Sends the finished match to Convex for the account players (guests are skipped). */
  private recordStats(winnerId: string) {
    const results: MatchResult[] = [];
    this.state.players.forEach((p, id) => {
      const internal = this.internals.get(id);
      if (internal?.identity.kind !== "account") return;
      results.push({ clerkId: internal.identity.clerkId, kills: p.kills, deaths: internal.deaths, won: id === winnerId });
    });
    // Fire and forget: the game loop never waits on Convex.
    void recordMatch(this.matchId, results);
  }

  /** Respawns out of the opponent's sight if possible, then as far from them as possible. */
  private respawn(id: string, player: Player) {
    let opponent: Player | null = null;
    this.state.players.forEach((p, pid) => {
      if (pid !== id) opponent = p;
    });
    const spawn = respawnPoint(this.map, this.map.spawns, opponent, this.map.spawns[player.slot]);
    this.spawnAt(player, spawn.x, spawn.z);
  }
}

import { Room, type Client } from "@colyseus/core";
import {
  BULLET_RADIUS,
  GRENADE_FUSE_TICKS,
  INPUT_BURST,
  KILLS_TO_WIN,
  MATCH_END_DELAY,
  MAX_HP,
  MAX_INPUT_QUEUE,
  MAX_PLAYERS,
  MSG_INPUT,
  MSG_PICK,
  PLAYER_RADIUS,
  RESPAWN_DELAY,
  SHIELD,
  SHIELD_TICKS,
  SPAWN_POINTS,
  TICK_RATE,
  bulletId,
  bulletLifeTicks,
  circlesOverlap,
  grenadeArc,
  grenadeDamage,
  grenadeFlightTicks,
  isWeaponId,
  readSim,
  shotPellets,
  spawnSim,
  stepBullet,
  stepPlayer,
  ticks,
  weaponDef,
  writeSim,
  type InputMessage,
  type Phase,
  type Vec2,
} from "@bagarre/shared";
import { Bullet, DuelState, Grenade, Player } from "./state.ts";

/** Server-only bookkeeping per player. Never synced. */
interface PlayerInternal {
  queue: InputMessage[];
  /** Input budget, see INPUT_BURST. */
  tokens: number;
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

export class DuelRoom extends Room<{ state: DuelState }> {
  maxClients = MAX_PLAYERS;
  state = new DuelState();

  private internals = new Map<string, PlayerInternal>();
  private bulletInternals = new Map<string, BulletInternal>();
  private grenadeInternals = new Map<string, GrenadeInternal>();
  private nextGrenadeId = 0;
  private matchResetTicks = 0;

  onCreate() {
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

  onJoin(client: Client) {
    const taken = new Set<number>();
    this.state.players.forEach((p) => taken.add(p.slot));
    const slot = taken.has(0) ? 1 : 0;

    const spawn = SPAWN_POINTS[slot];
    const player = new Player();
    player.slot = slot;
    writeSim(player, spawnSim(spawn.x, spawn.z, player.weapon));
    player.aim = slot === 0 ? Math.PI / 4 : (-3 * Math.PI) / 4;
    this.state.players.set(client.sessionId, player);
    this.internals.set(client.sessionId, { queue: [], tokens: INPUT_BURST });

    if (this.state.players.size === MAX_PLAYERS) this.startMatch();
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.internals.delete(client.sessionId);
    this.clearProjectiles();
    this.setPhase("waiting");
    this.state.winner = "";
    // The remaining player keeps playing alone, with a clean slate.
    this.state.players.forEach((p) => {
      p.kills = 0;
      p.hp = MAX_HP;
      p.alive = true;
      p.respawnTicks = 0;
    });
  }

  private setPhase(phase: Phase) {
    this.state.phase = phase;
  }

  private startMatch() {
    this.clearProjectiles();
    this.state.winner = "";
    this.state.players.forEach((p) => {
      const spawn = SPAWN_POINTS[p.slot];
      this.spawnAt(p, spawn.x, spawn.z);
      p.kills = 0;
    });
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
    const res = stepPlayer(readSim(player), input, player.weapon, canAct);
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
      const alive = stepBullet(sim, (bx, bz) => {
        let hit = false;
        this.state.players.forEach((target, targetId) => {
          if (hit || targetId === bullet.owner || !target.alive) return;
          if (circlesOverlap(bx, bz, BULLET_RADIUS, target.x, target.z, PLAYER_RADIUS)) {
            hit = true;
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
    if (this.state.phase !== "playing" || attackerId === targetId) return;

    const shooter = this.state.players.get(attackerId);
    if (!shooter) return;
    shooter.kills++;
    if (shooter.kills >= KILLS_TO_WIN) {
      this.state.winner = attackerId;
      this.setPhase("ended");
      this.matchResetTicks = ticks(MATCH_END_DELAY);
      this.clearProjectiles();
    }
  }

  /** Respawns at the spawn point farthest from the opponent. */
  private respawn(id: string, player: Player) {
    let opponent: Player | undefined;
    this.state.players.forEach((p, pid) => {
      if (pid !== id) opponent = p;
    });
    let best = SPAWN_POINTS[player.slot];
    if (opponent) {
      let bestD = -1;
      for (const s of SPAWN_POINTS) {
        const d = (s.x - opponent.x) ** 2 + (s.z - opponent.z) ** 2;
        if (d > bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    this.spawnAt(player, best.x, best.z);
  }
}

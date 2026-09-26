import { Room, type Client } from "@colyseus/core";
import {
  BULLET_DAMAGE,
  BULLET_LIFETIME,
  BULLET_RADIUS,
  BULLET_SPEED,
  FIRE_COOLDOWN,
  INPUT_BURST,
  KILLS_TO_WIN,
  MATCH_END_DELAY,
  MAX_HP,
  MAX_INPUT_QUEUE,
  MAX_PLAYERS,
  MSG_INPUT,
  PLAYER_RADIUS,
  RESPAWN_DELAY,
  SPAWN_POINTS,
  TICK_DT,
  TICK_RATE,
  circlesOverlap,
  muzzle,
  stepBullet,
  stepPlayer,
  type InputMessage,
  type Phase,
} from "@bagarre/shared";
import { Bullet, DuelState, Player } from "./state.ts";

/** Server-only bookkeeping per player. Never synced. */
interface PlayerInternal {
  queue: InputMessage[];
  /** Input budget, see INPUT_BURST. */
  tokens: number;
  /** Seconds until the next shot is allowed. */
  cooldown: number;
}

/** Server-only bookkeeping per bullet. */
interface BulletInternal {
  vx: number;
  vz: number;
  ticksLeft: number;
}

const secondsToTicks = (s: number) => Math.round(s * TICK_RATE);

function sanitizeInput(raw: unknown): InputMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const seq = m.seq;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  // Length clamping happens inside stepPlayer (clampMove), so the move vector
  // can never exceed 1 no matter what the client sends.
  return { seq, mx: num(m.mx), mz: num(m.mz), aim: num(m.aim), fire: m.fire === true };
}

export class DuelRoom extends Room<{ state: DuelState }> {
  maxClients = MAX_PLAYERS;
  state = new DuelState();

  private internals = new Map<string, PlayerInternal>();
  private bulletInternals = new Map<string, BulletInternal>();
  private nextBulletId = 0;
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
    player.x = spawn.x;
    player.z = spawn.z;
    player.aim = slot === 0 ? Math.PI / 4 : (-3 * Math.PI) / 4;
    this.state.players.set(client.sessionId, player);
    this.internals.set(client.sessionId, { queue: [], tokens: INPUT_BURST, cooldown: 0 });

    if (this.state.players.size === MAX_PLAYERS) this.startMatch();
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.internals.delete(client.sessionId);
    this.clearBullets();
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
    this.clearBullets();
    this.state.winner = "";
    this.state.players.forEach((p) => {
      const spawn = SPAWN_POINTS[p.slot];
      p.x = spawn.x;
      p.z = spawn.z;
      p.hp = MAX_HP;
      p.kills = 0;
      p.alive = true;
      p.respawnTicks = 0;
    });
    this.setPhase("playing");
  }

  private clearBullets() {
    this.state.bullets.clear();
    this.bulletInternals.clear();
  }

  private tick() {
    this.state.tick++;

    // 1. Apply queued inputs. One input == one fixed step of TICK_DT, exactly
    //    like the client's prediction. The token budget allows catching up a
    //    few inputs after jitter but caps the average at one per tick.
    this.state.players.forEach((player, id) => {
      const internal = this.internals.get(id);
      if (!internal) return;
      internal.tokens = Math.min(INPUT_BURST, internal.tokens + 1);
      while (internal.tokens >= 1 && internal.queue.length > 0) {
        const input = internal.queue.shift()!;
        internal.tokens -= 1;
        this.applyInput(id, player, internal, input);
      }
    });

    // 2. Move bullets, resolve hits.
    this.stepBullets();

    // 3. Timers: respawns and match reset.
    this.state.players.forEach((player, id) => {
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

  private applyInput(id: string, player: Player, internal: PlayerInternal, input: InputMessage) {
    // Always acknowledge, even when the input has no effect (dead, match
    // over): the client needs the ack to drop it from its replay buffer.
    player.lastSeq = input.seq;
    internal.cooldown = Math.max(0, internal.cooldown - TICK_DT);
    if (!player.alive || this.state.phase === "ended") return;

    const next = stepPlayer({ x: player.x, z: player.z }, input);
    player.x = next.x;
    player.z = next.z;
    player.aim = input.aim;

    if (input.fire && internal.cooldown <= 0) {
      internal.cooldown = FIRE_COOLDOWN;
      this.spawnBullet(id, player);
    }
  }

  private spawnBullet(owner: string, player: Player) {
    const pos = muzzle(player.x, player.z, player.aim);
    const id = String(this.nextBulletId++);
    const bullet = new Bullet();
    bullet.x = pos.x;
    bullet.z = pos.z;
    bullet.owner = owner;
    this.state.bullets.set(id, bullet);
    this.bulletInternals.set(id, {
      vx: Math.cos(player.aim) * BULLET_SPEED,
      vz: Math.sin(player.aim) * BULLET_SPEED,
      ticksLeft: secondsToTicks(BULLET_LIFETIME),
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
            this.damage(bullet.owner, target);
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

  private damage(shooterId: string, target: Player) {
    target.hp = Math.max(0, target.hp - BULLET_DAMAGE);
    if (target.hp > 0) return;

    target.alive = false;
    target.respawnTicks = secondsToTicks(RESPAWN_DELAY);
    // Waiting mode (alone in the room) still lets you shoot, but kills only
    // count during a real match.
    if (this.state.phase !== "playing") return;

    const shooter = this.state.players.get(shooterId);
    if (!shooter) return;
    shooter.kills++;
    if (shooter.kills >= KILLS_TO_WIN) {
      this.state.winner = shooterId;
      this.setPhase("ended");
      this.matchResetTicks = secondsToTicks(MATCH_END_DELAY);
      this.clearBullets();
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
    player.x = best.x;
    player.z = best.z;
    player.hp = MAX_HP;
    player.alive = true;
    player.respawnTicks = 0;
  }
}

import {
  DEFAULT_MAP_ID,
  mapById,
  readSim,
  stepPlayer,
  type InputMessage,
  type MapDef,
  type PlayerSim,
  type PlayerView,
  type StepResult,
  type Vec2,
} from "@bagarre/shared";

/** Beyond this distance a correction snaps instead of being smoothed. */
const SNAP_DISTANCE = 3;
/** How fast a visual correction fades out, per second. */
const CORRECTION_DECAY = 12;
/** Safety cap if the server stops acknowledging. */
const MAX_PENDING = 120;

/**
 * Client-side prediction + reconciliation for the local player.
 *
 * Every input we send is applied immediately with the shared step function and
 * kept in `pending`. When a server snapshot arrives we drop the inputs it has
 * already processed (`lastSeq`), restart from the server's authoritative
 * state (position, dash, cooldowns, ammo, and the stun a stun grenade put on
 * us: `stunTicks` is part of PlayerSim, so the replay walks just as slowly as
 * the server does and nothing rubber-bands) and re-apply the rest. If client and
 * server agree (the normal case, same function, same inputs) this changes
 * nothing; if they disagree, the server wins and the position difference is
 * faded out visually over a few frames.
 */
export class Predictor {
  /** Predicted state after the latest sent input. */
  sim: PlayerSim | null = null;
  /** Predicted position one tick earlier, for smooth rendering between ticks. */
  prev: Vec2 = { x: 0, z: 0 };
  /** Weapon in hand, from the latest snapshot. */
  weapon = 0;
  /** Grenade type in hand (its cooldown), from the latest snapshot. */
  grenade = 0;
  /**
   * The map we predict on: always the one of the latest snapshot (main.ts
   * calls `setMap` before `reconcile`). Predicting on any other map than the
   * server's would desync, so this placeholder is replaced before the first prediction.
   */
  map: MapDef = mapById(DEFAULT_MAP_ID);
  private pending: InputMessage[] = [];
  private offset: Vec2 = { x: 0, z: 0 };
  /** Last reconciliation error, for the debug line. */
  lastError = 0;

  /**
   * The server moved to another map. It does that in the same tick as it puts
   * us on the new spawn, and after applying every input up to the snapshot's
   * `lastSeq`: everything older ran on the old map, everything still pending
   * will run on the new one. So we forget our predicted state (the next
   * `reconcile` restarts from the server's, on the new map, and replays the
   * pending inputs there) and drop any smoothing: nothing slides across maps.
   */
  setMap(map: MapDef) {
    this.map = map;
    this.sim = null;
    this.offset = { x: 0, z: 0 };
    this.lastError = 0;
  }

  /**
   * Forgets everything: predicted state, smoothing and the inputs in flight
   * (after a reconnection they were lost with the connection, and the server
   * has already acknowledged all it applied). The next `reconcile` restarts
   * from the server's state.
   */
  reset() {
    this.sim = null;
    this.pending = [];
    this.offset = { x: 0, z: 0 };
    this.lastError = 0;
  }

  /** Applies an input we just sent. `canAct` mirrors the server's rules. */
  apply(input: InputMessage, canAct: boolean): StepResult | null {
    if (!this.sim) return null;
    this.prev = { x: this.sim.x, z: this.sim.z };
    const res = stepPlayer(this.map, this.sim, input, this.weapon, canAct, this.grenade);
    this.sim = res.sim;
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return res;
  }

  reconcile(server: PlayerView, canAct: boolean) {
    this.weapon = server.weapon;
    this.grenade = server.grenade;
    this.pending = this.pending.filter((i) => i.seq > server.lastSeq);
    let s = readSim(server);
    for (const input of this.pending) s = stepPlayer(this.map, s, input, this.weapon, canAct, this.grenade).sim;

    if (!this.sim) {
      this.sim = s;
      this.prev = { x: s.x, z: s.z };
      return;
    }
    const ex = this.sim.x - s.x;
    const ez = this.sim.z - s.z;
    this.lastError = Math.hypot(ex, ez);
    if (this.lastError > SNAP_DISTANCE) {
      // Teleport (respawn) or a big desync: don't slide across the map.
      this.offset = { x: 0, z: 0 };
      this.prev = { x: s.x, z: s.z };
    } else if (this.lastError > 0) {
      this.offset = { x: this.offset.x + ex, z: this.offset.z + ez };
      this.prev = { x: this.prev.x - ex, z: this.prev.z - ez };
    }
    this.sim = s;
  }

  /** Position to draw, `alpha` being how far we are into the current tick. */
  render(alpha: number, dtSeconds: number): Vec2 {
    const k = Math.exp(-CORRECTION_DECAY * dtSeconds);
    this.offset = { x: this.offset.x * k, z: this.offset.z * k };
    const cur = this.sim ?? this.prev;
    return {
      x: this.prev.x + (cur.x - this.prev.x) * alpha + this.offset.x,
      z: this.prev.z + (cur.z - this.prev.z) * alpha + this.offset.z,
    };
  }

  get pendingCount() {
    return this.pending.length;
  }
}

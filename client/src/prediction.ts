import {
  readSim,
  stepPlayer,
  type InputMessage,
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
 * state (position, dash, cooldowns, ammo) and re-apply the rest. If client and
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
  private pending: InputMessage[] = [];
  private offset: Vec2 = { x: 0, z: 0 };
  /** Last reconciliation error, for the debug line. */
  lastError = 0;

  /** Applies an input we just sent. `canAct` mirrors the server's rules. */
  apply(input: InputMessage, canAct: boolean): StepResult | null {
    if (!this.sim) return null;
    this.prev = { x: this.sim.x, z: this.sim.z };
    const res = stepPlayer(this.sim, input, this.weapon, canAct);
    this.sim = res.sim;
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return res;
  }

  reconcile(server: PlayerView, canAct: boolean) {
    this.weapon = server.weapon;
    this.pending = this.pending.filter((i) => i.seq > server.lastSeq);
    let s = readSim(server);
    for (const input of this.pending) s = stepPlayer(s, input, this.weapon, canAct).sim;

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

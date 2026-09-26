import { stepPlayer, type InputMessage, type PlayerView, type Vec2 } from "@bagarre/shared";

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
 * position and re-apply the rest. If client and server agree (the normal case,
 * same function, same inputs) this changes nothing; if they disagree, the
 * server wins and the difference is faded out visually over a few frames.
 */
export class Predictor {
  /** Predicted position after the latest sent input. */
  pos: Vec2 | null = null;
  /** Predicted position one tick earlier, for smooth rendering between ticks. */
  prev: Vec2 = { x: 0, z: 0 };
  private pending: InputMessage[] = [];
  private offset: Vec2 = { x: 0, z: 0 };
  /** Last reconciliation error, for the debug line. */
  lastError = 0;

  /** Applies an input we just sent. `canMove` mirrors the server's rules. */
  apply(input: InputMessage, canMove: boolean) {
    if (!this.pos) return;
    this.prev = this.pos;
    if (canMove) this.pos = stepPlayer(this.pos, input);
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  reconcile(server: PlayerView, canMove: boolean) {
    this.pending = this.pending.filter((i) => i.seq > server.lastSeq);
    let p: Vec2 = { x: server.x, z: server.z };
    if (canMove) for (const input of this.pending) p = stepPlayer(p, input);

    if (!this.pos) {
      this.pos = p;
      this.prev = p;
      return;
    }
    const ex = this.pos.x - p.x;
    const ez = this.pos.z - p.z;
    this.lastError = Math.hypot(ex, ez);
    if (this.lastError > SNAP_DISTANCE) {
      // Teleport (respawn) or a big desync: don't slide across the map.
      this.offset = { x: 0, z: 0 };
      this.prev = p;
    } else if (this.lastError > 0) {
      this.offset = { x: this.offset.x + ex, z: this.offset.z + ez };
      this.prev = { x: this.prev.x - ex, z: this.prev.z - ez };
    }
    this.pos = p;
  }

  /** Position to draw, `alpha` being how far we are into the current tick. */
  render(alpha: number, dtSeconds: number): Vec2 {
    const k = Math.exp(-CORRECTION_DECAY * dtSeconds);
    this.offset = { x: this.offset.x * k, z: this.offset.z * k };
    const cur = this.pos ?? this.prev;
    return {
      x: this.prev.x + (cur.x - this.prev.x) * alpha + this.offset.x,
      z: this.prev.z + (cur.z - this.prev.z) * alpha + this.offset.z,
    };
  }

  get pendingCount() {
    return this.pending.length;
  }
}

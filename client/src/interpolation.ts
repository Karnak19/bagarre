import type { BulletView, PlayerView } from "@bagarre/shared";
import type { Snapshot } from "./net.ts";

const KEEP_MS = 1000;
/** A jump larger than this between two snapshots is a teleport, not motion. */
const TELEPORT_DISTANCE = 4;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Buffer of recent server snapshots. Remote entities are drawn at
 * `now - INTERP_DELAY_MS`, between the two snapshots around that moment, so
 * they move smoothly even though updates only arrive 30 times per second.
 */
export class SnapshotBuffer {
  private snaps: Snapshot[] = [];

  push(s: Snapshot) {
    this.snaps.push(s);
    const cutoff = s.t - KEEP_MS;
    while (this.snaps.length > 2 && this.snaps[0].t < cutoff) this.snaps.shift();
  }

  latest(): Snapshot | undefined {
    return this.snaps[this.snaps.length - 1];
  }

  clear() {
    this.snaps = [];
  }

  /** The two snapshots bracketing `renderTime`, and the blend factor. */
  private bracket(renderTime: number): { a: Snapshot; b: Snapshot; alpha: number } | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    if (renderTime <= this.snaps[0].t) return { a: this.snaps[0], b: this.snaps[0], alpha: 0 };
    for (let i = n - 1; i > 0; i--) {
      const a = this.snaps[i - 1];
      const b = this.snaps[i];
      if (a.t <= renderTime) {
        if (renderTime >= b.t) return { a: b, b, alpha: 0 };
        return { a, b, alpha: (renderTime - a.t) / (b.t - a.t) };
      }
    }
    const last = this.snaps[n - 1];
    return { a: last, b: last, alpha: 0 };
  }

  samplePlayer(id: string, renderTime: number): PlayerView | null {
    const br = this.bracket(renderTime);
    if (!br) return null;
    const pa = br.a.players.get(id);
    const pb = br.b.players.get(id);
    if (!pa || !pb) return pb ?? pa ?? null;
    const jump = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    if (pa.alive !== pb.alive || jump > TELEPORT_DISTANCE) return br.alpha < 0.5 ? pa : pb;
    return {
      ...pb,
      x: lerp(pa.x, pb.x, br.alpha),
      z: lerp(pa.z, pb.z, br.alpha),
      aim: lerpAngle(pa.aim, pb.aim, br.alpha),
    };
  }

  /** Bullets present in both bracketing snapshots, interpolated. */
  sampleBullets(renderTime: number): Map<string, BulletView> {
    const out = new Map<string, BulletView>();
    const br = this.bracket(renderTime);
    if (!br) return out;
    br.b.bullets.forEach((bb, id) => {
      const ba = br.a.bullets.get(id);
      if (!ba) return;
      out.set(id, { ...bb, x: lerp(ba.x, bb.x, br.alpha), z: lerp(ba.z, bb.z, br.alpha) });
    });
    return out;
  }
}

import {
  BULLET_RADIUS,
  DEFAULT_MAP_ID,
  PLAYER_RADIUS,
  bulletId,
  bulletLifeTicks,
  circlesOverlap,
  shotPellets,
  stepBullet,
  mapById,
  weaponDef,
  type BulletSim,
  type MapDef,
  type Vec2,
} from "@bagarre/shared";
import type { Snapshot } from "./net.ts";

interface Predicted {
  seq: number;
  sim: BulletSim;
  prev: Vec2;
  ticksLeft: number;
  /** Stopped flying (wall, range, visual hit, or the server said so). */
  dead: boolean;
  /** The server's copy has been seen. */
  confirmed: boolean;
}

/** Forget ids this many inputs after they were acknowledged and gone from the snapshots. */
const FORGET_AFTER_SEQ = 90;

/**
 * The local player's own bullets, predicted so they appear the instant we
 * fire instead of 100 ms + RTT later.
 *
 * A shot is spawned with the shared `shotPellets` (seeded spread, so the
 * pellets start exactly where the server's will) and stepped with the shared
 * `stepBullet` once per input tick, like the server steps it once per tick.
 * Each predicted bullet carries the same id as the server's bullet
 * (`slot:seq:pellet`). The handover is: we keep drawing OUR copy, whose path is
 * the server's path, and never draw the server's copy of an id we predicted
 * (the server copy is ~RTT + 100 ms behind, drawing both would show a second
 * bullet trailing the first). The server's copy only decides the lifetime:
 *  - acked but never seen: the server refused the shot (or it died on the spot),
 *    so ours is removed;
 *  - seen, then gone: it hit something, so ours is removed if still flying.
 * Ours also stops on a visual hit against where an opponent is drawn, so it
 * doesn't sail through them while the server's verdict is on its way. Damage
 * is never predicted.
 */
export class LocalBullets {
  private bullets = new Map<string, Predicted>();
  /** The map the bullets fly on, the latest snapshot's (see Predictor.map). */
  private map: MapDef = mapById(DEFAULT_MAP_ID);

  /** The server moved to another map: bullets of the old one are dropped, never drawn on the new one. */
  setMap(map: MapDef) {
    this.map = map;
    this.bullets.clear();
  }

  /** Spawns the pellets of a shot fired by input `seq`, and steps them like the server's spawn tick. */
  spawn(slot: number, seq: number, weapon: number, x: number, z: number, aim: number) {
    const life = bulletLifeTicks(weaponDef(weapon));
    shotPellets(weapon, x, z, aim, seq).forEach((sim, i) => {
      this.bullets.set(bulletId(slot, seq, i), {
        seq,
        sim,
        prev: { x: sim.x, z: sim.z },
        ticksLeft: life,
        dead: false,
        confirmed: false,
      });
    });
  }

  /** One input tick. `opponents` is where the living opponents are drawn right now. */
  step(opponents: readonly Vec2[]) {
    for (const b of this.bullets.values()) {
      if (b.dead) continue;
      b.prev = { x: b.sim.x, z: b.sim.z };
      const alive = stepBullet(
        this.map,
        b.sim,
        (x, z) => opponents.some((o) => circlesOverlap(x, z, BULLET_RADIUS, o.x, o.z, PLAYER_RADIUS)),
      );
      b.ticksLeft--;
      if (!alive || b.ticksLeft <= 0) b.dead = true;
    }
  }

  /** Match predicted bullets against a fresh snapshot. `lastSeq` = our last acknowledged input. */
  reconcile(s: Snapshot, lastSeq: number) {
    for (const [id, b] of this.bullets) {
      if (b.seq > lastSeq) continue; // server hasn't processed that input yet
      const onServer = s.bullets.has(id);
      if (onServer) b.confirmed = true;
      else {
        b.dead = true;
        if (lastSeq - b.seq > FORGET_AFTER_SEQ) this.bullets.delete(id);
      }
    }
  }

  /** True for server bullets we are already drawing (or drew) ourselves. */
  owns(id: string): boolean {
    return this.bullets.has(id);
  }

  clear() {
    this.bullets.clear();
  }

  /** Visible predicted bullets, blended between ticks like the local player. */
  render(alpha: number, slot: number, out: Map<string, { x: number; z: number; slot: number; owner?: string }>, owner?: string) {
    for (const [id, b] of this.bullets) {
      if (b.dead) continue;
      out.set(id, {
        x: b.prev.x + (b.sim.x - b.prev.x) * alpha,
        z: b.prev.z + (b.sim.z - b.prev.z) * alpha,
        slot,
        owner,
      });
    }
  }
}

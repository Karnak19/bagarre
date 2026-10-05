// Endgame and sight helpers for the battle royale maps, shared by the layout
// tests (src/maps/royale/royale-maps.test.ts) and the map preview
// (scripts/royale.preview.ts).
//
// Run directly (`bun scripts/royale-maps.ts` in packages/shared), it prints
// each map's stats: the closest two starts, the worst endgame circle, the
// tight and open floor shares. The pass/fail rules are the tests'.

import { ZONE, ticks } from "../src/constants.ts";
import { ROYALE_MAPS, type RoyaleMapDef } from "../src/maps/royale/index.ts";
import type { ZoneView } from "../src/protocol.ts";
import { zoneAt, type Circle } from "../src/royale.ts";
import { cellOf, cellPt, circleHitsBox, walkGrid, type Grid } from "./analyze.ts";
import { ffaSight, OPEN_M2, TIGHT_M2, type FfaSight } from "./ffa/analyze.ts";

/**
 * The endgame the cover test looks at: the zone this many seconds before it
 * closes. The real zone (pickZone, ZONE) shrinks linearly from a circle round
 * the whole map (r ~108 m on Ironvale's 150 m) to nothing over ZONE.close -
 * ZONE.wait = 360 s, about 0.3 m/s, while its centre slides from the map's
 * centre to the final one. 30 s before the end its radius is about 9 m
 * (18 m wide, the issue's "last 10 to 15 m" and a little more), and it is
 * the last circle two or three players still fight in: 20 s before, 6 m, is
 * a shootout at arm's length.
 */
export const LATE_SECONDS = 30;

/** The real zone's circle LATE_SECONDS before it closes, on a match whose final centre is (x, z) (pickZone's circles, zoneAt's shrink). */
export function lateCircle(m: RoyaleMapDef, x: number, z: number): Circle {
  const shrink = ZONE.close - ZONE.wait;
  const zone: ZoneView = { x0: 0, z0: 0, x1: x, z1: z, r0: Math.hypot(m.halfX, m.halfZ) + ZONE.margin, r1: 0, start: 0, end: ticks(shrink) };
  return zoneAt(zone, ticks(shrink - LATE_SECONDS))!;
}

/** The late circle's radius on a map (the same for every centre). */
export const lateRadius = (m: RoyaleMapDef) => lateCircle(m, 0, 0).r;

/** Every possible final circle has at least this many boxes in it... */
export const FINAL_MIN_BOXES = 2;
/** ...and at least this share of it is floor a player can stand on. */
export const FINAL_MIN_FLOOR = 0.5;
/** Walk grid cell for the flood fill and the floor share, metres. */
export const CELL = 0.2;
const EPS = 1e-6;

/** The late circle round one final centre: how many boxes it holds, and its share of standable floor. */
export interface EndgameCircle {
  /** The final centre, on the 1 m grid. */
  cx: number;
  cz: number;
  /** The circle LATE_SECONDS before it closes there. */
  late: Circle;
  boxes: number;
  floor: number;
}

/** The late circle for every final centre on a 1 m grid inside the map's final zone rectangle (`g` is the map's walkGrid). */
export function endgameCover(m: RoyaleMapDef, g: Grid): EndgameCircle[] {
  const z = m.royale.zone;
  const r = lateRadius(m);
  const rc = Math.ceil(r / g.cell) + 1;
  const out: EndgameCircle[] = [];
  for (let cz = Math.ceil(z.z0); cz <= z.z1 + EPS; cz++)
    for (let cx = Math.ceil(z.x0); cx <= z.x1 + EPS; cx++) {
      const late = lateCircle(m, cx, cz);
      let boxes = 0;
      for (const o of m.obstacles) if (circleHitsBox(late.x, late.z, r, o)) boxes++;
      const c0 = cellOf(g, late);
      const i0 = c0 % g.nx;
      const j0 = (c0 - i0) / g.nx;
      let cells = 0;
      let open = 0;
      for (let dj = -rc; dj <= rc; dj++)
        for (let di = -rc; di <= rc; di++) {
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
          const p = cellPt(g, j * g.nx + i);
          if ((p.x - late.x) ** 2 + (p.z - late.z) ** 2 > r * r) continue;
          cells++;
          if (g.walk[j * g.nx + i]) open++;
        }
      out.push({ cx, cz, late, boxes, floor: cells ? open / cells : 0 });
    }
  return out;
}

/** Sight samples every this many metres for the tight/open shares (1 m, as on the FFA maps, takes ~25 s at 90 m; 2 m is within 0.2 pp of it). */
const SIGHT_STEP = 2;

/**
 * Tight and open floor, as the FFA validator defines them (scripts/ffa/analyze.ts):
 * tight floor sees less than TIGHT_M2 of floor within the longest weapon's
 * range (shotgun and SMG ground); open floor sees at least OPEN_M2 of floor
 * beyond rifle range (sniper lanes). Reported (this script's table, the preview), not tested.
 */
export function tightOpen(m: RoyaleMapDef): { sl: FfaSight; tight: Uint8Array; tightShare: number; openShare: number } {
  const sl = ffaSight(m, SIGHT_STEP);
  const n = sl.pts.length;
  const cell = SIGHT_STEP * SIGHT_STEP;
  const tight = new Uint8Array(n);
  let t = 0;
  let o = 0;
  for (let i = 0; i < n; i++) {
    if (sl.camp[i] * n * cell < TIGHT_M2) {
      tight[i] = 1;
      t++;
    }
    if (sl.far[i] * cell >= OPEN_M2) o++;
  }
  return { sl, tight, tightShare: n ? t / n : 0, openShare: n ? o / n : 0 };
}

if (import.meta.main) {
  const f = (n: number, d = 1) => n.toFixed(d);
  console.log("map        size   boxes  starts  crates  min start gap  worst endgame circle           tight  open   time");
  for (const m of ROYALE_MAPS) {
    const t0 = performance.now();
    let minStart = Infinity;
    for (let i = 0; i < m.spawns.length; i++)
      for (let j = i + 1; j < m.spawns.length; j++) minStart = Math.min(minStart, Math.hypot(m.spawns[i].x - m.spawns[j].x, m.spawns[i].z - m.spawns[j].z));
    // How close to failing: the tighter of the two measures, as a share of its limit.
    const score = (c: EndgameCircle) => Math.min(c.boxes / FINAL_MIN_BOXES, c.floor / FINAL_MIN_FLOOR);
    const worst = endgameCover(m, walkGrid(m, CELL)).reduce((a, b) => (score(b) < score(a) ? b : a));
    const { tightShare, openShare } = tightOpen(m);
    console.log(
      [
        m.id.padEnd(10),
        `${2 * m.halfX}x${2 * m.halfZ}`.padEnd(6),
        String(m.obstacles.length).padEnd(6),
        String(m.spawns.length).padEnd(7),
        String(m.royale.crates.length).padEnd(7),
        `${f(minStart)} m`.padEnd(14),
        `(${worst.cx}, ${worst.cz}) ${worst.boxes} boxes ${f(worst.floor * 100, 0)}% floor`.padEnd(30),
        `${f(tightShare * 100)}%`.padEnd(6),
        `${f(openShare * 100)}%`.padEnd(6),
        `${f((performance.now() - t0) / 1000, 2)} s`,
      ].join(" "),
    );
  }
}

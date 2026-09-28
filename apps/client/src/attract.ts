// The menu's background: the game's own scene on a random map, two
// characters in a stand-off (two different random skins, drawn once per page
// load), and the camera slowly circling them. It uses the same
// GameScene, arena and PlayerMesh as a match; `stop()` removes and frees the
// two characters, and a match that follows simply replaces the map.

import { MAPS, PLAYER_RADIUS, circleOverlapsBox, randomSkin, type MapDef, type Vec2 } from "@bagarre/shared";
import { setListener } from "./audio.ts";
import { GameScene, PLAYER_COLORS, PlayerMesh } from "./scene.ts";

/** One full turn of the camera, in seconds. */
const ORBIT_PERIOD = 140;
/** Half the distance between the two soldiers, metres. */
const HALF_GAP = 2.1;
/** How far each one side-steps, and the period of that sway. */
const SWAY = 0.7;
const SWAY_PERIOD = 7;

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A spot where both soldiers (and their sway) stand clear of cover, as near the middle as possible. */
function standoff(map: MapDef): { c: Vec2; dir: number } {
  const clear = (x: number, z: number) => {
    const r = PLAYER_RADIUS + 0.45;
    if (Math.abs(x) > map.halfX - r || Math.abs(z) > map.halfZ - r) return false;
    if (map.obstacles.some((o) => circleOverlapsBox(x, z, r, o))) return false;
    return map.decor.every((d) => Math.hypot(d.x - x, d.z - z) > 1.6 * (d.scale ?? 1));
  };
  const fits = (cx: number, cz: number, dir: number) => {
    const ux = Math.cos(dir);
    const uz = Math.sin(dir);
    for (const side of [-1, 1])
      for (const sway of [-SWAY, 0, SWAY]) {
        const x = cx + side * ux * HALF_GAP - uz * sway;
        const z = cz + side * uz * HALF_GAP + ux * sway;
        if (!clear(x, z)) return false;
      }
    return true;
  };
  for (let ring = 0; ring <= 12; ring++) {
    const steps = ring === 0 ? 1 : ring * 8;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const cx = Math.cos(a) * ring;
      const cz = Math.sin(a) * ring;
      for (const dir of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) if (fits(cx, cz, dir)) return { c: { x: cx, z: cz }, dir };
    }
  }
  return { c: { x: 0, z: 0 }, dir: 0 };
}

export class Attract {
  private meshes: PlayerMesh[] = [];
  private spot: { c: Vec2; dir: number } = { c: { x: 0, z: 0 }, dir: 0 };
  private t0 = 0;
  private lastMapId = "";
  running = false;

  /**
   * The two skins shown. Kept for the page's life: every visit to the menu
   * shows the same two (on another map), so going back and forth fetches
   * nothing new and uploads nothing new.
   */
  private readonly skins: [string, string];

  constructor(private scene: GameScene) {
    const a = randomSkin();
    this.skins = [a, randomSkin([a])];
  }

  /** Picks a map (never the one shown last time) and puts two soldiers on it. */
  start(now: number) {
    if (this.running) return;
    this.running = true;
    const choices = MAPS.filter((m) => m.id !== this.lastMapId && m.id !== this.scene.map?.id);
    const map = choices[Math.floor(Math.random() * choices.length)] ?? MAPS[0];
    this.lastMapId = map.id;
    this.scene.setMap(map);
    this.scene.clearProjectiles();
    this.spot = standoff(map);
    this.meshes = [0, 1].map((slot) => {
      const m = new PlayerMesh(PLAYER_COLORS[slot], false, slot, this.skins[slot]);
      this.scene.addPlayer(m);
      return m;
    });
    this.t0 = now;
    setListener(this.spot.c.x, this.spot.c.z);
    this.frame(now);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    for (const m of this.meshes) {
      this.scene.removePlayer(m);
      m.dispose();
    }
    this.meshes = [];
  }

  /** Where the camera looks: a bit off-centre on wide screens, to leave room for the menu on the left. */
  private framing(): { viewHeight: number; shiftX: number } {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 760) return { viewHeight: 15, shiftX: 0 };
    return { viewHeight: h < 640 ? 13 : 14, shiftX: 0.16 };
  }

  frame(now: number) {
    if (!this.running) return;
    const still = reducedMotion();
    const t = (now - this.t0) / 1000;
    const { c, dir } = this.spot;
    const ux = Math.cos(dir);
    const uz = Math.sin(dir);
    const pos = this.meshes.map((_, i) => {
      const side = i === 0 ? -1 : 1;
      // Opposite phases, so they circle-strafe the stand-off rather than mirror each other.
      const sway = still ? 0 : Math.sin((t / SWAY_PERIOD) * Math.PI * 2 + i * Math.PI * 0.6) * SWAY;
      return { x: c.x + side * ux * HALF_GAP - uz * sway, z: c.z + side * uz * HALF_GAP + ux * sway };
    });
    this.meshes.forEach((m, i) => {
      const me = pos[i];
      const them = pos[1 - i];
      m.set(me.x, me.z, Math.atan2(them.z - me.z, them.x - me.x), true, i === 0 ? 1 : 0);
      m.update(now);
    });

    const f = this.framing();
    const yaw = Math.PI / 4 + (still ? 0 : (t / ORBIT_PERIOD) * Math.PI * 2);
    this.scene.setView(yaw, f.viewHeight, f.shiftX);
    this.scene.follow(c.x, c.z, 0, true);
  }
}

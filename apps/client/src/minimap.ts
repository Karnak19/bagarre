// The free-for-all minimap: a small canvas in a corner, drawn by the frame
// loop (never by React). It shows the map's zones (tinted), the cover, the
// landmarks, your position and facing, and enemies only when they fire: a
// dot where the shot came from, fading over PING_MS. Staying quiet keeps you
// hidden (see docs/ffa-maps.md, "Finding each other").
//
// React only mounts the <canvas> and hands it over with `attach()`. The
// static layer (zones, cover, labels) is drawn once per map into an offscreen
// canvas; each frame only copies it and draws the few dots, and at most
// every other frame.

import type { FfaMapDef, MapDef } from "@bagarre/shared";
import { PLAYER_CSS_COLORS } from "./scene.ts";

/** How long a shot stays on the minimap, fading out. */
export const PING_MS = 1500;
/** Redraws at most this often. */
const FRAME_MS = 1000 / 30;

export interface MinimapPing {
  x: number;
  z: number;
  slot: number;
  /** performance.now() of the shot. */
  at: number;
}

const isFfa = (m: MapDef | null): m is FfaMapDef => !!m && (m as Partial<FfaMapDef>).mode === "ffa";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export class Minimap {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private base: HTMLCanvasElement | null = null;
  private baseKey = "";
  private map: FfaMapDef | null = null;
  private pings: MinimapPing[] = [];
  private lastDraw = 0;
  /** CSS pixels of the canvas side, and the device pixel ratio it was sized for. */
  private size = 0;
  private dpr = 1;

  /** Called by the React component with its canvas (null on unmount). */
  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext("2d") ?? null;
    this.baseKey = "";
  }

  get attached(): boolean {
    return !!this.canvas;
  }

  /** The map on screen (null: nothing to draw, e.g. a duel map). */
  setMap(map: MapDef | null) {
    const next = isFfa(map) ? map : null;
    if (next === this.map) return;
    this.map = next;
    this.pings.length = 0;
    this.baseKey = "";
  }

  /** An enemy fired from (x, z). */
  ping(x: number, z: number, slot: number, at: number) {
    // One dot per shooter: a new shot replaces the older one.
    const i = this.pings.findIndex((p) => p.slot === slot);
    if (i >= 0) this.pings.splice(i, 1);
    this.pings.push({ x, z, slot, at });
  }

  clear() {
    this.pings.length = 0;
  }

  /** Per frame, from the match. `me` is our drawn position and aim (null: dead or not spawned). */
  draw(now: number, me: { x: number; z: number; aim: number; slot: number; alive: boolean } | null) {
    const { canvas, ctx, map } = this;
    if (!canvas || !ctx || !map) return;
    if (now - this.lastDraw < FRAME_MS) return;
    this.lastDraw = now;
    this.fit(canvas);
    const key = `${map.id}:${this.size}:${this.dpr}`;
    if (key !== this.baseKey || !this.base) {
      this.base = this.drawBase(map);
      this.baseKey = key;
    }
    const s = this.size;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);
    ctx.drawImage(this.base, 0, 0, s, s);

    const toPx = this.projector(map);
    // Enemy shots, fading.
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      const age = now - p.at;
      if (age >= PING_MS) {
        this.pings.splice(i, 1);
        continue;
      }
      const a = 1 - age / PING_MS;
      const [px, py] = toPx(p.x, p.z);
      ctx.globalAlpha = a;
      ctx.fillStyle = PLAYER_CSS_COLORS[p.slot % PLAYER_CSS_COLORS.length];
      ctx.beginPath();
      ctx.arc(px, py, 3 + 3 * (1 - a), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a * 0.6;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // You: a dot in your colour with a facing wedge.
    if (me) {
      const [px, py] = toPx(me.x, me.z);
      const [fx, fy] = toPx(me.x + Math.cos(me.aim) * 6, me.z + Math.sin(me.aim) * 6);
      const dir = Math.atan2(fy - py, fx - px);
      ctx.globalAlpha = me.alive ? 1 : 0.4;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, 14, dir - 0.45, dir + 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = PLAYER_CSS_COLORS[me.slot % PLAYER_CSS_COLORS.length];
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** Sizes the backing store to the canvas' CSS size. */
  private fit(canvas: HTMLCanvasElement) {
    const size = Math.round(canvas.clientWidth) || 150;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (size === this.size && dpr === this.dpr && canvas.width === Math.round(size * dpr)) return;
    this.size = size;
    this.dpr = dpr;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
  }

  /**
   * World (x, z) to canvas pixels. The minimap is turned like the iso camera
   * (45°), so "up" on the minimap is "up" on screen: the -x/-z corner is at
   * the top. A square of side `size` holds the rotated map.
   */
  private projector(map: FfaMapDef): (x: number, z: number) => [number, number] {
    const s = this.size;
    const c = Math.SQRT1_2;
    // Rotated extent: |u| <= (halfX + halfZ) * c on both axes.
    const ext = (map.halfX + map.halfZ) * c;
    const k = (s / 2 - 2) / ext;
    return (x, z) => {
      // Screen right is +x/-z, screen up is -x/-z.
      const u = (x - z) * c;
      const v = (x + z) * c;
      return [s / 2 + u * k, s / 2 + v * k];
    };
  }

  /** Zones, cover, walls and landmark labels: drawn once per map (and size). */
  private drawBase(map: FfaMapDef): HTMLCanvasElement {
    const s = this.size;
    const out = document.createElement("canvas");
    out.width = Math.round(s * this.dpr);
    out.height = Math.round(s * this.dpr);
    const g = out.getContext("2d")!;
    g.scale(this.dpr, this.dpr);
    const toPx = this.projector(map);
    const quad = (x0: number, z0: number, x1: number, z1: number) => {
      const pts = [toPx(x0, z0), toPx(x1, z0), toPx(x1, z1), toPx(x0, z1)];
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
    };
    // Floor.
    quad(-map.halfX, -map.halfZ, map.halfX, map.halfZ);
    g.fillStyle = "rgba(20, 22, 28, 0.82)";
    g.fill();
    // Zones, tinted (the first match wins where they overlap: draw in reverse).
    for (let i = map.zones.length - 1; i >= 0; i--) {
      const z = map.zones[i];
      quad(Math.max(z.x0, -map.halfX), Math.max(z.z0, -map.halfZ), Math.min(z.x1, map.halfX), Math.min(z.z1, map.halfZ));
      g.fillStyle = hex(z.tint);
      g.globalAlpha = 0.28;
      g.fill();
    }
    g.globalAlpha = 1;
    // Cover.
    g.fillStyle = "rgba(8, 9, 12, 0.85)";
    for (const b of map.obstacles) {
      quad(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2);
      g.fill();
    }
    // Outline.
    quad(-map.halfX, -map.halfZ, map.halfX, map.halfZ);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 1;
    g.stroke();
    // Landmarks.
    g.font = "600 8px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const l of map.landmarks) {
      const [px, py] = toPx(l.x, l.z);
      g.fillStyle = "rgba(255, 217, 138, 0.9)";
      g.beginPath();
      g.arc(px, py, 1.6, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = "rgba(0,0,0,0.75)";
      g.strokeText(l.name, px, py - 6);
      g.fillStyle = "rgba(255, 240, 210, 0.92)";
      g.fillText(l.name, px, py - 6);
    }
    return out;
  }
}

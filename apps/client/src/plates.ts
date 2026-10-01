// Name plates: the name and a health bar over each character's head, and
// the perk held as one glyph after the name (still shown with "Show names"
// off, alone over the bar), so everyone can tell who dashes twice.
//
// Everything is one instanced mesh, one draw call for every plate: each quad
// (a bar's background, its fill, the trailing damage segment, the shield
// strip, the name, the "reconnecting" dots) is one instance of a unit quad.
// The vertex shader places a quad at its player's head, projected to the
// screen and rounded to a whole device pixel, then offset by a rectangle
// given in CSS pixels. So plates keep the same size on screen whatever the
// zoom (the spectator's overview included) and the text maps one texel to
// one pixel, crisp at any devicePixelRatio.
//
// Textures: one canvas atlas for the whole scene. Each pool slot owns one row
// of it, where its name is drawn in white with a dark outline; the shader
// tints it with the player's colour, so the row is only redrawn when the name
// itself changes. A small white square in the last row is what the bars
// sample, so bars are plain scaled quads, never a texture redraw.
//
// Plates are drawn after the world (high renderOrder) with no depth test:
// cover never hides them. Smoke does: a player hidden from us by smoke (or
// see-through for a spectator) gets `fade` 0 (or less than 1) from match.ts,
// and their quads are skipped (or dimmed) in the one instanced mesh.
// Nothing here allocates per frame.

import * as THREE from "three";
import { HEAD_Y } from "./character.ts";

/** Most plates at once (a 4v4 is 8; this leaves room for players coming and going). */
const CAPACITY = 16;
/** Quads per plate: background, trail, fill, shield, name, dots. */
const QUADS = 6;
const MAX_INSTANCES = CAPACITY * QUADS;

/**
 * Height of the plate's anchor above the ground, metres: a fixed height above
 * the characters' head bone (every skin is scaled to put it at HEAD_Y), which
 * clears a bare head (about 1.7 m) and all but the tallest hat (the elf's). Never a bounding box: a tall
 * hat doesn't lift the plate.
 */
const ANCHOR_Y = HEAD_Y + 0.95;
// Layout, in CSS pixels, y up from the anchor's screen point.
const BAR_W = 54;
const BAR_H = 5;
const BORDER = 1;
/** Bottom of the bar's background above the anchor. */
const BAR_Y = 2;
const SHIELD_H = 2;
// The atlas.
const ROW_W = 176;
const ROW_H = 16;
const FONT = "600 11px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
/** Room round the text for its outline, CSS px. */
const PAD = 3;

/** How fast the bar follows a hit down (1/s), how long the trail waits, how fast it then falls (fraction/s). */
const FILL_RATE = 22;
const TRAIL_HOLD = 0.35;
const TRAIL_SPEED = 1.1;
/** Alpha of a reconnecting player's plate. */
const DIM = 0.4;

const SHIELD_RGB = [0.62, 0.9, 1] as const;
const TRAIL_RGB = [1, 0.95, 0.8] as const;
const BG_RGBA = [0.04, 0.05, 0.07, 0.78] as const;

/** Each paint index's colour as sRGB 0..1: the shader writes it to the canvas as is, so it matches the CSS. */
function paintRgb(palette: readonly string[]): Float32Array {
  const out = new Float32Array(palette.length * 3);
  palette.forEach((c, i) => {
    const n = parseInt(c.slice(1), 16);
    out[i * 3] = ((n >> 16) & 255) / 255;
    out[i * 3 + 1] = ((n >> 8) & 255) / 255;
    out[i * 3 + 2] = (n & 255) / 255;
  });
  return out;
}

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aRect; // x, y, width, height in CSS px from the anchor's screen point
attribute vec4 aUv;   // u0, v0, u1, v1
attribute vec4 aColor;
uniform vec2 uRes;
uniform float uDpr;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(aCenter, 1.0);
  vec2 px = floor((clip.xy / clip.w * 0.5 + 0.5) * uRes + 0.5);
  px += floor((aRect.xy + position.xy * aRect.zw) * uDpr + 0.5);
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  vUv = mix(aUv.xy, aUv.zw, position.xy);
  vColor = aColor;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = t * vec4(vColor.rgb * vColor.a, vColor.a);
}`;

interface Plate {
  /** Pool slot, also the atlas row. */
  readonly index: number;
  id: string;
  /** The name and perk badge drawn in this slot's atlas row (`label`'s key), and its drawn width (CSS px). */
  drawnName: string;
  drawnBadge: string;
  nameW: number;
  /** `Plates.frame` when last set: a plate not set since the last draw is hidden. */
  frame: number;
  x: number;
  z: number;
  paint: number;
  /** Target HP and shield, 0..1. */
  hp: number;
  shield: number;
  /** What the bar shows: the fill easing down to `hp`, and the trailing damage segment. */
  shown: number;
  trail: number;
  trailHold: number;
  alive: boolean;
  connected: boolean;
  /** The atlas row (name, perk badge, or both) is drawn over the bar. */
  showName: boolean;
  /** Smoke: 1 drawn as usual, 0 hidden (an enemy in smoke), in between see-through (a spectator watching one). */
  fade: number;
  /** Set on (re)spawn: the bar starts from the current HP, no animation. */
  snap: boolean;
}

export interface PlateDebug {
  id: string;
  visible: boolean;
  /** The name as shown, "" when no name is drawn (the local player, "Show names" off). */
  name: string;
  /** The perk badge as shown (a glyph), "" with none. */
  badge: string;
  hp: number;
  shield: number;
  dimmed: boolean;
  /** Smoke hides it from us (client-side only, see smokeVeil), or fades it (spectators). */
  hidden: boolean;
  faded: boolean;
}

export class Plates {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private aCenter: THREE.InstancedBufferAttribute;
  private aRect: THREE.InstancedBufferAttribute;
  private aUv: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private pool: Plate[] = [];
  private free: Plate[] = [];
  private byId = new Map<string, Plate>();
  /** Counts draws; see Plate.frame. */
  private frame = 0;
  private n = 0;
  // UVs of the white square the bars sample, and of the dots.
  private whiteU = 0;
  private whiteV = 0;
  private dotsU0 = 0;
  private dotsU1 = 0;
  private dotsV0 = 0;
  private dotsV1 = 0;
  private dotsW = 0;
  private res = new THREE.Vector2();
  private paints: Float32Array;

  /** `palette`: the CSS colour of each paint index (scene.ts' PLAYER_CSS_COLORS). */
  constructor(renderer: THREE.WebGLRenderer, palette: readonly string[]) {
    this.paints = paintRgb(palette);
    this.dpr = renderer.getPixelRatio();
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.ceil(ROW_W * this.dpr);
    this.canvas.height = Math.ceil(ROW_H * (CAPACITY + 1) * this.dpr);
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.premultiplyAlpha = true;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.drawSpecialRow();

    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aCenter = attr(3);
    this.aRect = attr(4);
    this.aUv = attr(4);
    this.aColor = attr(4);
    this.geo.setAttribute("aCenter", this.aCenter);
    this.geo.setAttribute("aRect", this.aRect);
    this.geo.setAttribute("aUv", this.aUv);
    this.geo.setAttribute("aColor", this.aColor);
    this.geo.instanceCount = 0;

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: this.texture }, uRes: { value: this.res }, uDpr: { value: this.dpr } },
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    this.mesh.visible = false;

    for (let i = 0; i < CAPACITY; i++) {
      const p: Plate = {
        index: i,
        id: "",
        drawnName: "",
        drawnBadge: "",
        nameW: 0,
        frame: -1,
        x: 0,
        z: 0,
        paint: 0,
        hp: 1,
        shield: 0,
        shown: 1,
        trail: 1,
        trailHold: 0,
        alive: true,
        connected: true,
        showName: true,
        fade: 1,
        snap: true,
      };
      this.pool.push(p);
      this.free.push(p);
    }
    // Hand out slot 0 first.
    this.free.reverse();
  }

  /** The last atlas row: a white square (the bars) and the "reconnecting" dots. */
  private drawSpecialRow() {
    const { ctx, dpr } = this;
    const top = CAPACITY * ROW_H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, top, 8, 8);
    ctx.font = FONT;
    const dotsX = 12;
    this.dotsW = Math.ceil(ctx.measureText("…").width) + PAD * 2;
    this.textAt("…", dotsX + PAD, top);
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    this.whiteU = 4 / W;
    this.whiteV = 1 - (top + 4) / H;
    this.dotsU0 = dotsX / W;
    this.dotsU1 = (dotsX + this.dotsW) / W;
    this.dotsV0 = 1 - (top + ROW_H) / H;
    this.dotsV1 = 1 - top / H;
  }

  /** White text with a dark outline, left edge at x, in the row whose top is y (CSS px). */
  private textAt(text: string, x: number, y: number) {
    const { ctx } = this;
    ctx.font = FONT;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(text, x, y + ROW_H / 2 + 0.5);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x, y + ROW_H / 2 + 0.5);
  }

  /**
   * Draws `name` and the perk `badge` after it in the plate's atlas row (only
   * when either changed). A long name is cut, never the badge. Either may be "".
   */
  private drawName(p: Plate, name: string, badge: string) {
    const { ctx, dpr } = this;
    p.drawnName = name;
    p.drawnBadge = badge;
    const top = p.index * ROW_H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, top, ROW_W, ROW_H);
    ctx.font = FONT;
    let text = name;
    const tail = badge ? (name ? ` ${badge}` : badge) : "";
    const max = ROW_W - PAD * 2 - (tail ? ctx.measureText(tail).width : 0);
    if (ctx.measureText(text).width > max) {
      while (text.length > 1 && ctx.measureText(`${text}…`).width > max) text = text.slice(0, -1);
      text = `${text}…`;
    }
    text += tail;
    p.nameW = text ? Math.ceil(ctx.measureText(text).width) + PAD * 2 : 0;
    if (text) this.textAt(text, PAD, top);
    this.texture.needsUpdate = true;
  }

  /**
   * This frame's state of one player's plate. `x`, `z`: where their body is
   * drawn (predicted for us, interpolated for the others). `hp`, `shield`:
   * fractions 0..1. `showName` false draws the bar alone, with the perk
   * `badge` (a glyph, "" for none) over it if there is one.
   */
  set(id: string, x: number, z: number, name: string, paint: number, hp: number, shield: number, alive: boolean, connected: boolean, showName: boolean, fade = 1, badge = "") {
    let p = this.byId.get(id);
    if (!p) {
      p = this.free.pop();
      if (!p) return; // More players than plates: they go without.
      p.id = id;
      p.snap = true;
      this.byId.set(id, p);
    }
    // The row holds what is shown: the name only when names are on.
    const shownName = showName ? name : "";
    if (p.drawnName !== shownName || p.drawnBadge !== badge) this.drawName(p, shownName, badge);
    hp = Math.min(1, Math.max(0, hp));
    // Back from the dead, or healed: snap. Hit: the fill eases down and the trail waits.
    if (alive && (!p.alive || hp > p.hp)) p.snap = true;
    else if (hp < p.hp) p.trailHold = TRAIL_HOLD;
    p.frame = this.frame;
    p.x = x;
    p.z = z;
    p.paint = paint;
    p.hp = hp;
    p.shield = Math.min(1, Math.max(0, shield));
    p.alive = alive;
    p.connected = connected;
    p.showName = showName || badge !== "";
    p.fade = Math.min(1, Math.max(0, fade));
  }

  /** The player left: their plate goes back to the pool. */
  release(id: string) {
    const p = this.byId.get(id);
    if (!p) return;
    this.byId.delete(id);
    p.id = "";
    p.frame = -1;
    this.free.push(p);
  }

  private visible(p: Plate) {
    return p.frame === this.frame && p.alive && p.fade > 0;
  }

  /** Animates the bars and writes every visible plate's quads. Call once per draw, before rendering. */
  prepare(renderer: THREE.WebGLRenderer, dt: number) {
    renderer.getDrawingBufferSize(this.res);
    this.n = 0;
    const k = 1 - Math.exp(-FILL_RATE * dt);
    for (const p of this.pool) {
      if (!p.id) continue;
      if (p.snap) {
        p.shown = p.trail = p.hp;
        p.trailHold = 0;
        p.snap = false;
      } else {
        p.shown += (p.hp - p.shown) * k;
        if (Math.abs(p.shown - p.hp) < 0.002) p.shown = p.hp;
        if (p.trailHold > 0) p.trailHold -= dt;
        else p.trail -= TRAIL_SPEED * dt;
        if (p.trail < p.shown) p.trail = p.shown;
      }
      if (this.visible(p)) this.write(p);
    }
    this.frame++;
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      this.aCenter.needsUpdate = true;
      this.aRect.needsUpdate = true;
      this.aUv.needsUpdate = true;
      this.aColor.needsUpdate = true;
    }
  }

  private write(p: Plate) {
    const a = (p.connected ? 1 : DIM) * p.fade;
    const c = (p.paint % (this.paints.length / 3)) * 3;
    const r = this.paints[c];
    const g = this.paints[c + 1];
    const b = this.paints[c + 2];
    const left = -BAR_W / 2;
    const shieldH = p.shield > 0 ? SHIELD_H + 1 : 0;
    const barBottom = BAR_Y + BORDER + shieldH;
    // Background, round the bar and the shield strip under it.
    this.bar(p, left - BORDER, BAR_Y, BAR_W + BORDER * 2, BAR_H + BORDER * 2 + shieldH, BG_RGBA[0], BG_RGBA[1], BG_RGBA[2], BG_RGBA[3] * a);
    if (p.trail > p.shown) this.bar(p, left + BAR_W * p.shown, barBottom, BAR_W * (p.trail - p.shown), BAR_H, TRAIL_RGB[0], TRAIL_RGB[1], TRAIL_RGB[2], 0.9 * a);
    if (p.shown > 0) this.bar(p, left, barBottom, BAR_W * p.shown, BAR_H, r, g, b, a);
    if (p.shield > 0) this.bar(p, left, BAR_Y + BORDER, BAR_W * p.shield, SHIELD_H, SHIELD_RGB[0], SHIELD_RGB[1], SHIELD_RGB[2], a);
    const top = barBottom + BAR_H + BORDER;
    const nameOn = p.showName && p.nameW > 0;
    if (nameOn) {
      // The name, in the player's colour lifted toward white so it reads on any floor.
      const W = this.canvas.width / this.dpr;
      const H = this.canvas.height / this.dpr;
      const rowTop = p.index * ROW_H;
      this.quad(p, -Math.round(p.nameW / 2), top, p.nameW, ROW_H, 0, 1 - (rowTop + ROW_H) / H, p.nameW / W, 1 - rowTop / H);
      this.color(0.6 * r + 0.4, 0.6 * g + 0.4, 0.6 * b + 0.4, a);
    }
    if (!p.connected) {
      // "…" after the name, or after the bar without one.
      const x = nameOn ? Math.round(p.nameW / 2) - PAD : BAR_W / 2 + BORDER;
      const y = nameOn ? top : BAR_Y + (BAR_H + BORDER * 2 + shieldH) / 2 - ROW_H / 2;
      this.quad(p, x, y, this.dotsW, ROW_H, this.dotsU0, this.dotsV0, this.dotsU1, this.dotsV1);
      this.color(1, 1, 1, p.fade);
    }
  }

  /** A solid rectangle (it samples the atlas' white square). */
  private bar(p: Plate, x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number) {
    this.quad(p, x, y, w, h, this.whiteU, this.whiteV, this.whiteU, this.whiteV);
    this.color(r, g, b, a);
  }

  private quad(p: Plate, x: number, y: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number) {
    const i = this.n;
    const ctr = this.aCenter.array as Float32Array;
    ctr[i * 3] = p.x;
    ctr[i * 3 + 1] = ANCHOR_Y;
    ctr[i * 3 + 2] = p.z;
    const rect = this.aRect.array as Float32Array;
    rect[i * 4] = x;
    rect[i * 4 + 1] = y;
    rect[i * 4 + 2] = w;
    rect[i * 4 + 3] = h;
    const uv = this.aUv.array as Float32Array;
    uv[i * 4] = u0;
    uv[i * 4 + 1] = v0;
    uv[i * 4 + 2] = u1;
    uv[i * 4 + 3] = v1;
  }

  /** The colour of the quad `quad` just wrote, and moves on to the next. */
  private color(r: number, g: number, b: number, a: number) {
    const i = this.n++;
    const col = this.aColor.array as Float32Array;
    col[i * 4] = r;
    col[i * 4 + 1] = g;
    col[i * 4 + 2] = b;
    col[i * 4 + 3] = a;
  }

  /** Dev: every plate in use, as the player would see it. Allocates; not for the frame loop. */
  debug(): PlateDebug[] {
    const out: PlateDebug[] = [];
    for (const p of this.pool) {
      if (!p.id) continue;
      const visible = p.frame >= this.frame - 1 && p.alive && p.fade > 0;
      out.push({
        id: p.id,
        visible,
        name: visible && p.showName ? p.drawnName : "",
        badge: visible ? p.drawnBadge : "",
        hp: p.hp,
        shield: p.shield,
        dimmed: !p.connected,
        hidden: p.fade <= 0,
        faded: p.fade > 0 && p.fade < 1,
      });
    }
    return out;
  }

}

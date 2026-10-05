// The spectator camera. It drives the game's own orthographic iso camera
// (scene.ts: yaw 45°, pitch atan(1/√2)) through a two-method rig, so wiring
// it is one small adapter (see `sceneRig`). Three modes:
//
// - follow:   glides after a player (the model picks who, see model.ts);
// - overview: zoomed out so the whole map fits the screen (FFA maps are 60 m);
// - free:     panned with WASD / drag, zoomed with the wheel, kept over the map.
//
// Mode changes and target switches glide (exponential smoothing on the
// looked-at point and on the view height); with prefers-reduced-motion they
// cut instead. `update()` allocates nothing: it runs every frame.

import type * as THREE from "three";

/** What the controller needs from the scene's camera. */
export interface SpectatorCameraRig {
  /**
   * Point the camera at the ground point (x, z) with `viewHeight` metres of
   * world visible vertically. Called every frame; the rig skips no-op work.
   */
  apply(x: number, z: number, viewHeight: number): void;
  /** The viewport in CSS pixels (for drag and wheel maths and the overview fit). */
  viewport(): { width: number; height: number };
}

/** The ground area the camera may look at: the map, -halfX..halfX by -halfZ..halfZ. */
export interface CameraBounds {
  halfX: number;
  halfZ: number;
}

export interface SpectatorCameraOptions {
  /** View height in Follow mode, metres. The game's is 22 (scene.ts VIEW_HEIGHT). */
  followViewHeight?: number;
  /** Closest and widest zoom in Free mode, metres of view height. */
  minViewHeight?: number;
  maxViewHeight?: number;
  /** Free-mode keyboard pan speed, in screen heights per second. */
  panSpeed?: number;
  /** Cut instead of glide. Defaults to the prefers-reduced-motion media query. */
  reducedMotion?: boolean;
}

/** The iso pitch: sin(atan(1/√2)) = 1/√3. Ground depth shows on screen shortened by this. */
const SIN_PITCH = 1 / Math.sqrt(3);
const INV_SQRT2 = Math.SQRT1_2;
/** Room round the map in Overview (walls, decor, the list and bar over the edges). */
const OVERVIEW_MARGIN = 1.12;
/** Smoothing rates, 1/s: following a moving player, gliding to a new target, zooming. */
const FOLLOW_RATE = 10;
const GLIDE_RATE = 4.5;
const ZOOM_RATE = 5;
/** A glide ends (back to FOLLOW_RATE) once within this distance of the target, metres. */
const GLIDE_DONE = 0.4;

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Screen motion to ground motion, for the iso view. `sx` is metres to the
 * right on screen, `sy` metres up; writes the ground delta into `out`.
 *
 * Screen right is the ground direction (1, -1)/√2; screen up is (-1, -1)/√2,
 * foreshortened by the pitch (a metre of ground depth is 1/√3 m on screen).
 */
export function screenToGround(sx: number, sy: number, out: { x: number; z: number }) {
  const depth = sy / SIN_PITCH;
  out.x = (sx - depth) * INV_SQRT2;
  out.z = (-sx - depth) * INV_SQRT2;
  return out;
}

/**
 * The view height that fits the whole map on a `width` x `height` screen.
 * The map's corners land on screen at x = (x - z)/√2 and y = -(x + z)/√2 · sin(pitch),
 * so it spans √2 (hx + hz) across and √2 (hx + hz)/√3 down.
 */
export function overviewViewHeight(bounds: CameraBounds, width: number, height: number): number {
  const span = Math.SQRT2 * (bounds.halfX + bounds.halfZ);
  const aspect = height > 0 ? width / height : 1;
  return Math.max(span * SIN_PITCH, span / aspect) * OVERVIEW_MARGIN;
}

export class SpectatorCamera {
  mode: "follow" | "overview" | "free" = "follow";
  /** Where the camera looks now, and where it is heading. */
  readonly x = { now: 0, to: 0 };
  readonly z = { now: 0, to: 0 };
  private viewHeight: number;
  private viewHeightTo: number;
  private bounds: CameraBounds = { halfX: 20, halfZ: 20 };
  private gliding = false;
  private snapNext = true;
  /** Held pan keys, -1..1 on each screen axis (Free mode). */
  private panX = 0;
  private panY = 0;
  private readonly followViewHeight: number;
  private readonly minViewHeight: number;
  private readonly maxViewHeight: number;
  private readonly panSpeed: number;
  private readonly reducedMotion: () => boolean;
  private readonly tmp = { x: 0, z: 0 };

  constructor(
    private rig: SpectatorCameraRig,
    options: SpectatorCameraOptions = {},
  ) {
    this.followViewHeight = options.followViewHeight ?? 22;
    this.minViewHeight = options.minViewHeight ?? 10;
    this.maxViewHeight = options.maxViewHeight ?? 160;
    this.panSpeed = options.panSpeed ?? 0.9;
    const rm = options.reducedMotion;
    this.reducedMotion = rm === undefined ? prefersReducedMotion : () => rm;
    this.viewHeight = this.viewHeightTo = this.followViewHeight;
  }

  /** The map changed (a new match on another map): re-fit and clamp. */
  setBounds(bounds: CameraBounds) {
    this.bounds = { halfX: bounds.halfX, halfZ: bounds.halfZ };
    if (this.mode === "overview") this.frameOverview();
    else this.clampTarget();
  }

  setMode(mode: "follow" | "overview" | "free") {
    if (mode === this.mode) return;
    this.mode = mode;
    this.panX = this.panY = 0;
    if (mode === "overview") this.frameOverview();
    else if (mode === "follow") this.viewHeightTo = this.followViewHeight;
    // Free starts from wherever the camera is, at the current zoom.
    else {
      this.x.to = this.x.now;
      this.z.to = this.z.now;
      this.viewHeightTo = this.clampHeight(this.viewHeight);
    }
    this.startGlide();
  }

  /** The followed player changed: glide to them rather than jump. */
  retarget() {
    if (this.mode === "follow") this.startGlide();
  }

  /** Jump straight to the target on the next update (a first frame, a map change). */
  snap() {
    this.snapNext = true;
  }

  /** Held Free-mode pan keys, as screen axes: x right, y up, each -1..1. */
  setPan(x: number, y: number) {
    this.panX = x;
    this.panY = y;
  }

  /** A drag in Free mode, in CSS pixels (right and down positive, as pointer events give them). */
  dragBy(dxPx: number, dyPx: number) {
    if (this.mode !== "free") return;
    const { height } = this.rig.viewport();
    if (height <= 0) return;
    const metresPerPx = this.viewHeight / height;
    // Dragging moves the world with the pointer: the camera goes the other way.
    screenToGround(-dxPx * metresPerPx, dyPx * metresPerPx, this.tmp);
    this.x.to += this.tmp.x;
    this.z.to += this.tmp.z;
    this.clampTarget();
    // A drag is direct manipulation: no lag behind the pointer.
    this.x.now = this.x.to;
    this.z.now = this.z.to;
  }

  /** A wheel step in Free mode: `deltaY` as WheelEvent gives it (positive zooms out). */
  zoomBy(deltaY: number) {
    if (this.mode !== "free") return;
    const factor = Math.exp(Math.max(-1, Math.min(1, deltaY / 500)));
    this.viewHeightTo = this.clampHeight(this.viewHeightTo * factor);
  }

  get currentViewHeight() {
    return this.viewHeight;
  }

  /**
   * One frame. `targetX` / `targetZ` is the followed player's drawn position
   * (ignored unless `hasTarget` and in Follow mode).
   */
  update(dtSeconds: number, hasTarget: boolean, targetX: number, targetZ: number) {
    const dt = Math.max(0, Math.min(dtSeconds, 0.25));
    if (this.mode === "follow" && hasTarget) {
      this.x.to = targetX;
      this.z.to = targetZ;
    } else if (this.mode === "free" && (this.panX !== 0 || this.panY !== 0)) {
      const step = this.panSpeed * this.viewHeight * dt;
      screenToGround(this.panX * step, this.panY * step, this.tmp);
      this.x.to += this.tmp.x;
      this.z.to += this.tmp.z;
      this.clampTarget();
    }

    const cut = this.snapNext || this.reducedMotion();
    if (cut) {
      this.x.now = this.x.to;
      this.z.now = this.z.to;
      this.viewHeight = this.viewHeightTo;
      this.gliding = false;
      this.snapNext = false;
    } else {
      const rate = this.gliding ? GLIDE_RATE : FOLLOW_RATE;
      const k = 1 - Math.exp(-rate * dt);
      this.x.now += (this.x.to - this.x.now) * k;
      this.z.now += (this.z.to - this.z.now) * k;
      const kz = 1 - Math.exp(-ZOOM_RATE * dt);
      this.viewHeight += (this.viewHeightTo - this.viewHeight) * kz;
      if (Math.abs(this.viewHeightTo - this.viewHeight) < 0.01) this.viewHeight = this.viewHeightTo;
      if (this.gliding && Math.hypot(this.x.to - this.x.now, this.z.to - this.z.now) < GLIDE_DONE) this.gliding = false;
    }
    this.rig.apply(this.x.now, this.z.now, this.viewHeight);
  }

  private startGlide() {
    this.gliding = true;
  }

  private frameOverview() {
    const { width, height } = this.rig.viewport();
    this.x.to = 0;
    this.z.to = 0;
    this.viewHeightTo = overviewViewHeight(this.bounds, width, height);
  }

  private clampHeight(h: number) {
    const { width, height } = this.rig.viewport();
    const widest = Math.min(this.maxViewHeight, overviewViewHeight(this.bounds, width, height));
    return Math.max(this.minViewHeight, Math.min(Math.max(widest, this.minViewHeight), h));
  }

  private clampTarget() {
    const { halfX, halfZ } = this.bounds;
    this.x.to = Math.max(-halfX, Math.min(halfX, this.x.to));
    this.z.to = Math.max(-halfZ, Math.min(halfZ, this.z.to));
  }
}

/**
 * A rig over the game's scene: `follow(x, z, 0, true)` places the camera, and
 * the projection is rewritten here only when the view height or the viewport
 * changed. (GameScene.setView would do it too, but its `resize()` also calls
 * renderer.setSize, too heavy for a zoom that moves every frame; the wiring
 * plan in docs/spectate.md splits that out.)
 */
export function sceneRig(scene: {
  camera: THREE.OrthographicCamera;
  follow(x: number, z: number, dtSeconds: number, snap?: boolean): void;
}): SpectatorCameraRig {
  let lastHeight = -1;
  let lastW = -1;
  let lastH = -1;
  const size = { width: 0, height: 0 };
  return {
    viewport() {
      size.width = window.innerWidth;
      size.height = window.innerHeight;
      return size;
    },
    apply(x, z, viewHeight) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (viewHeight !== lastHeight || w !== lastW || h !== lastH) {
        lastHeight = viewHeight;
        lastW = w;
        lastH = h;
        const aspect = h > 0 ? w / h : 1;
        const cam = scene.camera;
        cam.left = (-viewHeight * aspect) / 2;
        cam.right = (viewHeight * aspect) / 2;
        cam.top = viewHeight / 2;
        cam.bottom = -viewHeight / 2;
        cam.updateProjectionMatrix();
      }
      scene.follow(x, z, 0, true);
    },
  };
}

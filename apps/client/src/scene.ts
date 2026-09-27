import * as THREE from "three";
import {
  BULLET_HEIGHT,
  BULLET_RADIUS,
  GRENADE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  WALL_THICKNESS,
  type GrenadeView,
  type MapDef,
} from "@bagarre/shared";
import { buildArena, disposeArena } from "./arenaView.ts";
import type { Assets } from "./assets.ts";
import { Character } from "./character.ts";
import { Vfx, shieldMaterial } from "./vfx.ts";

/**
 * One colour per seat (slot): orange and blue for the duel's two, then lime,
 * violet, pink and teal for the free-for-all's seats 2-5. The same values are
 * the theme's `--bagarre-p0`..`--bagarre-p5` (ui/theme/bagarre.source.ts), so
 * the HUD, the scoreboard and the minimap match the characters.
 */
export const PLAYER_CSS_COLORS = ["#ff6b4a", "#4ab8ff", "#a6e04a", "#b07cff", "#ff5fae", "#3fd9c6"];
export const PLAYER_COLORS = PLAYER_CSS_COLORS.map((c) => parseInt(c.slice(1), 16));
/** The colour of a seat (slots past the palette wrap round). */
export const playerColor = (slot: number) => PLAYER_COLORS[((slot % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length];

/** Vertical extent of the world visible on screen, in metres. */
const VIEW_HEIGHT = 22;
/**
 * Half the side of the sun's shadow area when it follows the camera. A map
 * that fits in it (every duel map) gets one fixed shadow area over the whole
 * floor; a bigger one (the 60 m FFA maps) gets this square round the point
 * the camera looks at, which covers the screen with some margin. Same 2048
 * shadow map either way, so FFA shadows are as sharp as a duel's.
 */
const SHADOW_FOLLOW_HALF = 24;
/** Distance from the shadow area's centre to the sun, along the sun direction. */
const SUN_DISTANCE = 45;
const CAMERA_DISTANCE = 50;
/**
 * Classic isometric view: 45 degrees of yaw, and a pitch of atan(1/sqrt(2)),
 * about 35.26 degrees. Looking along (-1, -1, -1) gives exactly both.
 */
const GAME_YAW = Math.PI / 4;
const PITCH = Math.atan(1 / Math.SQRT2);
/** The camera's offset from the point it looks at, for a yaw around the vertical axis (GAME_YAW in game). */
function cameraOffset(yaw: number, out = new THREE.Vector3()) {
  const h = Math.cos(PITCH) * CAMERA_DISTANCE;
  return out.set(Math.sin(yaw) * h, Math.sin(PITCH) * CAMERA_DISTANCE, Math.cos(yaw) * h);
}
const REDUCED_MOTION = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Set once, before any PlayerMesh is made (see main.ts). */
let assets: Assets | null = null;
export function setAssets(a: Assets) {
  assets = a;
}

/** The old capsule-and-box body, used when a character model failed to load. */
class PlaceholderBody {
  readonly group = new THREE.Group();
  private bodyMat: THREE.MeshStandardMaterial;
  private flashUntil = 0;

  constructor(color: number) {
    this.bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, flatShading: true });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS, 0.8, 4, 10), this.bodyMat);
    body.position.y = PLAYER_RADIUS + 0.4;
    body.castShadow = true;
    this.group.add(body);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.18, 0.18), new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.4 }));
    gun.position.set(PLAYER_RADIUS + 0.2, BULLET_HEIGHT, 0);
    gun.castShadow = true;
    this.group.add(gun);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.5), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 }));
    visor.position.set(PLAYER_RADIUS - 0.04, 1.35, 0);
    this.group.add(visor);
  }

  setColor(color: number) {
    this.bodyMat.color.set(color);
  }

  flash(at: number) {
    this.flashUntil = at + 90;
  }

  update(now: number, aim: number, alive: boolean) {
    this.group.rotation.y = -aim;
    this.group.visible = alive;
    const on = now < this.flashUntil;
    this.bodyMat.emissive.set(on ? 0xffffff : 0x000000);
    this.bodyMat.emissiveIntensity = on ? 0.8 : 0;
  }
}

export class PlayerMesh {
  readonly group = new THREE.Group();
  readonly slot: number;
  private character: Character | null = null;
  private placeholder: PlaceholderBody | null = null;
  private baseColor: THREE.Color;
  private shield: THREE.Mesh;
  private shieldMat: THREE.ShaderMaterial;
  private rings: THREE.Mesh[] = [];
  private placeholderParts: THREE.Group | null = null;
  private aim = 0;
  private alive = true;
  private weapon = 0;
  private lastT = -1;
  /** Hooked up by GameScene.addPlayer. */
  scene: GameScene | null = null;
  /** Drawn speed above this means a dash (walking is PLAYER_SPEED). */
  private static DASH_SPEED_VISUAL = PLAYER_SPEED * 1.8;
  /** Set when the mesh moved at dash speed since the last update. */
  dashing = false;

  constructor(
    color: number,
    readonly isLocal: boolean,
    slot = Math.max(0, PLAYER_COLORS.indexOf(color)),
  ) {
    this.slot = slot;
    this.baseColor = new THREE.Color(color);
    const gltf = assets?.characters[slot % 2] ?? null;
    if (gltf) {
      try {
        // The kit's colours are dark and flat: tint the main cloth with a
        // slightly darkened player colour so the two sides read at a glance.
        this.character = new Character(gltf, this.baseColor.clone().multiplyScalar(0.8));
        this.group.add(this.character.root);
      } catch (err) {
        console.warn("[scene] character setup failed, using the placeholder", err);
        this.character = null;
      }
    }
    if (!this.character) {
      this.placeholder = new PlaceholderBody(color);
      this.group.add(this.placeholder.group);
    }

    // Ground ring in the player's colour (and a white one for "you").
    const ring = (r0: number, r1: number, c: THREE.ColorRepresentation, opacity: number) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(r0, r1, 40),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.02;
      m.renderOrder = 2;
      this.group.add(m);
      this.rings.push(m);
    };
    ring(PLAYER_RADIUS + 0.02, PLAYER_RADIUS + 0.12, color, 0.75);
    if (isLocal) ring(PLAYER_RADIUS + 0.14, PLAYER_RADIUS + 0.2, 0xffffff, 0.55);
    this.placeholderParts = this.placeholder ? this.placeholder.group : null;

    this.shieldMat = shieldMaterial(this.baseColor);
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.05, 32, 20), this.shieldMat);
    this.shield.position.y = 0.95;
    this.shield.visible = false;
    this.shield.renderOrder = 12;
    this.group.add(this.shield);
  }

  get color(): THREE.Color {
    return this.baseColor;
  }

  /** Frees everything this player owns on the GPU. Call after `GameScene.removePlayer`. */
  dispose() {
    this.character?.dispose();
    this.character = null;
    for (const r of this.rings) {
      r.geometry.dispose();
      (r.material as THREE.Material).dispose();
    }
    this.shield.geometry.dispose();
    this.shieldMat.dispose();
    this.placeholderParts?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
  }

  /** `fraction` = shield strength left (0 hides the bubble). */
  setShield(fraction: number) {
    this.shield.visible = fraction > 0;
    this.shieldMat.uniforms.strength.value = 0.45 + 0.55 * fraction;
  }

  setColor(color: number) {
    this.baseColor.set(color);
    this.placeholder?.setColor(color);
  }

  /**
   * `alive` false plays the death animation (the body stays where it fell
   * until the respawn moves it). `weapon` picks the gun in hand.
   */
  set(x: number, z: number, aim: number, alive: boolean, weapon = this.weapon) {
    this.group.position.set(x, 0, z);
    this.aim = aim;
    this.alive = alive;
    this.weapon = weapon;
    this.group.visible = true;
  }

  /** HP went down: flash and flinch at `at` (a performance.now() time). */
  flash(at: number) {
    this.character?.hit(at);
    this.placeholder?.flash(at);
    if (this.isLocal) this.scene?.shake(0.35);
  }

  /** A shot left this player's gun: muzzle flash and the aiming pose. */
  shot(now: number) {
    if (!this.alive) return;
    this.character?.shot(now);
    this.scene?.muzzleFlash(this, this.aim, this.weapon);
  }

  /** Where the muzzle flash goes. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    if (this.character) return this.character.muzzle(out);
    const p = this.group.position;
    return out.set(p.x + Math.cos(this.aim) * (PLAYER_RADIUS + 0.55), BULLET_HEIGHT, p.z + Math.sin(this.aim) * (PLAYER_RADIUS + 0.55));
  }

  update(now: number) {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    if (this.character) {
      const p = this.group.position;
      this.character.update(now, dt, { x: p.x, z: p.z, aim: this.aim, alive: this.alive, weapon: this.weapon });
      this.dashing = this.alive && this.character.speed > PlayerMesh.DASH_SPEED_VISUAL;
    } else {
      this.placeholder!.update(now, this.aim, this.alive);
      this.dashing = false;
    }
    for (const r of this.rings) r.visible = this.alive;
    if (this.shield.visible) this.shieldMat.uniforms.time.value = now / 1000;
  }
}

interface DrawnBullet {
  mesh: THREE.Mesh;
  /** Last two drawn positions, for the impact point and direction. */
  x: number;
  z: number;
  px: number;
  pz: number;
}

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private cameraTarget = new THREE.Vector3();
  private bullets = new Map<string, DrawnBullet>();
  // A thin tracer along +Z, turned to face the direction of travel.
  private bulletGeo = new THREE.BoxGeometry(BULLET_RADIUS * 0.8, BULLET_RADIUS * 0.8, 0.7);
  private bulletMats = PLAYER_COLORS.map(
    (c) => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: c, emissiveIntensity: 1.6 }),
  );
  private grenades = new Map<string, { ball: THREE.Object3D; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial }>();
  private grenadeGeo = new THREE.SphereGeometry(0.2, 12, 10);
  private grenadeMat = new THREE.MeshStandardMaterial({ color: 0x30343c, emissive: 0xffaa33, emissiveIntensity: 0.5 });
  private grenadeModel: THREE.Object3D | null = null;
  private telegraphGeo = new THREE.CircleGeometry(GRENADE.radius, 40);
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private players = new Set<PlayerMesh>();
  private vfx: Vfx;
  private lastRender = -1;
  private trauma = 0;
  private shakeOffset = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  /** The current map's floor, walls, cover and decor (rebuilt by `setMap`). */
  private arena = new THREE.Group();
  /** The map on screen, null until the first snapshot says which. */
  map: MapDef | null = null;
  private props: Map<string, THREE.Object3D> | null;
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  /** The shadow area follows the camera target (big maps), see SHADOW_FOLLOW_HALF. */
  private shadowFollows = false;
  /** Unit vector from the ground toward the sun. */
  private sunDir = new THREE.Vector3(0, 1, 0);
  /** World -> light space rotation (and back), for snapping the shadow area to whole texels. */
  private lightRot = new THREE.Matrix4();
  private lightRotInv = new THREE.Matrix4();
  private shadowTexel = 0;
  /** Camera offset (from the yaw), view height and horizontal frustum shift: the game's iso view unless the menu orbits it. */
  private viewHeight = VIEW_HEIGHT;
  private shiftX = 0;
  private offset = cameraOffset(GAME_YAW);

  constructor(canvas: HTMLCanvasElement, loaded: Assets | null = assets) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x1a1d24);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0, 0);

    this.buildLights();
    this.props = loaded?.props ?? null;
    this.scene.add(this.arena);
    const g = loaded?.props?.get("Grenade");
    if (g) {
      this.grenadeModel = g.clone();
      this.grenadeModel.scale.setScalar(0.55);
    }
    this.vfx = new Vfx(this.scene, this.camera, loaded?.atlas ?? null);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** The lights. Their colours, strength and the sun's direction come from the map theme (`setMap`). */
  private buildLights() {
    this.hemi = new THREE.HemisphereLight(0xdde6ff, 0x3a3228, 1.25);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.3);
    sun.position.set(12, 25, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { near: 1, far: 70 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun);
    // Moved with the shadow area on big maps (a light's target must be in the scene to update).
    this.scene.add(sun.target);
  }

  /**
   * Shows another map: frees the old arena's geometries (and the materials
   * made for it, never the loaded props'), builds the new one and applies its
   * theme. Also drops every drawn bullet and grenade, without sparks: they
   * belonged to the old map.
   */
  setMap(map: MapDef) {
    if (this.map?.id === map.id) return;
    this.map = map;
    disposeArena(this.arena);
    buildArena(this.arena, this.props, map);
    this.clearProjectiles();

    const t = map.theme;
    (this.scene.background as THREE.Color | null)?.set(t.background);
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.hemi.intensity = t.hemiIntensity;
    this.sun.color.set(t.sun);
    this.sun.intensity = t.sunIntensity;
    this.sunDir.set(t.sunDir.x, t.sunDir.y, t.sunDir.z).normalize();
    const whole = Math.max(map.halfX, map.halfZ) + 3;
    this.shadowFollows = whole > SHADOW_FOLLOW_HALF;
    const s = this.shadowFollows ? SHADOW_FOLLOW_HALF : whole;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: SUN_DISTANCE * 2 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.shadowTexel = (2 * s) / this.sun.shadow.mapSize.x;
    this.lightRot.lookAt(this.sunDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    this.lightRotInv.copy(this.lightRot).invert();
    this.placeShadow(this.cameraTarget.x, this.cameraTarget.z);
  }

  /**
   * Centres the sun's shadow area on (x, z): the whole map on a small one
   * (always the origin), the area round the camera on a big one. The centre
   * is snapped to whole shadow texels in light space, so shadows don't
   * shimmer as the camera glides.
   */
  private placeShadow(x: number, z: number) {
    const c = this.tmpShadow;
    if (this.shadowFollows && this.shadowTexel > 0) {
      c.set(x, 0, z).applyMatrix4(this.lightRotInv);
      c.x = Math.round(c.x / this.shadowTexel) * this.shadowTexel;
      c.y = Math.round(c.y / this.shadowTexel) * this.shadowTexel;
      c.applyMatrix4(this.lightRot);
    } else c.set(0, 0, 0);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sunDir, SUN_DISTANCE);
    this.sun.target.updateMatrixWorld();
  }
  private tmpShadow = new THREE.Vector3();

  /** Removes every drawn bullet and grenade at once (map change). */
  clearProjectiles() {
    for (const b of this.bullets.values()) this.scene.remove(b.mesh);
    this.bullets.clear();
    for (const g of this.grenades.values()) this.scene.remove(g.ball, g.ring);
    this.grenades.clear();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;
    const vh = this.viewHeight;
    const shift = this.shiftX * vh * aspect;
    this.camera.left = (-vh * aspect) / 2 - shift;
    this.camera.right = (vh * aspect) / 2 - shift;
    this.camera.top = vh / 2;
    this.camera.bottom = -vh / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /**
   * Camera framing. `yaw` turns the view around the vertical axis (the game
   * always plays at the iso yaw, see `resetView`), `viewHeight` is the
   * visible height in metres, and `shiftX` moves the looked-at point sideways
   * on screen, as a fraction of the width (0.15 puts it at 65 % across).
   */
  setView(yaw: number, viewHeight = this.viewHeight, shiftX = this.shiftX) {
    const reframe = viewHeight !== this.viewHeight || shiftX !== this.shiftX;
    cameraOffset(yaw, this.offset);
    this.viewHeight = viewHeight;
    this.shiftX = shiftX;
    if (reframe) this.resize();
  }

  /** Back to the game's iso camera (the move keys and sound panning assume it). */
  resetView() {
    this.setView(GAME_YAW, VIEW_HEIGHT, 0);
    this.trauma = 0;
  }

  /** Small screen shake, 0-1. Off with prefers-reduced-motion. */
  shake(amount: number) {
    if (REDUCED_MOTION) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Follows a ground point with a little smoothing. */
  follow(x: number, z: number, dtSeconds: number, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-10 * dtSeconds);
    this.cameraTarget.x += (x - this.cameraTarget.x) * k;
    this.cameraTarget.z += (z - this.cameraTarget.z) * k;
    this.shakeOffset.set(0, 0, 0);
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dtSeconds * 2.2);
      const t = performance.now() / 1000;
      const a = this.trauma * this.trauma * 0.35; // metres
      // Offset in the camera plane only, so the view doesn't tilt.
      this.shakeOffset
        .set(Math.sin(t * 71) * a, Math.sin(t * 57 + 1.3) * a, 0)
        .applyQuaternion(this.camera.quaternion);
    }
    this.camera.position.copy(this.cameraTarget).add(this.offset).add(this.shakeOffset);
    this.camera.lookAt(this.tmp.copy(this.cameraTarget).add(this.shakeOffset));
    this.camera.updateMatrixWorld();
    if (this.shadowFollows) this.placeShadow(this.cameraTarget.x, this.cameraTarget.z);
  }

  /** Where the cursor ray hits the ground plane, or null. */
  cursorOnGround(ndc: THREE.Vector2): THREE.Vector3 | null {
    // Aim against the unshaken camera, so a shake never moves the cursor.
    this.camera.position.sub(this.shakeOffset);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    this.camera.position.add(this.shakeOffset);
    this.camera.updateMatrixWorld();
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, hit);
  }

  addPlayer(mesh: PlayerMesh) {
    mesh.scene = this;
    this.players.add(mesh);
    this.scene.add(mesh.group);
  }

  removePlayer(mesh: PlayerMesh) {
    mesh.scene = null;
    this.players.delete(mesh);
    this.scene.remove(mesh.group);
  }

  muzzleFlash(p: PlayerMesh, aim: number, weapon: number) {
    const m = p.muzzle(this.tmp);
    this.vfx.muzzle(m.x, m.y, m.z, aim, weapon);
  }

  /**
   * Bullets. A new id with pellet 0 of our own is a new shot of ours: muzzle
   * flash (our predicted bullets appear the frame we fire). The opponent's
   * flash is not read from here: at close range their bullet can hit and
   * vanish within one tick, never showing in a snapshot, so main.ts drives it
   * from their ammo count instead, like their shot sound. A bullet that
   * vanishes next to cover or a player hit it: sparks. One that vanishes in
   * the open ran out of range: nothing.
   */
  syncBullets(bullets: Map<string, { x: number; z: number; slot: number }>) {
    for (const [id, b] of this.bullets) {
      if (!bullets.has(id)) {
        this.impact(b);
        this.scene.remove(b.mesh);
        this.bullets.delete(id);
      }
    }
    const now = performance.now();
    for (const [id, b] of bullets) {
      let d = this.bullets.get(id);
      if (!d) {
        const mesh = new THREE.Mesh(this.bulletGeo, this.bulletMats[b.slot] ?? this.bulletMats[0]);
        mesh.castShadow = true;
        d = { mesh, x: b.x, z: b.z, px: b.x, pz: b.z };
        this.bullets.set(id, d);
        this.scene.add(mesh);
        if (id.endsWith(":0")) for (const p of this.players) if (p.isLocal && p.slot === b.slot) p.shot(now);
      }
      if (b.x !== d.x || b.z !== d.z) {
        d.px = d.x;
        d.pz = d.z;
        d.x = b.x;
        d.z = b.z;
      }
      d.mesh.position.set(b.x, BULLET_HEIGHT, b.z);
      if (d.x !== d.px || d.z !== d.pz) d.mesh.lookAt(b.x + (d.x - d.px), BULLET_HEIGHT, b.z + (d.z - d.pz));
    }
  }

  private impact(b: DrawnBullet) {
    let dx = b.x - b.px;
    let dz = b.z - b.pz;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    // A player it was about to reach?
    for (const p of this.players) {
      const q = p.group.position;
      const ox = b.x - q.x;
      const oz = b.z - q.z;
      const dist = Math.hypot(ox, oz);
      if (dist < PLAYER_RADIUS + 0.9) {
        const nx = ox / (dist || 1);
        const nz = oz / (dist || 1);
        this.vfx.sparks(q.x + nx * PLAYER_RADIUS * 0.8, BULLET_HEIGHT, q.z + nz * PLAYER_RADIUS * 0.8, nx, nz, true);
        return;
      }
    }
    // Cover or the outer walls: the nearest surface point within reach.
    const reach = 1.0;
    let best = reach;
    let hx = 0;
    let hz = 0;
    const test = (cx: number, cz: number, hw: number, hd: number) => {
      const px = Math.max(cx - hw, Math.min(cx + hw, b.x));
      const pz = Math.max(cz - hd, Math.min(cz + hd, b.z));
      const d = Math.hypot(px - b.x, pz - b.z);
      if (d < best) {
        best = d;
        hx = px;
        hz = pz;
      }
    };
    const map = this.map;
    if (!map) return;
    for (const o of map.obstacles) test(o.x, o.z, o.w / 2, o.d / 2);
    // Walls at z = +-ez run along X, walls at x = +-ex run along Z.
    const ex = map.halfX + WALL_THICKNESS / 2;
    const ez = map.halfZ + WALL_THICKNESS / 2;
    test(0, -ez, map.halfX + WALL_THICKNESS, WALL_THICKNESS / 2);
    test(0, ez, map.halfX + WALL_THICKNESS, WALL_THICKNESS / 2);
    test(-ex, 0, WALL_THICKNESS / 2, map.halfZ + WALL_THICKNESS);
    test(ex, 0, WALL_THICKNESS / 2, map.halfZ + WALL_THICKNESS);
    if (best < reach) this.vfx.sparks(hx, BULLET_HEIGHT, hz, -dx, -dz, false);
  }

  /**
   * Grenades: the grenade follows its arc (y comes from the server), and a
   * ground circle shows the blast radius at the landing point. Faint while it
   * flies, pulsing red during the fuse so it can be dodged. (The blast itself
   * is triggered separately, see `blast`.)
   */
  syncGrenades(grenades: Map<string, GrenadeView>, now: number) {
    for (const [id, g] of this.grenades) {
      if (!grenades.has(id)) {
        this.scene.remove(g.ball, g.ring);
        this.grenades.delete(id);
      }
    }
    for (const [id, gv] of grenades) {
      let g = this.grenades.get(id);
      if (!g) {
        let ball: THREE.Object3D;
        if (this.grenadeModel) {
          ball = this.grenadeModel.clone();
          ball.traverse((o) => (o.castShadow = true));
        } else {
          ball = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
          ball.castShadow = true;
        }
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4030, transparent: true, opacity: 0.1, depthWrite: false });
        const ring = new THREE.Mesh(this.telegraphGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        g = { ball, ring, ringMat };
        this.grenades.set(id, g);
        this.scene.add(ball, ring);
      }
      g.ball.position.set(gv.x, gv.y + 0.2, gv.z);
      if (!gv.landed) g.ball.rotation.set(now / 90, now / 140, 0);
      g.ball.visible = !gv.exploded;
      g.ring.position.set(gv.tx, 0.03, gv.tz);
      g.ring.visible = !gv.exploded;
      g.ringMat.opacity = gv.landed ? 0.28 + 0.2 * Math.sin(now / 45) : 0.1;
    }
  }

  /** Grenade explosion. `own` = we threw it (shakes the camera a little). */
  blast(x: number, z: number, now: number, own = false) {
    this.vfx.explosion(x, z, GRENADE.radius, now);
    if (own) this.shake(0.55);
  }

  /** Dash streak: dust kicked up behind the runner. */
  addGhost(x: number, z: number, _color: THREE.Color, _now: number) {
    this.vfx.dust(x, z);
  }

  render(now: number) {
    const dt = this.lastRender < 0 ? 0 : Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    this.vfx.update(dt, now);
    this.renderer.render(this.scene, this.camera);
  }
}

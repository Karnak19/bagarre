import * as THREE from "three";
import {
  BULLET_HEIGHT,
  GRENADE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SMOKE,
  WALL_THICKNESS,
  WEAPONS,
  grenadeDef,
  type GrenadeView,
  type MapDef,
  type SmokeVeil,
} from "@bagarre/shared";
import { buildArena, disposeArena, type ArenaDressing } from "./arenaView.ts";
import { skinModel, skinModelNow, type Assets } from "./assets.ts";
import { Character } from "./character.ts";
import { GUN_VIEW, grenadeView, gunView } from "./items.ts";
import { TEAM_PAINT } from "./paint.ts";
import { Plates } from "./plates.ts";
import { RoyaleView } from "./royaleView.ts";
import { tracerGeometry, tracerMaterial } from "./tracers.ts";
import { Vfx, shieldMaterial, type SmokeCloud } from "./vfx.ts";

/**
 * The player palette, by paint index (see paint.ts). 0-5 are one colour per
 * seat (slot): orange and blue for the duel's two, then lime, violet, pink
 * and teal for the free-for-all's seats 2-5. 6 and 7 are the team colours,
 * red and blue, never a seat's: in a team deathmatch every player is painted
 * in their team's. The same values are the theme's `--bagarre-p0`..
 * `--bagarre-p7` (ui/theme/bagarre.source.ts), so the HUD, the scoreboard and
 * the minimap match the characters.
 */
export const PLAYER_CSS_COLORS = ["#ff6b4a", "#4ab8ff", "#a6e04a", "#b07cff", "#ff5fae", "#3fd9c6", "#ff4a4a", "#3f8cff"];
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
/** How see-through a player in smoke is for a spectator (smokeVeil "faded"). */
export const FADED_OPACITY = 0.35;
/** A stunned player's sparks: one crackle every this many ms. */
const STUN_SPARK_MS = 70;

/** Set once, before any PlayerMesh is made (see main.ts). */
let assets: Assets | null = null;
export function setAssets(a: Assets) {
  assets = a;
}

/** The old capsule-and-box body, worn while a skin loads, and for good when it fails. */
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

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
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

/** The healing ring's radii, and how many steps its fill moves in. */
const HEAL_RING_R0 = PLAYER_RADIUS + 0.5;
const HEAL_RING_R1 = PLAYER_RADIUS + 0.64;
const HEAL_RING_STEPS = 60;

export class PlayerMesh {
  readonly group = new THREE.Group();
  readonly slot: number;
  private character: Character | null = null;
  private placeholder: PlaceholderBody | null = null;
  private baseColor: THREE.Color;
  private shield: THREE.Mesh;
  private shieldMat: THREE.ShaderMaterial;
  private rings: THREE.Mesh[] = [];
  private aim = 0;
  private alive = true;
  private weapon = 0;
  private lastT = -1;
  private disposed = false;
  /** Hooked up by GameScene.addPlayer. */
  scene: GameScene | null = null;
  /** Drawn speed above this means a dash (walking is PLAYER_SPEED). */
  private static DASH_SPEED_VISUAL = PLAYER_SPEED * 1.8;
  /** Set when the mesh moved at dash speed since the last update. */
  dashing = false;
  /** How smoke has this player drawn for us (smokeVeil): as usual, not at all, or see-through (spectators). */
  veil: SmokeVeil = "none";
  /** The see-through look is on the materials (false after a new skin model came in: apply it again). */
  private fadedApplied = false;
  /** Each material's own opacity and transparency, to put back when the fade ends. */
  private fadeSaved = new Map<THREE.Material, { opacity: number; transparent: boolean }>();
  /** When stun sparks last crackled on this player, and when `stunned` was last called (performance.now()). */
  private lastSpark = 0;
  private stunSeen = -1e9;
  /** When to draw the next heal glow (healed()), or -1. */
  private healAt = -1;
  private stunRing: THREE.Mesh;
  private stunRingMat: THREE.MeshBasicMaterial;
  /** Battle royale: the healing ring (a faint track, and an arc that fills), and the fill drawn, in HEAL_RING_STEPS (-1: hidden). */
  private healTrack: THREE.Mesh;
  private healArc: THREE.Mesh;
  private healMat: THREE.MeshBasicMaterial;
  private healStep = -1;

  /**
   * `skin`: the SKINS id worn. Until that skin's model has loaded (and for
   * good if it fails, or for an empty or unknown id: an older server) the
   * player is the capsule; the character replaces it once loaded. A skin
   * already loaded is worn at once. `id`: the player's session id, which
   * tracers use to find their gun.
   */
  constructor(
    color: number,
    readonly isLocal: boolean,
    slot = Math.max(0, PLAYER_COLORS.indexOf(color)),
    readonly skin = "",
    readonly id = "",
  ) {
    this.slot = slot;
    this.baseColor = new THREE.Color(color);
    const now = skinModelNow(skin);
    if (!now || !this.wear(now)) {
      this.placeholder = new PlaceholderBody(color);
      this.group.add(this.placeholder.group);
      if (now === undefined && skin)
        void skinModel(skin).then((model) => {
          if (model && !this.disposed && this.wear(model)) this.dropPlaceholder();
        });
    }

    // Ground ring in the player's colour (and a white one for "you"). In a
    // team game (paints 6 and 7) it is the team marker: the skins keep their
    // own colours, so it is wider, solid, over a tinted disc.
    const team = slot === TEAM_PAINT[0] || slot === TEAM_PAINT[1];
    const ring = (r0: number, r1: number, c: THREE.ColorRepresentation, opacity: number) => {
      const geo = r0 > 0 ? new THREE.RingGeometry(r0, r1, 40) : new THREE.CircleGeometry(r1, 40);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.02;
      m.renderOrder = 2;
      this.group.add(m);
      this.rings.push(m);
    };
    if (team) {
      ring(0, PLAYER_RADIUS + 0.02, color, 0.22);
      ring(PLAYER_RADIUS + 0.02, PLAYER_RADIUS + 0.2, color, 0.95);
    } else ring(PLAYER_RADIUS + 0.02, PLAYER_RADIUS + 0.12, color, 0.75);
    if (isLocal) ring(PLAYER_RADIUS + (team ? 0.22 : 0.14), PLAYER_RADIUS + (team ? 0.28 : 0.2), 0xffffff, 0.55);

    // The stun ring: shown while stunned (see `stunned`), pulsing.
    this.stunRingMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.8, depthWrite: false });
    this.stunRing = new THREE.Mesh(new THREE.RingGeometry(PLAYER_RADIUS + 0.3, PLAYER_RADIUS + 0.45, 40), this.stunRingMat);
    this.stunRing.rotation.x = -Math.PI / 2;
    this.stunRing.position.y = 0.04;
    this.stunRing.renderOrder = 3;
    this.stunRing.visible = false;
    this.group.add(this.stunRing);

    // The healing ring: a green arc that fills clockwise round the player
    // while a healing item is used (setHealing), over a faint full track.
    this.healMat = new THREE.MeshBasicMaterial({ color: 0x6dff9a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const track = new THREE.MeshBasicMaterial({ color: 0x6dff9a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    this.healTrack = new THREE.Mesh(new THREE.RingGeometry(HEAL_RING_R0, HEAL_RING_R1, 48), track);
    this.healArc = new THREE.Mesh(new THREE.RingGeometry(HEAL_RING_R0, HEAL_RING_R1, 48, 1, 0, 0.01), this.healMat);
    for (const m of [this.healTrack, this.healArc]) {
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.05;
      m.renderOrder = 3;
      m.visible = false;
      this.group.add(m);
    }

    this.shieldMat = shieldMaterial(this.baseColor);
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.05, 32, 20), this.shieldMat);
    this.shield.position.y = 0.95;
    this.shield.visible = false;
    this.shield.renderOrder = 12;
    this.group.add(this.shield);
  }

  /** Whether the skin's model is on (false: the capsule, loading or failed). */
  get loaded(): boolean {
    return !!this.character;
  }

  /** Builds the character from a loaded skin. False (and the capsule stays) if the clips are missing or it fails. */
  private wear(model: THREE.Object3D): boolean {
    const kit = assets?.anims ? { clips: assets.anims, guns: assets.guns } : null;
    if (!kit) return false;
    try {
      this.character = new Character(model, kit);
      this.group.add(this.character.root);
      this.fadedApplied = false;
      return true;
    } catch (err) {
      console.warn("[scene] character setup failed, using the placeholder", err);
      this.character = null;
      return false;
    }
  }

  private dropPlaceholder() {
    const p = this.placeholder;
    if (!p) return;
    this.placeholder = null;
    this.group.remove(p.group);
    p.dispose();
  }

  get color(): THREE.Color {
    return this.baseColor;
  }

  /** Frees everything this player owns on the GPU. Call after `GameScene.removePlayer`. */
  dispose() {
    this.disposed = true;
    this.character?.dispose();
    this.character = null;
    for (const r of this.rings) {
      r.geometry.dispose();
      (r.material as THREE.Material).dispose();
    }
    this.shield.geometry.dispose();
    this.shieldMat.dispose();
    this.stunRing.geometry.dispose();
    this.stunRingMat.dispose();
    this.healTrack.geometry.dispose();
    (this.healTrack.material as THREE.Material).dispose();
    this.healArc.geometry.dispose();
    this.healMat.dispose();
    this.dropPlaceholder();
  }

  /** `fraction` = shield strength left (0 hides the bubble). */
  setShield(fraction: number) {
    this.shield.visible = fraction > 0;
    this.shieldMat.uniforms.strength.value = 0.45 + 0.55 * fraction;
  }

  /**
   * A heal in progress, `fraction` 0..1 of the way (below 0: none): the
   * green ring fills round the player. Rebuilt only when it moves a step.
   */
  setHealing(fraction: number) {
    const step = fraction < 0 ? -1 : Math.round(Math.min(1, fraction) * HEAL_RING_STEPS);
    if (step === this.healStep) return;
    this.healStep = step;
    const on = step >= 0;
    this.healTrack.visible = on;
    this.healArc.visible = on && step > 0;
    if (!on || step === 0) return;
    this.healArc.geometry.dispose();
    // From the top of the screen's view (-z), clockwise seen from above.
    const len = (step / HEAL_RING_STEPS) * Math.PI * 2;
    this.healArc.geometry = new THREE.RingGeometry(HEAL_RING_R0, HEAL_RING_R1, 48, 1, Math.PI / 2 - len, len);
  }

  setColor(color: number) {
    this.baseColor.set(color);
    this.placeholder?.setColor(color);
  }

  /**
   * `alive` false plays the death animation (the body stays where it fell
   * until the respawn moves it). `weapon` picks the gun in hand.
   */
  set(x: number, z: number, aim: number, alive: boolean, weapon = this.weapon, veil: SmokeVeil = "none") {
    this.group.position.set(x, 0, z);
    this.aim = aim;
    this.alive = alive;
    this.weapon = weapon;
    this.veil = veil;
    // Smoke (client-side only, see smokeVeil): hidden is not drawn at all.
    this.group.visible = veil !== "hidden";
    this.applyFade(veil === "faded");
  }

  /** The spectator's see-through look for a player in smoke: every material of this player at FADED_OPACITY, and back. */
  private applyFade(on: boolean) {
    if (on === this.fadedApplied && (on || this.fadeSaved.size === 0)) return;
    this.fadedApplied = on;
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh === this.shield || mesh === this.stunRing || mesh === this.healArc || mesh === this.healTrack) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        let saved = this.fadeSaved.get(m);
        if (!saved) {
          if (!on) continue;
          saved = { opacity: m.opacity, transparent: m.transparent };
          this.fadeSaved.set(m, saved);
        }
        const transparent = on || saved.transparent;
        if (m.transparent !== transparent) m.needsUpdate = true;
        m.transparent = transparent;
        m.opacity = on ? saved.opacity * FADED_OPACITY : saved.opacity;
      }
    });
    if (!on) this.fadeSaved.clear();
  }

  /** Stunned (called every frame while it lasts): a pulsing blue ring at the feet, and sparks crackling round the body. */
  stunned(now: number) {
    this.stunSeen = now;
    if (!this.alive || this.veil === "hidden" || now - this.lastSpark < STUN_SPARK_MS) return;
    this.lastSpark = now;
    this.scene?.stunSparks(this.group.position.x, this.group.position.z);
  }

  /** HP went up (a heal): a green glow on the body at `at` (a performance.now() time), drawn in update(). */
  healed(at: number) {
    this.healAt = at;
  }

  /** HP went down: flash and flinch at `at` (a performance.now() time). */
  flash(at: number) {
    this.character?.hit(at);
    this.placeholder?.flash(at);
    if (this.isLocal) this.scene?.shake(0.35);
  }

  /** A shot left this player's gun: muzzle flash and the aiming pose. `weapon`: the one that fired, when known. */
  shot(now: number, weapon = this.weapon) {
    if (!this.alive) return;
    this.character?.shot(now);
    // Hidden by smoke: no muzzle flash to give them away (the shot is still heard).
    if (this.veil !== "hidden") this.scene?.muzzleFlash(this, this.aim, weapon);
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
      this.placeholder?.update(now, this.aim, this.alive);
      this.dashing = false;
    }
    for (const r of this.rings) r.visible = this.alive;
    this.stunRing.visible = this.alive && now - this.stunSeen < 150;
    if (this.stunRing.visible) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 60);
      this.stunRingMat.opacity = (0.45 + 0.45 * pulse) * (this.fadedApplied ? FADED_OPACITY : 1);
      this.stunRing.scale.setScalar(1 + 0.12 * pulse);
    }
    if (this.shield.visible) this.shieldMat.uniforms.time.value = now / 1000;
    if (this.healAt >= 0 && now >= this.healAt) {
      this.healAt = -1;
      if (this.alive && this.veil !== "hidden") this.scene?.healGlow(this.group.position.x, this.group.position.z);
    }
  }
}

/** A bullet as syncBullets draws it, from our prediction (bullets.ts) or the server's snapshots (interpolation.ts). */
export interface BulletDraw {
  x: number;
  z: number;
  /** Its velocity, m/s: the tracer's heading (a shotgun's pellets each have their own). 0, 0 when unknown. */
  vx: number;
  vz: number;
  slot: number;
  owner?: string;
  /** The gun that fired it (its tracer's look); the default weapon's when unknown. */
  weapon?: number;
  hidden?: boolean;
}

interface DrawnBullet {
  mesh: THREE.Mesh;
  /** Last drawn position, for the impact point. */
  x: number;
  z: number;
  /** The direction it flies in (unit), for the tracer's heading and the impact's sparks. */
  dx: number;
  dz: number;
  /** The tracer's full length (its gun's look). */
  length: number;
  /** Still growing out of the muzzle to its full length (only one first drawn at its shooter's muzzle). */
  grow: boolean;
  /** Where it was first drawn, and how far off its path the shooter's muzzle was then (see syncBullets). */
  x0: number;
  z0: number;
  off: THREE.Vector3 | null;
  /** Frames drawn so far. */
  frames: number;
  /** The gun that fired it (a WEAPONS index). */
  weapon: number;
}

/**
 * A bullet drawn from its shooter's muzzle eases onto its true path (at
 * BULLET_HEIGHT, from the body's centre) over this many metres. The tracer
 * slides sideways while it does, but stays level and pointed along its path.
 * (The head is the bullet's position, whatever the tracer's length.)
 */
const TRACER_MERGE = 3;
/** Farther than this from the muzzle when first seen, the bullet is drawn on its path straight away. */
const TRACER_MAX_OFFSET = 2.5;
/** A tracer leaving the muzzle starts at this fraction of its length (it grows out of the gun rather than poking back through the shooter). */
const TRACER_MIN_SCALE = 0.12;
/** Dev only: how many of a bullet's first frames the tracer log keeps (see `tracerLog`). */
const TRACER_LOG_FRAMES = 4;

/** Dev only: one frame of a tracer, in its first ones (the e2e tracer spec reads them). */
export interface TracerFrame {
  id: string;
  /** 0 for the frame it first appeared in. */
  frame: number;
  weapon: number;
  /** Where the mesh is drawn, and the way its head points (world, unit). */
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
  /** The bullet's velocity, as given. */
  vx: number;
  vz: number;
  visible: boolean;
}

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private cameraTarget = new THREE.Vector3();
  private bullets = new Map<string, DrawnBullet>();
  // Tracers: one geometry per gun (by weapon id), built once; one material for all.
  private tracerGeos = WEAPONS.map((w) => tracerGeometry(GUN_VIEW[w.key].tracer));
  private tracerMat = tracerMaterial();
  /** Dev only: each bullet's first few frames (TracerFrame), newest last, capped. */
  readonly tracerLog: TracerFrame[] = [];
  private grenades = new Map<string, { ball: THREE.Object3D; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial }>();
  private grenadeGeo = new THREE.SphereGeometry(0.2, 12, 10);
  private grenadeMat = new THREE.MeshStandardMaterial({ color: 0x30343c, emissive: 0xffaa33, emissiveIntensity: 0.5 });
  private grenadeModel: THREE.Object3D | null = null;
  private telegraphGeo = new THREE.CircleGeometry(GRENADE.radius, 40);
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private players = new Set<PlayerMesh>();
  private vfx: Vfx;
  /** Name plates and health bars over the players' heads (filled by match.ts every frame). */
  readonly plates: Plates;
  /** Battle royale: the zone, the chests and the items on the floor (filled by match.ts every frame). */
  readonly royale: RoyaleView;
  private lastRender = -1;
  private trauma = 0;
  private shakeOffset = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
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

  /**
   * `lite` (dev `?lite`, the e2e suite): no antialiasing and no shadows. On
   * CI the GPU is SwiftShader, on the CPU, and those two are most of a drawn
   * frame's cost there; nothing the suite checks looks at pixels.
   */
  constructor(canvas: HTMLCanvasElement, loaded: Assets | null = assets, { lite = false }: { lite?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !lite;
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
    // The chest model; without it (a failed load), the old crate prop, or a plain box.
    this.royale = new RoyaleView(loaded?.chest ?? null, loaded?.props?.get("Crate") ?? null, loaded?.guns ?? [], loaded?.props?.get("Grenade") ?? null);
    this.scene.add(this.royale.group);
    this.plates = new Plates(this.renderer, PLAYER_CSS_COLORS);
    this.scene.add(this.plates.mesh);
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

  /** What the current arena is dressed with (arenaView's ArenaDressing), for the dev handle and tests. */
  get dressing(): ArenaDressing | null {
    return (this.arena.userData.dressing as ArenaDressing | undefined) ?? null;
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

  /**
   * The direction from ground point a to ground point b as seen on screen,
   * in degrees clockwise from "right" (a CSS rotate() for an arrow drawn
   * pointing right): the royale HUD's way back to the zone.
   */
  screenAngle(ax: number, az: number, bx: number, bz: number): number {
    const a = this.tmp.set(ax, 0, az).project(this.camera);
    const b = this.tmp2.set(bx, 0, bz).project(this.camera);
    // NDC y points up, the screen's down: flip it. Aspect: NDC x spans the width.
    const aspect = this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
    return (Math.atan2(-(b.y - a.y), (b.x - a.x) * aspect) * 180) / Math.PI;
  }

  /** Removes every drawn bullet and grenade at once (map change). */
  clearProjectiles() {
    for (const b of this.bullets.values()) this.scene.remove(b.mesh);
    this.bullets.clear();
    for (const g of this.grenades.values()) this.scene.remove(g.ball, g.ring);
    this.grenades.clear();
    this.vfx.smokeClouds([], 0, SMOKE.radius);
    this.royale.clear();
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
    this.vfx.muzzle(m.x, m.y, m.z, aim, gunView(weapon).flash);
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
  syncBullets(bullets: Map<string, BulletDraw>) {
    for (const [id, b] of this.bullets) {
      if (!bullets.has(id)) {
        // A bullet that ends unseen (in smoke) makes no sparks there either.
        if (b.mesh.visible) this.impact(b);
        this.scene.remove(b.mesh);
        this.bullets.delete(id);
      }
    }
    const now = performance.now();
    for (const [id, b] of bullets) {
      let d = this.bullets.get(id);
      if (!d) {
        const weapon = b.weapon !== undefined && this.tracerGeos[b.weapon] ? b.weapon : 0;
        const mesh = new THREE.Mesh(this.tracerGeos[weapon], this.tracerMat);
        mesh.renderOrder = 1;
        d = {
          mesh,
          x: b.x,
          z: b.z,
          dx: 0,
          dz: 1,
          length: GUN_VIEW[WEAPONS[weapon].key].tracer.length,
          x0: b.x,
          z0: b.z,
          off: null,
          grow: false,
          frames: 0,
          weapon,
        };
        this.bullets.set(id, d);
        this.scene.add(mesh);
        if (id.endsWith(":0")) for (const p of this.players) if (p.isLocal && p.slot === b.slot) p.shot(now, b.weapon);
        // The sim's bullets fly at BULLET_HEIGHT from the body's centre line;
        // the gun is in the right hand. The tracer starts at the muzzle and
        // eases onto the true path over its first metres. Not for a shot
        // from inside smoke: it would point back at the hidden shooter.
        for (const p of this.players) {
          if (b.hidden || !b.owner || p.id !== b.owner) continue;
          const m = p.muzzle(this.tmp).sub(this.tmp2.set(b.x, BULLET_HEIGHT, b.z));
          if (m.length() < TRACER_MAX_OFFSET) d.off = m.clone();
        }
        d.grow = !!d.off;
      }
      // Smoke (client-side only): a bullet in the cloud, or behind it, isn't
      // drawn; it shows once it comes out, on its own path.
      d.mesh.visible = !b.hidden;
      // The heading is the bullet's own velocity, from its very first frame
      // (a pellet's, not the shooter's aim). With none given, the way it moved.
      const v = Math.hypot(b.vx, b.vz);
      if (v > 1e-6) {
        d.dx = b.vx / v;
        d.dz = b.vz / v;
      } else if (b.x !== d.x || b.z !== d.z) {
        const m = Math.hypot(b.x - d.x, b.z - d.z);
        d.dx = (b.x - d.x) / m;
        d.dz = (b.z - d.z) / m;
      }
      d.x = b.x;
      d.z = b.z;
      const pos = d.mesh.position.set(b.x, BULLET_HEIGHT, b.z);
      const travelled = Math.hypot(b.x - d.x0, b.z - d.z0);
      if (d.off) {
        const k = 1 - travelled / TRACER_MERGE;
        if (k > 0) pos.addScaledVector(d.off, k);
        else d.off = null;
      }
      // Level, along its path, from where it is drawn: the muzzle offset slides it, never tilts it.
      d.mesh.lookAt(pos.x + d.dx, pos.y, pos.z + d.dz);
      // Out of the muzzle, the streak grows to its length instead of reaching back through the shooter.
      if (d.grow) {
        const k = Math.max(TRACER_MIN_SCALE, travelled / d.length);
        d.grow = k < 1;
        d.mesh.scale.z = Math.min(1, k);
      }
      if (import.meta.env.DEV && d.frames < TRACER_LOG_FRAMES) this.logTracer(id, d);
      d.frames++;
    }
  }

  /** Dev only: records one of a tracer's first frames (TracerFrame). */
  private logTracer(id: string, d: DrawnBullet) {
    const f = d.mesh.getWorldDirection(this.tmp);
    const p = d.mesh.position;
    this.tracerLog.push({
      id,
      frame: d.frames,
      weapon: d.weapon,
      x: p.x,
      y: p.y,
      z: p.z,
      fx: f.x,
      fy: f.y,
      fz: f.z,
      vx: d.dx,
      vz: d.dz,
      visible: d.mesh.visible,
    });
    if (this.tracerLog.length > 400) this.tracerLog.splice(0, this.tracerLog.length - 400);
  }

  private impact(b: DrawnBullet) {
    const dx = b.dx;
    const dz = b.dz;
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
        // The telegraph in the type's colour (GRENADE_VIEW) and radius: red frag, grey smoke, blue stun, white flash.
        const ringMat = new THREE.MeshBasicMaterial({ color: grenadeView(gv.kind).telegraph, transparent: true, opacity: 0.1, depthWrite: false });
        const ring = new THREE.Mesh(this.telegraphGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.scale.setScalar(grenadeDef(gv.kind).radius / GRENADE.radius);
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

  /** A grenade goes off, drawn by its type. `own` = we threw it (a frag shakes the camera a little). */
  blast(x: number, z: number, now: number, own = false, kind = 0) {
    grenadeView(kind).draw({ vfx: this.vfx, shake: (amount) => this.shake(amount) }, x, z, now, own);
  }

  /** The smoke clouds this frame, at server tick `tick` (fractional). */
  syncSmokes(clouds: readonly SmokeCloud[], tick: number) {
    this.vfx.smokeClouds(clouds, tick, SMOKE.radius);
  }

  stunSparks(x: number, z: number) {
    this.vfx.stunSparks(x, z);
  }

  healGlow(x: number, z: number) {
    this.vfx.healGlow(x, z);
  }

  /** Dash streak: dust kicked up behind the runner. */
  addGhost(x: number, z: number, _color: THREE.Color, _now: number) {
    this.vfx.dust(x, z);
  }

  render(now: number) {
    const dt = this.lastRender < 0 ? 0 : Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    this.vfx.update(dt, now);
    this.plates.prepare(this.renderer, dt);
    this.renderer.render(this.scene, this.camera);
  }
}

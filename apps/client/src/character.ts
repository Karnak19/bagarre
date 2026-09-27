import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { PLAYER_SPEED } from "@bagarre/shared";

/**
 * World metres per model unit. The kit's characters are about 2.15 units tall
 * and 1.1 wide with the arms out: at 0.82 the body is about 0.9 m across (the
 * physics circle is 1 m) and the gun sits at 1.05 m, right where bullets fly
 * (BULLET_HEIGHT = 1).
 */
const MODEL_SCALE = 0.82;
/**
 * Ground speed of the Run clip at timeScale 1, in model units per second,
 * measured from the planted foot in the clip (it slides back ~3.8 u/s).
 */
const RUN_CLIP_SPEED = 3.8;
/** Weapon id -> gun node in the character file. */
const GUN_NODES = ["AK", "Shotgun", "Sniper", "SMG"];
const GUN_SCALE = 0.75;

const DEG = Math.PI / 180;
/** Steady-state torso twist limit; beyond it the legs turn instead. */
const TWIST_LIMIT = 75 * DEG;
/** Hard limit while the legs are still catching up (during a flip). */
const TWIST_HARD_LIMIT = 115 * DEG;
/** Aim-vs-move angle where the legs flip to a backpedal, and back (hysteresis). */
const BACKPEDAL_ENTER = 105 * DEG;
const BACKPEDAL_EXIT = 80 * DEG;
/** Standing still, the feet shuffle round once the torso is twisted this far. */
const IDLE_TWIST_LIMIT = 50 * DEG;
/** Fastest the legs turn, radians per second. */
const LEG_TURN_SPEED = 800 * DEG;
/** Below this drawn speed (m/s) the character is standing. */
const MOVING_SPEED = 0.8;
/** Above this it's a dash (walking is PLAYER_SPEED). */
const DASH_SPEED = PLAYER_SPEED * 1.8;
/** How long a shot keeps the aiming pose when standing, ms. */
const SHOOT_POSE_MS = 280;
const HIT_MS = 380;
/** Share of the torso twist taken by each spine bone, bottom to top. */
const TWIST_SPLIT: [string, number][] = [
  ["Hips", 0.4],
  ["Abdomen", 0.35],
  ["Torso", 0.25],
];

/** Bones driven by the lower-body layer. Everything else is upper body. */
const LOWER_BONES = new Set(["Root", "FootL", "FootR", "Body_1", "UpperLegL", "UpperLegR", "LowerLegL", "LowerLegR", "PoleTargetL", "PoleTargetR"]);

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Ground direction angle (atan2(z, x), the sim's convention) -> Object3D.rotation.y. */
const yawOf = (dirAngle: number) => Math.PI / 2 - dirAngle;

/** Filtered copies of a clip: the lower-body tracks and the upper-body tracks. */
function split(clip: THREE.AnimationClip): { lower: THREE.AnimationClip; upper: THREE.AnimationClip } {
  const isLower = (t: THREE.KeyframeTrack) => LOWER_BONES.has(t.name.slice(0, t.name.lastIndexOf(".")));
  return {
    lower: new THREE.AnimationClip(`${clip.name}_lower`, clip.duration, clip.tracks.filter(isLower)),
    upper: new THREE.AnimationClip(`${clip.name}_upper`, clip.duration, clip.tracks.filter((t) => !isLower(t))),
  };
}

/** Split clips are built once per character file and shared by every instance. */
const splitCache = new WeakMap<GLTF, Map<string, { lower: THREE.AnimationClip; upper: THREE.AnimationClip; full: THREE.AnimationClip }>>();
function clipsOf(gltf: GLTF) {
  let m = splitCache.get(gltf);
  if (!m) {
    m = new Map();
    for (const c of gltf.animations) m.set(c.name, { ...split(c), full: c });
    splitCache.set(gltf, m);
  }
  return m;
}

export interface CharacterState {
  /** Where the character is drawn (its velocity comes from these). */
  x: number;
  z: number;
  /** Aim, as a ground direction angle. */
  aim: number;
  alive: boolean;
  weapon: number;
}

/**
 * An animated Toon Shooter character.
 *
 * Three.js has no bone masks, so every clip is split into two filtered copies,
 * one with the hip/leg tracks and one with the spine/arms/head tracks, and both
 * halves play on the same mixer. The legs play Idle or Run and face the way the
 * character moves (from its drawn velocity, so the local and the remote player
 * go through the same code). The upper half plays an aiming clip, and after the
 * mixer has posed the skeleton the spine is twisted by (aim - legs) so the gun
 * points at the cursor. Past ~105 degrees the legs flip round and the Run clip
 * plays backwards: a backpedal. See `update`.
 */
export class Character {
  readonly root = new THREE.Group();
  private lean = new THREE.Group();
  private yawNode = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private materials: THREE.MeshStandardMaterial[] = [];
  private guns: THREE.Object3D[] = [];
  /** Barrel tip of each gun, in the gun's local space. */
  private tips: THREE.Vector3[] = [];
  /** Spine bones and their share of the twist; `pose` = the mixer's value before the twist. */
  private spine: { bone: THREE.Bone; share: number; pose: THREE.Quaternion }[] = [];

  private lowerIdle: THREE.AnimationAction;
  private lowerRun: THREE.AnimationAction;
  private upperIdle: THREE.AnimationAction;
  private upperShoot: THREE.AnimationAction;
  private upperRun: THREE.AnimationAction;
  private upperHit: THREE.AnimationAction;
  private death: THREE.AnimationAction;

  // Blend weights, eased every frame toward their targets.
  private wRun = 0;
  private wShoot = 0;

  private legs = 0;
  private backpedal = false;
  private weapon = -1;
  private alive = true;
  private lastX = NaN;
  private lastZ = 0;
  private vx = 0;
  private vz = 0;
  private leanAmount = 0;
  private shotAt = -1e9;
  private hitAt = -1e9;
  private flashAt = -1e9;
  /** Hit reaction scheduled for later (remote players are drawn 100 ms late). */
  private pendingHit = Infinity;

  constructor(gltf: GLTF, tint: THREE.Color) {
    this.model = cloneSkinned(gltf.scene);
    this.model.scale.setScalar(MODEL_SCALE);
    this.root.add(this.lean);
    this.lean.add(this.yawNode);
    this.yawNode.add(this.model);

    // Materials are shared by every clone: copy them per instance before
    // tinting or flashing, or both players change colour together.
    const copies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false; // skinned bounds don't follow the animation
      const src = mesh.material as THREE.MeshStandardMaterial;
      let mat = copies.get(src);
      if (!mat) {
        mat = src.clone();
        if (src.name === "Character_Main" || src.name === "Enemy_Red") mat.color.copy(tint);
        copies.set(src, mat);
        this.materials.push(mat);
      }
      mesh.material = mat;
    });

    for (const name of GUN_NODES) {
      const gun = this.model.getObjectByName(name) ?? new THREE.Object3D();
      // The kit's guns are huge next to the body; a bit smaller reads better
      // from above and keeps the muzzle closer to where bullets start.
      gun.scale.multiplyScalar(GUN_SCALE);
      this.guns.push(gun);
    }
    for (const [name, share] of TWIST_SPLIT) {
      const bone = this.model.getObjectByName(name) as THREE.Bone | undefined;
      if (bone) this.spine.push({ bone, share, pose: bone.quaternion.clone() });
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    const clips = clipsOf(gltf);
    const get = (name: string) => clips.get(name) ?? clips.get("Idle")!;
    const act = (clip: THREE.AnimationClip, loop = true) => {
      const a = this.mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.play();
      a.weight = 0;
      return a;
    };
    this.lowerIdle = act(get("Idle").lower);
    this.lowerRun = act(get("Run").lower);
    // Standing and not shooting: the first frame of Idle_Shoot, held. The
    // kit's Idle lowers the gun, which reads badly for a twin-stick aim.
    // (A copy of the clip: the mixer keeps one action per clip object.)
    this.upperIdle = act(get("Idle_Shoot").upper.clone());
    this.upperIdle.timeScale = 0;
    this.upperShoot = act(get("Idle_Shoot").upper);
    this.upperRun = act(get("Run_Shoot").upper);
    this.upperHit = act(get("HitReact").upper, false);
    this.death = act(get("Death").full, false);
    this.lowerIdle.weight = 1;
    this.upperIdle.weight = 1;

    this.computeTips();
    this.setWeapon(0);
  }

  /** Finds each gun's barrel tip: the end of its bounding box that points forward in the aiming pose. */
  private computeTips() {
    this.mixer.update(0);
    this.upperShoot.weight = 1;
    this.upperIdle.weight = 0;
    this.mixer.update(0.01);
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4();
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    const fwd = new THREE.Vector3();
    for (const gun of this.guns) {
      inv.copy(gun.matrixWorld).invert();
      box.makeEmpty();
      gun.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.computeBoundingBox();
        tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
        box.union(tmp);
      });
      // Model forward (+Z of the yaw node) expressed in the gun's local frame.
      fwd.set(0, 0, 1).transformDirection(this.root.matrixWorld).transformDirection(inv);
      const tip = new THREE.Vector3();
      if (box.isEmpty()) {
        this.tips.push(tip);
        continue;
      }
      box.getCenter(tip);
      const ax = Math.abs(fwd.x) > Math.abs(fwd.y) ? (Math.abs(fwd.x) > Math.abs(fwd.z) ? "x" : "z") : Math.abs(fwd.y) > Math.abs(fwd.z) ? "y" : "z";
      tip[ax] = fwd[ax] > 0 ? box.max[ax] : box.min[ax];
      this.tips.push(tip);
    }
    this.upperShoot.weight = 0;
    this.upperIdle.weight = 1;
  }

  setWeapon(w: number) {
    if (w === this.weapon) return;
    this.weapon = w;
    this.guns.forEach((g, i) => (g.visible = i === w));
  }

  /** A shot was fired (keeps the aiming pose up while standing). */
  shot(now: number) {
    this.shotAt = now;
  }

  /** HP went down: flash now or at `at`, and play the hit reaction then. */
  hit(at: number) {
    this.pendingHit = Math.min(this.pendingHit, at);
  }

  /** World position of the barrel tip of the gun in hand. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    const gun = this.guns[this.weapon];
    if (!gun) return this.root.getWorldPosition(out).setY(1);
    gun.updateWorldMatrix(true, false);
    return out.copy(this.tips[this.weapon]).applyMatrix4(gun.matrixWorld);
  }

  /** Current speed in m/s (smoothed), for the dash streak. */
  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * Frees what this instance owns: its material copies, its skeletons' bone
   * textures and the mixer's cached actions. The geometry is shared with the
   * loaded file and stays.
   */
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const m of this.materials) m.dispose();
    this.model.traverse((o) => {
      const sk = (o as THREE.SkinnedMesh).skeleton;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && sk) sk.dispose();
    });
  }

  update(now: number, dt: number, s: CharacterState) {
    const p = s;
    this.setWeapon(s.weapon);

    // --- Velocity from the drawn positions (same for local and remote). ---
    if (Number.isNaN(this.lastX) || dt <= 0) {
      this.lastX = p.x;
      this.lastZ = p.z;
    }
    if (dt > 0) {
      const dx = p.x - this.lastX;
      const dz = p.z - this.lastZ;
      this.lastX = p.x;
      this.lastZ = p.z;
      if (Math.hypot(dx, dz) > 3) {
        // Teleport (respawn): not motion.
        this.vx = this.vz = 0;
      } else {
        const k = 1 - Math.exp(-dt / 0.06);
        this.vx += (dx / dt - this.vx) * k;
        this.vz += (dz / dt - this.vz) * k;
      }
    }
    const speed = this.speed;

    // --- Death and respawn. ---
    if (s.alive !== this.alive) {
      this.alive = s.alive;
      if (!s.alive) {
        this.death.reset().play();
        this.death.weight = 1;
      } else {
        this.death.stop();
        this.death.weight = 0;
        this.legs = s.aim;
        this.backpedal = false;
      }
    }

    if (now >= this.pendingHit) {
      this.pendingHit = Infinity;
      this.flashAt = now;
      if (this.alive) {
        this.hitAt = now;
        this.upperHit.reset().play();
      }
    }

    const moving = this.alive && speed > MOVING_SPEED;
    const moveDir = Math.atan2(this.vz, this.vx);

    // --- Legs: face the movement, or backpedal when aiming behind. ---
    let target = this.legs;
    if (moving) {
      const off = Math.abs(wrap(s.aim - moveDir));
      if (!this.backpedal && off > BACKPEDAL_ENTER) this.backpedal = true;
      else if (this.backpedal && off < BACKPEDAL_EXIT) this.backpedal = false;
      const base = this.backpedal ? moveDir + Math.PI : moveDir;
      // Past the twist limit the legs give way toward the aim (a crab run)
      // rather than the torso twisting further.
      const t = wrap(s.aim - base);
      target = s.aim - clamp(t, -TWIST_LIMIT, TWIST_LIMIT);
    } else {
      this.backpedal = false;
      const t = wrap(s.aim - this.legs);
      if (Math.abs(t) > IDLE_TWIST_LIMIT) target = s.aim - Math.sign(t) * IDLE_TWIST_LIMIT;
    }
    const turnRate = moving ? 14 : 8;
    // Eased, and capped so the backpedal flip is a quick visible turn
    // (~0.2 s for 150 degrees) instead of a snap.
    const maxStep = LEG_TURN_SPEED * dt;
    this.legs = wrap(this.legs + clamp(wrap(target - this.legs) * (1 - Math.exp(-turnRate * dt)), -maxStep, maxStep));
    if (this.alive) this.yawNode.rotation.y = yawOf(this.legs);

    // --- Blend weights. ---
    const ease = (w: number, to: number, rate: number) => w + (to - w) * (1 - Math.exp(-rate * dt));
    this.wRun = ease(this.wRun, moving ? 1 : 0, 12);
    const shooting = now - this.shotAt < SHOOT_POSE_MS;
    this.wShoot = ease(this.wShoot, shooting ? 1 : 0, 20);
    const dash = this.alive && speed > DASH_SPEED;
    const alive = this.alive ? 1 : 0;

    // The run plays at the rate that keeps the planted foot still, backwards
    // for a backpedal. A dash runs flat out.
    const rate = clamp(speed / (RUN_CLIP_SPEED * MODEL_SCALE), 0.6, dash ? 3 : 2.2);
    this.lowerRun.timeScale = this.backpedal ? -rate : rate;
    this.lowerRun.weight = this.wRun * alive;
    this.lowerIdle.weight = (1 - this.wRun) * alive;
    // The upper run clip rides the same cycle as the legs so the bob matches.
    this.upperRun.time = this.lowerRun.time;
    this.upperRun.timeScale = this.lowerRun.timeScale;
    const hitT = (now - this.hitAt) / HIT_MS;
    const wHit = this.alive && hitT < 1 ? 0.85 * Math.sin(Math.PI * Math.min(1, hitT * 1.6)) ** 0.5 * (1 - hitT) : 0;
    const upper = alive * (1 - wHit);
    this.upperRun.weight = upper * this.wRun;
    this.upperShoot.weight = upper * (1 - this.wRun) * this.wShoot;
    this.upperIdle.weight = upper * (1 - this.wRun) * (1 - this.wShoot);
    this.upperHit.weight = wHit;
    this.death.weight = 1 - alive;

    // The mixer only writes a bone when its animated value changes, so undo
    // last frame's twist first or it would pile up on a still pose.
    for (const s of this.spine) s.bone.quaternion.copy(s.pose);
    this.mixer.update(dt);
    for (const s of this.spine) s.pose.copy(s.bone.quaternion);

    // --- Torso twist, written on top of the mixer's pose. ---
    if (this.alive) {
      const twist = clamp(wrap(s.aim - this.legs), -TWIST_HARD_LIMIT, TWIST_HARD_LIMIT);
      this.twistSpine(-twist); // direction angles turn the other way from rotation.y
    }

    // --- Dash lean: tip the whole body toward the motion. ---
    this.leanAmount = ease(this.leanAmount, dash ? 1 : 0, dash ? 30 : 10);
    if (this.leanAmount > 0.01 && speed > 0.1) {
      _axis.set(this.vz, 0, -this.vx).normalize(); // up x velocity
      this.lean.quaternion.setFromAxisAngle(_axis, 0.45 * this.leanAmount);
    } else this.lean.quaternion.identity();

    // --- Hit flash: white, then red, fading. ---
    const f = (now - this.flashAt) / 160;
    const on = f >= 0 && f < 1;
    for (const m of this.materials) {
      if (on) {
        m.emissive.copy(f < 0.35 ? _white : _red);
        m.emissiveIntensity = f < 0.35 ? 0.9 : 0.9 * (1 - f);
      } else if (m.emissiveIntensity !== 0) {
        m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = 0;
      }
    }
  }

  /** Rotates the spine about the world vertical by `angle`, spread over a few bones. */
  private twistSpine(angle: number) {
    if (this.spine.length === 0) return;
    // Orientation of the first spine bone's parent relative to the model,
    // walked up by hand: only the chain above matters, and the mixer has just
    // written these local quaternions.
    _q.identity();
    for (let o: THREE.Object3D | null = this.spine[0].bone.parent; o && o !== this.model; o = o.parent) _q.premultiply(o.quaternion);
    for (const { bone, share } of this.spine) {
      // Up, expressed in this bone's parent frame.
      _axis.set(0, 1, 0).applyQuaternion(_qi.copy(_q).invert());
      _twist.setFromAxisAngle(_axis, angle * share);
      bone.quaternion.premultiply(_twist);
      _q.multiply(bone.quaternion);
    }
  }
}

const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _twist = new THREE.Quaternion();
const _white = new THREE.Color(0xffffff);
const _red = new THREE.Color(0xff2020);

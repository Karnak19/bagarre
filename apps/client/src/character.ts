import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { PLAYER_SPEED, WEAPONS } from "@bagarre/shared";
import { gunView } from "./items.ts";

/**
 * World height of the `Head` bone (the base of the head) in the Idle pose, in
 * metres. Every skin is scaled so its own head bone lands here, whatever it
 * wears on top: hats never change the size, and the hitbox is the same
 * capsule for everyone. The pack's characters are big-headed: the head bone
 * sits at 2.117 of about 3.05 model units to the top of a bare head, so this
 * gives about 1.7 m to the top of the head (hats come on top), a body about
 * 0.7 m across (the physics circle is 1 m), and the gun hand in the aiming
 * pose at about 1 m, where bullets fly (BULLET_HEIGHT).
 */
export const HEAD_Y = 1.17;
/** The head bone's height in model units, in the Idle pose: the same for every skin in the pack (measured if it isn't). */
const HEAD_BONE_UNITS = 2.117;
/**
 * Ground speed of the Run clip at timeScale 1, in model units per second,
 * from the planted feet in the clip (they slide back about 4.5 to 7 u/s).
 */
const RUN_CLIP_SPEED = 5.2;
/**
 * Where the gun's grip sits in the hand: from the FistR bone's origin (the
 * wrist), along the bone (the fingers' way) and toward the palm, model units.
 */
const GRIP_ALONG = 0.14;
const GRIP_UP = -0.02;
/** Point in Shoot_OneHanded held as the aiming pose: its first frame, arm straight out, level. */
const AIM_T = 0;
/** Playback speed of the recoil (the clip is 0.54 s). */
const RECOIL_RATE = 1.5;
/** Share of the Run clip's left-arm swing used while running (the gun arm stays aimed). */
const RUN_ARM_SWING = 0.6;

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
const HIT_MS = 380;
/**
 * The melee swing: the pack's clips (anims.glb) have no strike, so it is
 * drawn by hand on top of the aiming pose. The torso winds up a little,
 * whips across through the aim, and comes back (SWING_KEYS: time share ->
 * share of SWING_TWIST), leaning into it. Over in SWING_MS, well inside the
 * cooldown.
 */
const SWING_MS = 280;
const SWING_TWIST = 75 * DEG;
const SWING_LEAN = 0.3;
const SWING_KEYS: [number, number][] = [
  [0, 0],
  [0.2, 0.45],
  [0.48, -1],
  [1, 0],
];
/** Share of the torso twist taken by each spine bone, bottom to top. */
const TWIST_SPLIT: [string, number][] = [
  ["Hips", 0.4],
  ["Abdomen", 0.35],
  ["Torso", 0.25],
];

/**
 * Bones driven by the lower-body layer. Everything else is upper body.
 * `Bone` is the rig's root, `Body` the pelvis above it (it carries the run's
 * bob, in place: the clips have no root motion), the feet and pole targets
 * are the leg IK targets, children of the root.
 */
const LOWER_BONES = new Set(["Bone", "Body", "FootL", "FootR", "UpperLegL", "UpperLegR", "LowerLegL", "LowerLegR", "PoleTargetL", "PoleTargetR"]);
/** The arm without the gun, which may swing while running. */
const LEFT_ARM = new Set(["ShoulderL", "UpperArmL", "LowerArmL", "FistL"]);

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Ground direction angle (atan2(z, x), the sim's convention) -> Object3D.rotation.y. */
const yawOf = (dirAngle: number) => Math.PI / 2 - dirAngle;

const boneOf = (t: THREE.KeyframeTrack) => t.name.slice(0, t.name.lastIndexOf("."));

/** Filtered copies of a clip, by which bones their tracks drive. */
interface SplitClip {
  full: THREE.AnimationClip;
  /** Hips and legs. */
  lower: THREE.AnimationClip;
  /** Spine, arms, head. */
  upper: THREE.AnimationClip;
  /** The upper body without the left arm. */
  upperNoArm: THREE.AnimationClip;
  /** The left arm alone. */
  armL: THREE.AnimationClip;
}
function split(clip: THREE.AnimationClip): SplitClip {
  const sub = (name: string, keep: (bone: string) => boolean) =>
    new THREE.AnimationClip(`${clip.name}_${name}`, clip.duration, clip.tracks.filter((t) => keep(boneOf(t))));
  return {
    full: clip,
    lower: sub("lower", (b) => LOWER_BONES.has(b)),
    upper: sub("upper", (b) => !LOWER_BONES.has(b)),
    upperNoArm: sub("upperNoArm", (b) => !LOWER_BONES.has(b) && !LEFT_ARM.has(b)),
    armL: sub("armL", (b) => LEFT_ARM.has(b)),
  };
}

/**
 * Split clips are built once from the shared clips file and used by every
 * character: the tracks name bones (`FistR.quaternion`), and every skin has
 * the same rig, so the mixer on each clone binds them by name.
 */
const splitCache = new WeakMap<THREE.AnimationClip[], Map<string, SplitClip>>();
function clipsOf(clips: THREE.AnimationClip[]) {
  let m = splitCache.get(clips);
  if (!m) {
    m = new Map();
    for (const c of clips) m.set(c.name, split(c));
    splitCache.set(clips, m);
  }
  return m;
}

/** What every character is made from besides its skin: the shared clips and the gun templates (assets.ts). */
export interface CharacterKit {
  clips: THREE.AnimationClip[];
  /** By weapon id; a null one is drawn without a gun. */
  guns: readonly (THREE.Object3D | null)[];
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
 * An animated character: one skin of the Ultimate Animated Character Pack,
 * played by the shared clips, with the gun of the weapon in hand.
 *
 * Three.js has no bone masks, so every clip is split into filtered copies,
 * one with the hip/leg tracks and one with the spine/arms/head tracks, and
 * both halves play on the same mixer. The legs play Idle or Run and face the
 * way the character moves (from its drawn velocity, so the local and the
 * remote player go through the same code). The upper half holds the first
 * frame of Shoot_OneHanded (the gun arm straight out) and plays the whole
 * clip as the recoil. After the mixer has posed the skeleton the spine is
 * twisted by (aim - legs) so the gun points at the cursor. Past ~105 degrees
 * the legs flip round and the Run clip plays backwards: a backpedal. See
 * `update`.
 */
export class Character {
  readonly root = new THREE.Group();
  private lean = new THREE.Group();
  private yawNode = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private materials: THREE.MeshStandardMaterial[] = [];
  /** One gun per weapon id (null: no model), all under the right hand, one visible. */
  private guns: (THREE.Object3D | null)[] = [];
  /** Spine bones and their share of the twist; `pose` = the mixer's value before the twist. */
  private spine: { bone: THREE.Bone; share: number; pose: THREE.Quaternion }[] = [];
  /** World metres per model unit, set so the head bone is at HEAD_Y. */
  readonly scale: number;

  private lowerIdle: THREE.AnimationAction;
  private lowerRun: THREE.AnimationAction;
  /** The aiming pose, held: the upper body but the left arm, and the left arm. */
  private aimBody: THREE.AnimationAction;
  private aimArm: THREE.AnimationAction;
  /** The left arm's swing from the Run clip. */
  private runArm: THREE.AnimationAction;
  private recoil: THREE.AnimationAction;
  private upperHit: THREE.AnimationAction;
  private death: THREE.AnimationAction;

  // Blend weights, eased every frame toward their targets.
  private wRun = 0;

  private legs = 0;
  private backpedal = false;
  private weapon = -1;
  private alive = true;
  private lastX = NaN;
  private lastZ = 0;
  private vx = 0;
  private vz = 0;
  private leanAmount = 0;
  private hitAt = -1e9;
  private flashAt = -1e9;
  /** Hit reaction scheduled for later (remote players are drawn 100 ms late). */
  private pendingHit = Infinity;
  /** Melee swing: when the current one started, and one scheduled for later (like `pendingHit`). */
  private swingAt = -1e9;
  private pendingSwing = Infinity;

  /** `skin`: the loaded skin's scene (assets.ts' skinModel), cloned here, never changed. */
  constructor(
    skin: THREE.Object3D,
    kit: CharacterKit,
  ) {
    this.model = cloneSkinned(skin);

    // Materials are shared by every clone: copy them per instance before
    // flashing, or every player wearing that skin flashes together. The
    // meshes of one skin share one skeleton in the file; SkeletonUtils gives
    // each clone its own copy, so share one again (one bone texture).
    const copies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const skeletons: THREE.Skeleton[] = [];
    this.model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false; // skinned bounds don't follow the animation
      if (mesh.isSkinnedMesh) {
        const same = skeletons.find((s) => s.bones.length === mesh.skeleton.bones.length && s.bones.every((b, i) => b === mesh.skeleton.bones[i]));
        if (same) {
          mesh.skeleton.dispose();
          mesh.skeleton = same;
        } else skeletons.push(mesh.skeleton);
      }
      const src = mesh.material as THREE.MeshStandardMaterial;
      let mat = copies.get(src);
      if (!mat) {
        mat = src.clone();
        copies.set(src, mat);
        this.materials.push(mat);
      }
      mesh.material = mat;
    });

    for (const [name, share] of TWIST_SPLIT) {
      const bone = this.model.getObjectByName(name) as THREE.Bone | undefined;
      if (bone) this.spine.push({ bone, share, pose: bone.quaternion.clone() });
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    const clips = clipsOf(kit.clips);
    const get = (name: string) => clips.get(name) ?? clips.get("Idle") ?? [...clips.values()][0];
    const act = (clip: THREE.AnimationClip, loop = true) => {
      const a = this.mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.play();
      a.weight = 0;
      return a;
    };
    const shoot = get("Shoot_OneHanded");
    this.lowerIdle = act(get("Idle").lower);
    this.lowerRun = act(get("Run").lower);
    // The pack's Idle lets the arms hang, which reads badly for a twin-stick
    // aim: the upper body holds Shoot_OneHanded's first frame instead.
    // (Copies of the clips: the mixer keeps one action per clip object, and
    // the recoil plays the same one.)
    this.aimBody = act(shoot.upperNoArm.clone());
    this.aimArm = act(shoot.armL.clone());
    for (const a of [this.aimBody, this.aimArm]) {
      a.time = AIM_T * shoot.full.duration;
      a.timeScale = 0;
    }
    this.runArm = act(get("Run").armL);
    this.recoil = act(shoot.upperNoArm, false);
    this.recoil.timeScale = RECOIL_RATE;
    this.recoil.stop();
    this.upperHit = act(get("RecieveHit").upper, false);
    this.death = act(get("Death").full, false);

    // Measure the head in the Idle pose, then scale to HEAD_Y.
    const idle = this.mixer.clipAction(get("Idle").full);
    idle.play();
    idle.weight = 1;
    this.mixer.update(0);
    this.model.updateMatrixWorld(true);
    const head = this.model.getObjectByName("Head");
    const headY = head ? head.getWorldPosition(_v).y : HEAD_BONE_UNITS;
    idle.stop();
    this.mixer.uncacheAction(idle.getClip(), this.model);
    this.scale = HEAD_Y / (headY > 0.5 && headY < 6 ? headY : HEAD_BONE_UNITS);

    // The aiming pose, where the gun is fitted to the hand.
    this.lowerIdle.weight = 1;
    this.aimBody.weight = 1;
    this.aimArm.weight = 1;
    this.mixer.update(0);
    this.model.updateMatrixWorld(true);
    this.fitGuns(kit.guns);

    this.model.scale.setScalar(this.scale);
    this.root.add(this.lean);
    this.lean.add(this.yawNode);
    this.yawNode.add(this.model);
    this.setWeapon(0);
  }

  /**
   * Puts one clone of each gun in the right hand. In the aiming pose (the
   * skeleton is posed so when this runs, the model unscaled at the origin)
   * the barrel (+X in the gun files) points straight ahead, level (+Z of the
   * model) and the gun's top up, whatever the hand bone's own axes are, and
   * the grip sits in the fist. The recoil and the spine twist then move the
   * hand, and the gun with it.
   */
  private fitGuns(templates: readonly (THREE.Object3D | null)[]) {
    const fist = this.model.getObjectByName("FistR");
    if (!fist) {
      this.guns = templates.map(() => null);
      return;
    }
    const fistQ = fist.getWorldQuaternion(new THREE.Quaternion());
    const fistScale = fist.getWorldScale(new THREE.Vector3()).x || 1;
    // Barrel along the model's forward, top up: +X -> +Z, a quarter turn about Y.
    const want = new THREE.Quaternion().setFromAxisAngle(_up, -Math.PI / 2);
    const hand = new THREE.Group();
    hand.name = "GunHand";
    hand.quaternion.copy(fistQ).invert().multiply(want);
    hand.scale.setScalar(1 / fistScale);
    // The grip: a little along the bone (toward the fingers) and up from the wrist, in the fist's frame.
    hand.position.set(0, GRIP_ALONG, 0).add(new THREE.Vector3(0, GRIP_UP, 0).applyQuaternion(_qi.copy(fistQ).invert())).divideScalar(fistScale);
    fist.add(hand);
    // Material copies here too, like the body's: they flash with it, and are
    // freed with the character, so no gun keeps its shaders once nobody holds it.
    const copies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const own = (o: THREE.Object3D) => {
      o.castShadow = true;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      let mat = copies.get(src);
      if (!mat) {
        mat = src.clone();
        copies.set(src, mat);
        this.materials.push(mat);
      }
      mesh.material = mat;
    };
    this.guns = templates.map((t, w) => {
      if (!t || !WEAPONS[w]) return null;
      const { model: def, scale: s } = gunView(w);
      const gun = t.clone();
      gun.scale.setScalar(s);
      gun.position.set(-def.grip[0] * s, -def.grip[1] * s, -def.grip[2] * s);
      gun.visible = false;
      gun.traverse(own);
      hand.add(gun);
      return gun;
    });
  }

  setWeapon(w: number) {
    if (w === this.weapon) return;
    this.weapon = w;
    this.guns.forEach((g, i) => g && (g.visible = i === w));
  }

  /**
   * A shot was fired: the recoil. It plays from its start, and a shot while
   * it's still playing doesn't restart it (the SMG fires every 0.1 s; the
   * kick lasts about 0.36 s): every kick starts and ends in the aiming pose,
   * so nothing jumps.
   */
  shot(_now: number) {
    if (this.recoil.isRunning()) return;
    this.recoil.reset().play();
  }

  /** HP went down: flash now or at `at`, and play the hit reaction then. */
  hit(at: number) {
    this.pendingHit = Math.min(this.pendingHit, at);
  }

  /** A melee strike: the swing, now or at `at` (a remote player's is drawn 100 ms late). */
  melee(at: number) {
    this.pendingSwing = Math.min(this.pendingSwing, at);
  }

  /** World position of the barrel tip of the gun in hand. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    const gun = this.guns[this.weapon];
    if (!gun || !WEAPONS[this.weapon]) return this.root.getWorldPosition(out).setY(1);
    const def = gunView(this.weapon).model;
    gun.updateWorldMatrix(true, false);
    return out.set(def.muzzle[0], def.muzzle[1], def.muzzle[2]).applyMatrix4(gun.matrixWorld);
  }

  /** Current speed in m/s (smoothed), for the dash streak. */
  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * Frees what this instance owns: its material copies, its skeleton's bone
   * texture and the mixer's cached actions. The geometry is shared with the
   * loaded skin and the gun templates and stays.
   */
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const m of this.materials) m.dispose();
    const done = new Set<THREE.Skeleton>();
    this.model.traverse((o) => {
      const sk = (o as THREE.SkinnedMesh).skeleton;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && sk && !done.has(sk)) {
        done.add(sk);
        sk.dispose();
      }
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
        this.recoil.stop();
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

    if (now >= this.pendingSwing) {
      this.pendingSwing = Infinity;
      if (this.alive) this.swingAt = now;
    }
    const swingT = (now - this.swingAt) / SWING_MS;
    const swinging = this.alive && swingT >= 0 && swingT < 1;

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
    const dash = this.alive && speed > DASH_SPEED;
    const alive = this.alive ? 1 : 0;

    // The run plays at the rate that keeps the planted foot still, backwards
    // for a backpedal. A dash runs flat out.
    const rate = clamp(speed / (RUN_CLIP_SPEED * this.scale), 0.6, dash ? 3 : 2.2);
    this.lowerRun.timeScale = this.backpedal ? -rate : rate;
    this.lowerRun.weight = this.wRun * alive;
    this.lowerIdle.weight = (1 - this.wRun) * alive;
    // The free arm swings with the legs' cycle.
    this.runArm.time = this.lowerRun.time;
    this.runArm.timeScale = this.lowerRun.timeScale;
    const hitT = (now - this.hitAt) / HIT_MS;
    const wHit = this.alive && hitT < 1 ? 0.85 * Math.sin(Math.PI * Math.min(1, hitT * 1.6)) ** 0.5 * (1 - hitT) : 0;
    const upper = alive * (1 - wHit);
    const wRecoil = this.recoil.isRunning() ? 1 : 0;
    this.aimBody.weight = upper * (1 - wRecoil);
    this.recoil.weight = upper * wRecoil;
    const swing = RUN_ARM_SWING * this.wRun;
    this.aimArm.weight = upper * (1 - swing);
    this.runArm.weight = upper * swing;
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
      const swing = swinging ? SWING_TWIST * swingCurve(swingT) : 0;
      this.twistSpine(-twist - swing); // direction angles turn the other way from rotation.y
    }

    // --- Dash lean: tip the whole body toward the motion. ---
    this.leanAmount = ease(this.leanAmount, dash ? 1 : 0, dash ? 30 : 10);
    if (this.leanAmount > 0.01 && speed > 0.1) {
      _axis.set(this.vz, 0, -this.vx).normalize(); // up x velocity
      this.lean.quaternion.setFromAxisAngle(_axis, 0.45 * this.leanAmount);
    } else this.lean.quaternion.identity();
    // The swing leans into the aim, most as the torso whips through it.
    if (swinging) {
      _axis.set(Math.sin(s.aim), 0, -Math.cos(s.aim)); // up x aim
      this.lean.quaternion.premultiply(_q.setFromAxisAngle(_axis, SWING_LEAN * Math.sin(Math.PI * swingT)));
    }

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

/** The swing's twist at `t` (0..1), from SWING_KEYS, eased between keys. */
function swingCurve(t: number): number {
  for (let i = 1; i < SWING_KEYS.length; i++) {
    const [t1, v1] = SWING_KEYS[i];
    if (t > t1) continue;
    const [t0, v0] = SWING_KEYS[i - 1];
    const u = (t - t0) / (t1 - t0);
    return v0 + (v1 - v0) * u * u * (3 - 2 * u);
  }
  return 0;
}

const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _twist = new THREE.Quaternion();
const _white = new THREE.Color(0xffffff);
const _red = new THREE.Color(0xff2020);

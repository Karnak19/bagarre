import * as THREE from "three";
import { TICK_RATE } from "@bagarre/shared";

/**
 * Cells of vfx/particles.png, a 4 x 4 greyscale atlas built from the Kenney
 * Particle Pack (see ASSETS.md). The value is the particle's alpha.
 */
export const Cell = {
  MuzzleLong: 0, // muzzle_01
  MuzzleRound: 1, // muzzle_02
  MuzzleRifle: 2, // muzzle_04
  MuzzleSmall: 3, // muzzle_05
  Spark1: 4,
  Spark2: 5,
  Streak: 6, // trace_07
  Star: 7,
  Smoke1: 8,
  Smoke2: 9,
  Smoke3: 10,
  Fire1: 11,
  Fire2: 12,
  Scorch1: 13,
  Scorch2: 14,
  Glow: 15, // circle_05
} as const;

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Seconds. */
  life: number;
  cell: number;
  /** Width in metres at birth and at death. */
  size: number;
  sizeEnd?: number;
  /** Height / width. */
  aspect?: number;
  /** Screen-space rotation, radians (0 = the texture's up is screen up). */
  rot?: number;
  spin?: number;
  color: THREE.Color | number;
  alpha?: number;
  /** Downward acceleration, m/s². */
  gravity?: number;
  /** Velocity damping per second. */
  drag?: number;
  /** True: normal alpha blending (smoke). False: additive (fire, flashes, sparks). */
  alphaBlend?: boolean;
}

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aSize; // width, height, rotation
attribute float aCell;
attribute vec4 aColor;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  float c = cos(aSize.z), s = sin(aSize.z);
  vec2 p = position.xy * aSize.xy;
  mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  gl_Position = projectionMatrix * mv;
  vec2 cell = vec2(mod(aCell, 4.0), 3.0 - floor(aCell / 4.0));
  vUv = (cell + uv) / 4.0;
  vColor = aColor;
}`;

const FRAG_ADD = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float a = texture2D(map, vUv).r * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, a);
}`;

const FRAG_ALPHA = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float a = texture2D(map, vUv).r * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

/** A soft disc in every cell, used when the atlas didn't load. */
function fallbackAtlas(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 16; i++) {
    const x = (i % 4) * 64 + 32;
    const y = Math.floor(i / 4) * 64 + 32;
    const grad = g.createRadialGradient(x, y, 0, x, y, 30);
    grad.addColorStop(0, "#fff");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - 32, y - 32, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * One pool of camera-facing quads for one blend mode, drawn as a single
 * instanced mesh. Particles live in flat typed arrays (no allocation per
 * particle or per frame); a dead particle is replaced by the last live one.
 */
class Pool {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aSize: THREE.InstancedBufferAttribute;
  private aCell: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private n = 0;
  // Simulation state, 1 slot per particle.
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size0: Float32Array;
  private size1: Float32Array;
  private aspect: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private alpha: Float32Array;
  private gravity: Float32Array;
  private drag: Float32Array;
  private cell: Float32Array;
  /** The per-particle scalar arrays, for compaction. */
  private scalars: Float32Array[];
  private attrs: THREE.InstancedBufferAttribute[];

  constructor(
    readonly capacity: number,
    map: THREE.Texture,
    alphaBlend: boolean,
  ) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute("position", quad.getAttribute("position"));
    this.geo.setAttribute("uv", quad.getAttribute("uv"));
    const attr = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = attr(3);
    this.aSize = attr(3);
    this.aCell = attr(1);
    this.aColor = attr(4);
    this.geo.setAttribute("aPos", this.aPos);
    this.geo.setAttribute("aSize", this.aSize);
    this.geo.setAttribute("aCell", this.aCell);
    this.geo.setAttribute("aColor", this.aColor);
    this.geo.instanceCount = 0;

    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map } },
      vertexShader: VERT,
      fragmentShader: alphaBlend ? FRAG_ALPHA : FRAG_ADD,
      transparent: true,
      depthWrite: false,
      blending: alphaBlend ? THREE.NormalBlending : THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = alphaBlend ? 10 : 11;

    const f = (k: number) => new Float32Array(capacity * k);
    this.pos = f(3);
    this.vel = f(3);
    this.col = f(3);
    this.age = f(1);
    this.life = f(1);
    this.size0 = f(1);
    this.size1 = f(1);
    this.aspect = f(1);
    this.rot = f(1);
    this.spin = f(1);
    this.alpha = f(1);
    this.gravity = f(1);
    this.drag = f(1);
    this.cell = f(1);
    this.scalars = [this.age, this.life, this.size0, this.size1, this.aspect, this.rot, this.spin, this.alpha, this.gravity, this.drag, this.cell];
    this.attrs = [this.aPos, this.aSize, this.aCell, this.aColor];
  }

  spawn(s: ParticleSpec) {
    // Full pool: recycle the oldest-ish slot (index 0) rather than dropping the effect.
    const i = this.n < this.capacity ? this.n++ : 0;
    this.pos[i * 3] = s.x;
    this.pos[i * 3 + 1] = s.y;
    this.pos[i * 3 + 2] = s.z;
    this.vel[i * 3] = s.vx ?? 0;
    this.vel[i * 3 + 1] = s.vy ?? 0;
    this.vel[i * 3 + 2] = s.vz ?? 0;
    const c = typeof s.color === "number" ? _c.setHex(s.color) : s.color;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.age[i] = 0;
    this.life[i] = s.life;
    this.size0[i] = s.size;
    this.size1[i] = s.sizeEnd ?? s.size;
    this.aspect[i] = s.aspect ?? 1;
    this.rot[i] = s.rot ?? 0;
    this.spin[i] = s.spin ?? 0;
    this.alpha[i] = s.alpha ?? 1;
    this.gravity[i] = s.gravity ?? 0;
    this.drag[i] = s.drag ?? 0;
    this.cell[i] = s.cell;
  }

  private copy(from: number, to: number) {
    for (let j = 0; j < 3; j++) {
      this.pos[to * 3 + j] = this.pos[from * 3 + j];
      this.vel[to * 3 + j] = this.vel[from * 3 + j];
      this.col[to * 3 + j] = this.col[from * 3 + j];
    }
    for (const a of this.scalars) a[to] = a[from];
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.n--;
        if (i !== this.n) this.copy(this.n, i);
        continue;
      }
      i++;
    }
    const P = this.aPos.array as Float32Array;
    const S = this.aSize.array as Float32Array;
    const C = this.aCell.array as Float32Array;
    const K = this.aColor.array as Float32Array;
    for (i = 0; i < this.n; i++) {
      const i3 = i * 3;
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= damp;
      this.vel[i3 + 1] = this.vel[i3 + 1] * damp - this.gravity[i] * dt;
      this.vel[i3 + 2] *= damp;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
      const t = this.age[i] / this.life[i];
      const e = 1 - (1 - t) * (1 - t); // ease-out growth
      const w = this.size0[i] + (this.size1[i] - this.size0[i]) * e;
      P[i3] = this.pos[i3];
      P[i3 + 1] = this.pos[i3 + 1];
      P[i3 + 2] = this.pos[i3 + 2];
      S[i3] = w;
      S[i3 + 1] = w * this.aspect[i];
      S[i3 + 2] = this.rot[i];
      C[i] = this.cell[i];
      // Quick fade-in (first 8%), then fade out.
      const a = this.alpha[i] * Math.min(1, t / 0.08) * (1 - t) * (1 - t * 0.3);
      K[i * 4] = this.col[i3];
      K[i * 4 + 1] = this.col[i3 + 1];
      K[i * 4 + 2] = this.col[i3 + 2];
      K[i * 4 + 3] = a;
    }
    this.geo.instanceCount = this.n;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      if (this.n > 0) {
        a.addUpdateRange(0, this.n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }
}

const _c = new THREE.Color();

/** Flat ground decals (grenade scorch marks) that fade out. */
class Decals {
  private items: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; born: number }[] = [];
  private next = 0;

  constructor(
    scene: THREE.Scene,
    map: THREE.Texture,
    count: number,
    private life: number,
  ) {
    for (let i = 0; i < count; i++) {
      const geo = new THREE.PlaneGeometry(1, 1);
      // Point the UVs at the scorch cells.
      const cell = i % 2 === 0 ? Cell.Scorch1 : Cell.Scorch2;
      const cx = cell % 4;
      const cy = 3 - Math.floor(cell / 4);
      const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
      for (let v = 0; v < uv.count; v++) uv.setXY(v, (cx + uv.getX(v)) / 4, (cy + uv.getY(v)) / 4);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x0c0a08,
        alphaMap: map,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      this.items.push({ mesh, mat, born: -1e9 });
    }
  }

  add(x: number, z: number, size: number, now: number) {
    const d = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    d.mesh.position.set(x, 0.015, z);
    d.mesh.rotation.z = Math.random() * Math.PI * 2;
    d.mesh.scale.setScalar(size);
    d.mesh.visible = true;
    d.born = now;
  }

  update(now: number) {
    for (const d of this.items) {
      if (!d.mesh.visible) continue;
      const t = (now - d.born) / this.life;
      if (t >= 1) {
        d.mesh.visible = false;
        continue;
      }
      d.mat.opacity = 0.85 * Math.min(1, t * 20) * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
    }
  }
}

/** A smoke cloud to draw: where, and the server ticks it lives between. */
export interface SmokeCloud {
  id: string;
  x: number;
  z: number;
  start: number;
  end: number;
}

/** Most clouds drawn at once (8 players, a 12 s cooldown for an 8 s cloud: never more than 8). */
const SMOKE_CLOUDS = 8;
/** Camera-facing puffs per cloud. */
const SMOKE_PUFFS = 18;
/** Ticks a cloud takes to billow out, and to thin away at the end. */
const SMOKE_IN = 18;
const SMOKE_OUT = 45;

/** Deterministic 0..1 from a cloud id and a puff index, so a cloud looks the same every frame. */
function puffRand(seed: number, i: number, k: number): number {
  let h = Math.imul(seed ^ (i * 0x9e3779b1) ^ (k * 0x85ebca6b), 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h | 0;
}

/**
 * The smoke clouds: a few large camera-facing puffs per cloud, all clouds in
 * one instanced mesh (one draw call), rewritten each frame from the synced
 * cloud list. No particle system: a cloud is a fixed set of puffs that
 * billow in, drift a little and thin out before it clears.
 */
class SmokeLayer {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aSize: THREE.InstancedBufferAttribute;
  private aCell: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;

  constructor(map: THREE.Texture) {
    const cap = SMOKE_CLOUDS * SMOKE_PUFFS;
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute("position", quad.getAttribute("position"));
    this.geo.setAttribute("uv", quad.getAttribute("uv"));
    const attr = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = attr(3);
    this.aSize = attr(3);
    this.aCell = attr(1);
    this.aColor = attr(4);
    this.geo.setAttribute("aPos", this.aPos);
    this.geo.setAttribute("aSize", this.aSize);
    this.geo.setAttribute("aCell", this.aCell);
    this.geo.setAttribute("aColor", this.aColor);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map } },
      vertexShader: VERT,
      fragmentShader: FRAG_ALPHA,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    // Over the characters and the other smoke, under the name plates (which smoke hides by skipping them).
    this.mesh.renderOrder = 9;
  }

  /** Draws `clouds` as they are at server tick `tick` (fractional), `radius` metres wide. */
  set(clouds: readonly SmokeCloud[], tick: number, radius: number) {
    const P = this.aPos.array as Float32Array;
    const S = this.aSize.array as Float32Array;
    const C = this.aCell.array as Float32Array;
    const K = this.aColor.array as Float32Array;
    let n = 0;
    const t = tick / TICK_RATE;
    for (const c of clouds.slice(0, SMOKE_CLOUDS)) {
      const age = tick - c.start;
      const left = c.end - tick;
      if (left <= 0 || age < 0) continue;
      const grow = Math.min(1, age / SMOKE_IN);
      const fade = Math.min(1, grow * 1.5, left / SMOKE_OUT);
      const spread = 0.35 + 0.65 * (1 - (1 - grow) * (1 - grow));
      const seed = seedOf(c.id);
      for (let i = 0; i < SMOKE_PUFFS; i++) {
        const a = puffRand(seed, i, 1) * Math.PI * 2 + t * (0.05 + 0.05 * puffRand(seed, i, 2));
        const r = radius * 0.78 * Math.sqrt(puffRand(seed, i, 3)) * spread;
        const y = 0.35 + puffRand(seed, i, 4) * 1.9 + Math.sin(t * 0.7 + i) * 0.08;
        const size = (2.4 + puffRand(seed, i, 5) * 1.6) * (0.6 + 0.4 * spread);
        const g = 0.6 + puffRand(seed, i, 6) * 0.14;
        P[n * 3] = c.x + Math.cos(a) * r;
        P[n * 3 + 1] = y;
        P[n * 3 + 2] = c.z + Math.sin(a) * r;
        S[n * 3] = size;
        S[n * 3 + 1] = size;
        S[n * 3 + 2] = puffRand(seed, i, 7) * 6.28 + t * (puffRand(seed, i, 8) - 0.5) * 0.4;
        C[n] = Cell.Smoke1 + (i % 3);
        K[n * 4] = g;
        K[n * 4 + 1] = g * 0.98;
        K[n * 4 + 2] = g * 0.95;
        K[n * 4 + 3] = 0.82 * fade;
        n++;
      }
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) for (const a of [this.aPos, this.aSize, this.aCell, this.aColor]) a.needsUpdate = true;
  }
}

/** A gun's muzzle flash: atlas cell, width and length in metres (GUN_VIEW in items.ts). */
export interface MuzzleFlash {
  cell: number;
  w: number;
  h: number;
}

/** All the sprite effects: muzzle flashes, impact sparks, explosions, dust. */
export class Vfx {
  private add: Pool;
  private alpha: Pool;
  private decals: Decals;
  private smoke: SmokeLayer;
  private tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private camera: THREE.Camera,
    atlas: THREE.Texture | null,
  ) {
    const map = atlas ?? fallbackAtlas();
    this.alpha = new Pool(400, map, true);
    this.add = new Pool(600, map, false);
    this.smoke = new SmokeLayer(map);
    scene.add(this.alpha.mesh, this.add.mesh, this.smoke.mesh);
    this.decals = new Decals(scene, map, 6, 9000);
  }

  /** The smoke clouds on the ground this frame (see SmokeLayer). */
  smokeClouds(clouds: readonly SmokeCloud[], tick: number, radius: number) {
    this.smoke.set(clouds, tick, radius);
  }

  /** A smoke grenade pops: a quick grey puff while the cloud billows out. */
  smokePop(x: number, z: number) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.alpha.spawn({
        x, y: 0.3, z, vx: Math.cos(a) * 4, vy: 0.8, vz: Math.sin(a) * 4,
        life: 0.9, cell: Cell.Smoke1 + (i % 3), size: 0.8, sizeEnd: 2.6,
        rot: Math.random() * 6, color: 0xb8b8b4, alpha: 0.7, drag: 3,
      });
    }
  }

  /** A stun goes off: a blue-white electric ring and crackling streaks across the radius. */
  stunBurst(x: number, z: number, radius: number) {
    this.add.spawn({ x, y: 0.4, z, life: 0.2, cell: Cell.Glow, size: radius * 1.2, sizeEnd: radius * 2.2, color: 0x7fd8ff, alpha: 1 });
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 6;
      const vx = Math.cos(a) * sp;
      const vz = Math.sin(a) * sp;
      const vy = 1 + Math.random() * 2;
      this.add.spawn({
        x, y: 0.5, z, vx, vy, vz, life: 0.3 + Math.random() * 0.2,
        cell: Cell.Streak, size: 0.08, aspect: 6,
        rot: this.screenAngle(vx, vy, vz) - Math.PI / 2,
        color: i % 3 ? 0x9fe6ff : 0xffffff, alpha: 1.5, drag: 4,
      });
    }
  }

  /** Sparks crackling round a stunned player (called a few times a second while it lasts). */
  stunSparks(x: number, z: number) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.35 + Math.random() * 0.25;
    const y = 0.5 + Math.random() * 1.3;
    this.add.spawn({ x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r, life: 0.12, cell: Cell.Star, size: 0.35, sizeEnd: 0.1, rot: Math.random() * 3, color: 0x9fe6ff, alpha: 1.4 });
    this.add.spawn({ x, y: 1.1, z, life: 0.14, cell: Cell.Glow, size: 1.4, sizeEnd: 1.6, color: 0x3fa8ff, alpha: 0.25 });
  }

  /** A heal goes off: a soft green bloom across the radius and green motes drifting up out of it. */
  healBurst(x: number, z: number, radius: number) {
    this.add.spawn({ x, y: 0.3, z, life: 0.35, cell: Cell.Glow, size: radius * 1.2, sizeEnd: radius * 2.1, color: 0x5cff8a, alpha: 0.9 });
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.8;
      this.add.spawn({
        x: x + Math.cos(a) * r, y: 0.2, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * 0.6, vy: 1.6 + Math.random() * 1.6, vz: Math.sin(a) * 0.6,
        life: 0.6 + Math.random() * 0.4, cell: Cell.Star, size: 0.3, sizeEnd: 0.08,
        rot: Math.random() * 3, color: i % 3 ? 0x7dff9e : 0xd8ffe2, alpha: 1.3, drag: 1.5,
      });
    }
  }

  /** A player just got health back: a green glow on the body and a few motes rising off it. */
  healGlow(x: number, z: number) {
    this.add.spawn({ x, y: 1.1, z, life: 0.45, cell: Cell.Glow, size: 1.6, sizeEnd: 2.2, color: 0x3fe070, alpha: 0.7 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
      this.add.spawn({
        x: x + Math.cos(a) * 0.4, y: 0.6 + Math.random() * 0.6, z: z + Math.sin(a) * 0.4,
        vy: 1.4 + Math.random() * 0.8, life: 0.6, cell: Cell.Star, size: 0.28, sizeEnd: 0.1,
        rot: Math.random() * 3, color: 0x9fffb8, alpha: 1.3, drag: 1,
      });
    }
  }

  /** A flash goes off: a blinding white bloom (only the world: the white screen itself is the HUD's). */
  flashBurst(x: number, z: number) {
    this.add.spawn({ x, y: 0.8, z, life: 0.22, cell: Cell.Glow, size: 3, sizeEnd: 9, color: 0xffffff, alpha: 1.6 });
    this.add.spawn({ x, y: 0.8, z, life: 0.12, cell: Cell.Star, size: 2.5, sizeEnd: 4, rot: Math.random() * 3, color: 0xffffff, alpha: 1.6 });
  }

  /** Screen-space angle of a ground direction, for sprites that point along it. */
  private screenAngle(dx: number, dy: number, dz: number): number {
    const v = this.tmp.set(dx, dy, dz).transformDirection(this.camera.matrixWorldInverse);
    return Math.atan2(v.y, v.x);
  }

  muzzle(x: number, y: number, z: number, aim: number, m: MuzzleFlash) {
    const dx = Math.cos(aim);
    const dz = Math.sin(aim);
    // Texture points up: rotate so its up follows the barrel on screen.
    const rot = this.screenAngle(dx, 0, dz) - Math.PI / 2;
    const off = m.h * 0.42;
    this.add.spawn({ x: x + dx * off, y, z: z + dz * off, life: 0.06, cell: m.cell, size: m.w, sizeEnd: m.w * 1.15, aspect: m.h / m.w, rot, color: 0xffd9a0, alpha: 1.4 });
    this.add.spawn({ x, y, z, life: 0.08, cell: Cell.Glow, size: m.w * 1.6, sizeEnd: m.w * 2.2, color: 0xff9a40, alpha: 0.8 });
  }

  /** Bullet hit something. `dirX/dirZ` = the way the sparks fly (away from the surface). */
  sparks(x: number, y: number, z: number, dirX: number, dirZ: number, onPlayer: boolean) {
    const color = onPlayer ? 0xff6050 : 0xffd070;
    const base = Math.atan2(dirZ, dirX);
    const n = onPlayer ? 5 : 7;
    for (let i = 0; i < n; i++) {
      const a = base + (Math.random() - 0.5) * 2.2;
      const sp = 3 + Math.random() * 5;
      const vx = Math.cos(a) * sp;
      const vz = Math.sin(a) * sp;
      const vy = 1 + Math.random() * 3;
      this.add.spawn({
        x, y, z, vx, vy, vz,
        life: 0.18 + Math.random() * 0.14,
        cell: Cell.Streak,
        size: 0.08,
        aspect: 4,
        rot: this.screenAngle(vx, vy, vz) - Math.PI / 2,
        color, alpha: 1.3, gravity: 14, drag: 3,
      });
    }
    this.add.spawn({ x, y, z, life: 0.09, cell: Cell.Star, size: onPlayer ? 0.55 : 0.45, sizeEnd: 0.2, rot: Math.random() * 3, color, alpha: 1.2 });
    if (!onPlayer)
      this.alpha.spawn({ x, y, z, vy: 0.4, life: 0.5, cell: Cell.Smoke1 + ((Math.random() * 3) | 0), size: 0.3, sizeEnd: 0.8, rot: Math.random() * 6, color: 0x9a948a, alpha: 0.35 });
  }

  /** Grenade: flash, fireball, smoke, debris sparks and a scorch mark. */
  explosion(x: number, z: number, radius: number, now: number) {
    this.add.spawn({ x, y: 0.6, z, life: 0.16, cell: Cell.Glow, size: radius * 1.4, sizeEnd: radius * 2.4, color: 0xffe0a0, alpha: 1 });
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.35;
      this.add.spawn({
        x: x + Math.cos(a) * r, y: 0.4 + Math.random() * 0.6, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * 2, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * 2,
        life: 0.35 + Math.random() * 0.25,
        cell: i % 2 ? Cell.Fire1 : Cell.Fire2,
        size: 1.2 + Math.random() * 0.8, sizeEnd: 2.6 + Math.random(),
        rot: Math.random() * 6, spin: (Math.random() - 0.5) * 3,
        color: i < 3 ? 0xffe070 : 0xff7a20, alpha: 1.1, drag: 2,
      });
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.5;
      const g = 0.18 + Math.random() * 0.12;
      this.alpha.spawn({
        x: x + Math.cos(a) * r, y: 0.5 + Math.random() * 0.5, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * 1.2, vy: 1 + Math.random() * 1.2, vz: Math.sin(a) * 1.2,
        life: 1.1 + Math.random() * 0.8,
        cell: Cell.Smoke1 + (i % 3),
        size: 1.4 + Math.random(), sizeEnd: 3.2 + Math.random() * 1.5,
        rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.8,
        color: _c.setRGB(g, g * 0.95, g * 0.9), alpha: 0.75, drag: 1.2,
      });
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 8;
      const vx = Math.cos(a) * sp;
      const vz = Math.sin(a) * sp;
      const vy = 3 + Math.random() * 5;
      this.add.spawn({
        x, y: 0.5, z, vx, vy, vz, life: 0.35 + Math.random() * 0.3,
        cell: Cell.Streak, size: 0.1, aspect: 5,
        rot: this.screenAngle(vx, vy, vz) - Math.PI / 2,
        color: 0xffc060, alpha: 1.3, gravity: 16, drag: 2,
      });
    }
    this.decals.add(x, z, radius * 1.5, now);
  }

  /** Dust kicked up by a dash. */
  dust(x: number, z: number) {
    this.alpha.spawn({
      x: x + (Math.random() - 0.5) * 0.4, y: 0.15, z: z + (Math.random() - 0.5) * 0.4,
      vy: 0.5, life: 0.45, cell: Cell.Smoke1 + ((Math.random() * 3) | 0),
      size: 0.6, sizeEnd: 1.5, rot: Math.random() * 6, color: 0xc4bba8, alpha: 0.6, drag: 2,
    });
  }

  update(dt: number, now: number) {
    this.add.update(dt);
    this.alpha.update(dt);
    this.decals.update(now);
  }
}

/**
 * Shield bubble: a rim-glow (fresnel) sphere, bright at the silhouette and
 * nearly clear in the middle, in the player's colour.
 */
export function shieldMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: color.clone() }, strength: { value: 1 }, time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        // Orthographic camera: every view ray is along -Z in view space.
        vV = projectionMatrix[3][3] > 0.5 ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
        vY = position.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float strength;
      uniform float time;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), vV));
        float rim = pow(f, 2.2);
        float bands = 0.06 * (0.5 + 0.5 * sin(vY * 14.0 - time * 5.0));
        float a = (0.06 + rim * 0.9 + bands) * strength;
        gl_FragColor = vec4(mix(color, vec3(1.0), rim * 0.45) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
}

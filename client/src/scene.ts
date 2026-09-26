import * as THREE from "three";
import {
  ARENA_HALF,
  BULLET_HEIGHT,
  BULLET_RADIUS,
  GRENADE,
  OBSTACLES,
  PLAYER_SPEED,
  PLAYER_RADIUS,
  WALL_HEIGHT,
  WALL_THICKNESS,
  type GrenadeView,
} from "@bagarre/shared";

export const PLAYER_COLORS = [0xff6b4a, 0x4ab8ff];
export const PLAYER_CSS_COLORS = ["#ff6b4a", "#4ab8ff"];

/** Vertical extent of the world visible on screen, in metres. */
const VIEW_HEIGHT = 22;
const CAMERA_DISTANCE = 50;
/**
 * Classic isometric view: 45 degrees of yaw, and a pitch of atan(1/sqrt(2)),
 * about 35.26 degrees. Looking along (-1, -1, -1) gives exactly both.
 */
const CAMERA_OFFSET = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(CAMERA_DISTANCE);

export class PlayerMesh {
  readonly group = new THREE.Group();
  private bodyMat: THREE.MeshStandardMaterial;
  private flashUntil = 0;
  private baseColor: THREE.Color;
  private shield: THREE.Mesh;
  private shieldMat: THREE.MeshStandardMaterial;
  private lastPos = new THREE.Vector2();
  private lastT = 0;
  /** Drawn speed above this means a dash (walking is PLAYER_SPEED). */
  private static DASH_SPEED_VISUAL = PLAYER_SPEED * 1.8;
  /** Set when the mesh moved at dash speed since the last update. */
  dashing = false;

  constructor(color: number, isLocal: boolean) {
    this.baseColor = new THREE.Color(color);
    this.bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, flatShading: true });
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER_RADIUS, 0.8, 4, 10),
      this.bodyMat,
    );
    body.position.y = PLAYER_RADIUS + 0.4;
    body.castShadow = true;
    this.group.add(body);

    // The gun points along +X in local space; the group is rotated to aim.
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.4 });
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.18, 0.18), gunMat);
    gun.position.set(PLAYER_RADIUS + 0.2, BULLET_HEIGHT, 0);
    gun.castShadow = true;
    this.group.add(gun);

    // A little "visor" so the facing direction reads even without the gun.
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.16, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 }),
    );
    visor.position.set(PLAYER_RADIUS - 0.04, 1.35, 0);
    this.group.add(visor);

    if (isLocal) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(PLAYER_RADIUS + 0.12, PLAYER_RADIUS + 0.22, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      this.group.add(ring);
    }

    this.shieldMat = new THREE.MeshStandardMaterial({
      color: 0x9fe6ff,
      emissive: 0x3aa8ff,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 16), this.shieldMat);
    this.shield.position.y = 0.9;
    this.shield.visible = false;
    this.group.add(this.shield);
  }

  get color(): THREE.Color {
    return this.baseColor;
  }

  /** `fraction` = shield strength left (0 hides the bubble). */
  setShield(fraction: number) {
    this.shield.visible = fraction > 0;
    this.shieldMat.opacity = 0.15 + 0.3 * fraction;
  }

  setColor(color: number) {
    this.baseColor.set(color);
    this.bodyMat.color.set(color);
  }

  set(x: number, z: number, aim: number, visible: boolean) {
    this.group.position.set(x, 0, z);
    // Rotating by -aim maps local +X onto (cos aim, 0, sin aim).
    this.group.rotation.y = -aim;
    this.group.visible = visible;
  }

  flash(now: number) {
    this.flashUntil = now + 90;
  }

  update(now: number) {
    const p = this.group.position;
    const dt = (now - this.lastT) / 1000;
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.y);
    this.dashing = this.group.visible && dt > 0 && dt < 0.1 && moved < 3 && moved / dt > PlayerMesh.DASH_SPEED_VISUAL;
    this.lastPos.set(p.x, p.z);
    this.lastT = now;
    const on = now < this.flashUntil;
    this.bodyMat.emissive.set(on ? 0xffffff : 0x000000);
    this.bodyMat.emissiveIntensity = on ? 0.8 : 0;
  }
}

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private cameraTarget = new THREE.Vector3();
  private bullets = new Map<string, THREE.Mesh>();
  private bulletGeo = new THREE.SphereGeometry(BULLET_RADIUS * 1.3, 10, 8);
  private bulletMats = PLAYER_COLORS.map(
    (c) => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: c, emissiveIntensity: 1.6 }),
  );
  private grenades = new Map<string, { ball: THREE.Mesh; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial }>();
  private grenadeGeo = new THREE.SphereGeometry(0.2, 12, 10);
  private grenadeMat = new THREE.MeshStandardMaterial({ color: 0x30343c, emissive: 0xffaa33, emissiveIntensity: 0.5 });
  private telegraphGeo = new THREE.CircleGeometry(GRENADE.radius, 40);
  /** Short-lived effects: explosion flashes and dash ghosts. */
  private effects: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; born: number; life: number; grow: number }[] = [];
  private blastGeo = new THREE.SphereGeometry(1, 20, 14);
  private ghostGeo = new THREE.CapsuleGeometry(PLAYER_RADIUS, 0.8, 4, 10);
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x1a1d24);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.position.copy(CAMERA_OFFSET);
    this.camera.lookAt(0, 0, 0);

    this.buildLights();
    this.buildArena();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x3a3228, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(12, 25, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = ARENA_HALF + 3;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 70 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  private buildArena() {
    const size = ARENA_HALF * 2;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: 0x565d6b, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(size, size / 2, 0x6a7282, 0x6a7282);
    grid.position.y = 0.01;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(grid);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b4150, roughness: 0.8, flatShading: true });
    const len = size + WALL_THICKNESS * 2;
    const off = ARENA_HALF + WALL_THICKNESS / 2;
    const walls: [number, number, number, number][] = [
      [0, -off, len, WALL_THICKNESS],
      [0, off, len, WALL_THICKNESS],
      [-off, 0, WALL_THICKNESS, len],
      [off, 0, WALL_THICKNESS, len],
    ];
    for (const [x, z, w, d] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), wallMat);
      m.position.set(x, WALL_HEIGHT / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    }

    const boxMat = new THREE.MeshStandardMaterial({ color: 0xc9b98f, roughness: 0.7, flatShading: true });
    for (const b of OBSTACLES) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), boxMat);
      m.position.set(b.x, b.h / 2, b.z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;
    this.camera.left = (-VIEW_HEIGHT * aspect) / 2;
    this.camera.right = (VIEW_HEIGHT * aspect) / 2;
    this.camera.top = VIEW_HEIGHT / 2;
    this.camera.bottom = -VIEW_HEIGHT / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /** Follows a ground point with a little smoothing. */
  follow(x: number, z: number, dtSeconds: number, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-10 * dtSeconds);
    this.cameraTarget.x += (x - this.cameraTarget.x) * k;
    this.cameraTarget.z += (z - this.cameraTarget.z) * k;
    this.camera.position.copy(this.cameraTarget).add(CAMERA_OFFSET);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateMatrixWorld();
  }

  /** Where the cursor ray hits the ground plane, or null. */
  cursorOnGround(ndc: THREE.Vector2): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, hit);
  }

  addPlayer(mesh: PlayerMesh) {
    this.scene.add(mesh.group);
  }

  removePlayer(mesh: PlayerMesh) {
    this.scene.remove(mesh.group);
  }

  syncBullets(bullets: Map<string, { x: number; z: number; slot: number }>) {
    for (const [id, mesh] of this.bullets) {
      if (!bullets.has(id)) {
        this.scene.remove(mesh);
        this.bullets.delete(id);
      }
    }
    for (const [id, b] of bullets) {
      let mesh = this.bullets.get(id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.bulletGeo, this.bulletMats[b.slot] ?? this.bulletMats[0]);
        mesh.castShadow = true;
        this.bullets.set(id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(b.x, BULLET_HEIGHT, b.z);
    }
  }

  /**
   * Grenades: the ball follows its arc (y comes from the server), and a ground
   * circle shows the blast radius at the landing point. Faint while it flies,
   * pulsing red during the fuse so it can be dodged. (The blast flash is
   * triggered separately, see `blast`.)
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
        const ball = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
        ball.castShadow = true;
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4030, transparent: true, opacity: 0.1, depthWrite: false });
        const ring = new THREE.Mesh(this.telegraphGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        g = { ball, ring, ringMat };
        this.grenades.set(id, g);
        this.scene.add(ball, ring);
      }
      g.ball.position.set(gv.x, gv.y + 0.2, gv.z);
      g.ball.visible = !gv.exploded;
      g.ring.position.set(gv.tx, 0.03, gv.tz);
      g.ring.visible = !gv.exploded;
      g.ringMat.opacity = gv.landed ? 0.28 + 0.2 * Math.sin(now / 45) : 0.1;
    }
  }

  /** Explosion flash filling the blast radius. */
  blast(x: number, z: number, now: number) {
    this.addEffect(this.blastGeo, 0xffc060, x, 0.4, z, 0.9, now, 320, GRENADE.radius);
  }

  /** A fading afterimage, for the dash streak. */
  addGhost(x: number, z: number, color: THREE.Color, now: number) {
    this.addEffect(this.ghostGeo, color.getHex(), x, PLAYER_RADIUS + 0.4, z, 0.35, now, 220, 0);
  }

  private addEffect(
    geo: THREE.BufferGeometry,
    color: number,
    x: number,
    y: number,
    z: number,
    opacity: number,
    now: number,
    life: number,
    grow: number,
  ) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (grow > 0) mesh.scale.setScalar(grow * 0.3);
    this.scene.add(mesh);
    this.effects.push({ mesh, mat, born: now, life, grow });
  }

  private updateEffects(now: number) {
    this.effects = this.effects.filter((e) => {
      const t = (now - e.born) / e.life;
      if (t >= 1) {
        this.scene.remove(e.mesh);
        e.mat.dispose();
        return false;
      }
      if (e.grow > 0) e.mesh.scale.setScalar(e.grow * (0.3 + 0.7 * Math.sqrt(t)));
      e.mat.opacity = (e.grow > 0 ? 0.9 : 0.35) * (1 - t);
      return true;
    });
  }

  render(now: number) {
    this.updateEffects(now);
    this.renderer.render(this.scene, this.camera);
  }
}

// The battle royale's things in the 3D scene: the zone's edge on the ground
// with a light tint outside it, the chests, and the items on the floor (a
// gun lying on a gold disc, grenades on a disc in their type's colour,
// healing items as a small box on a green disc, shield charges as a blue
// orb, a perk as its glyph on a floating violet badge). GameScene owns one and match.ts feeds it every frame from the latest
// snapshot; outside a royale it is simply empty.
//
// The zone's circle comes from the shared `zoneAt` on the synced numbers, at
// the server tick the client is at right now, so the edge drawn is the one
// the server hurts players with.
//
// A closed chest glows so it reads as something to open, not as cover: its
// materials pulse a warm emissive, and a soft additive halo lies on the
// ground under it. No lights: every closed chest shares the same few glow
// materials, so the pulse is one write per material per frame. Once open, the
// lid swings back, the glow and the halo go, and the chest stays. Its loot
// arcs out of it to where it lands (`fromX`, `dropTick` to `readyTick`, all
// the server's), drawn at the client's estimate of the server tick, so it
// lands when the server lets it be taken.

import {
  HEAL_MEDKIT,
  ITEM_GRENADE,
  ITEM_GUN,
  ITEM_HEAL,
  ITEM_KINDS,
  ITEM_PERK,
  ITEM_SHIELD,
  type CrateView,
  type FloorItemView,
} from "@bagarre/shared";
import * as THREE from "three";
import { grenadeView, perkView } from "./items.ts";

/** Gun on the floor: its longest side, metres. Crate (the chest's fallback shape): its size. */
const GUN_LENGTH = 0.95;
const CRATE_SIZE = 0.95;
/** The chest model: its longest side, metres (a touch bigger than a crate, so it reads from the camera). */
const CHEST_SIZE = 1.15;
/** The halo under a closed chest: its side, metres. */
const HALO_SIZE = 2.4;
/** The glow's colour, and its pulse (emissive intensity and halo opacity, low to high). */
const GLOW_COLOR = 0xffb648;
const GLOW_PULSE_MS = 1400;
/** A perk on the floor: the HUD's perk colour (its badge and disc), and the badge's size and height, metres. */
const PERK_COLOR = 0xe0b4ff;
const PERK_BADGE = 0.7;
const PERK_BADGE_Y = 0.42;
/** The lid opened: its angle (radians, back about its hinge) and how long it takes, ms. */
const LID_OPEN = -1.95;
const LID_MS = 260;
/** Loot leaving a chest: from this high (the chest's top), up to this much higher at the top of its arc, metres. */
const LOOT_FROM_Y = 0.55;
const LOOT_ARC = 0.9;
const EDGE_WIDTH = 0.35;
/** The tint outside the zone reaches this far past its edge (past any map). */
const OUTSIDE_REACH = 160;
/** Rebuild the ring meshes when the radius has moved more than this. */
const REBUILD_STEP = 0.04;

interface DrawnItem {
  group: THREE.Group;
  key: string;
}

interface DrawnChest {
  holder: THREE.Group;
  /** The model's meshes and their own materials (put back once open). */
  meshes: { mesh: THREE.Mesh; base: THREE.Material | THREE.Material[] }[];
  halo: THREE.Mesh;
  /** The chest model's lid (null for the fallback shapes). */
  lid: THREE.Object3D | null;
  /** performance.now() when it was first seen open (-1: closed). */
  openedAt: number;
}

/** A soft round spot, white in the middle to clear at the edge: the halo's alpha. */
function haloTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A perk's badge: its glyph on a dark violet disc ringed in PERK_COLOR (any glyph: "?" for an unknown perk). */
function perkTexture(glyph: string): THREE.Texture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (g) {
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 6, 0, 2 * Math.PI);
    g.fillStyle = "rgba(46,22,66,0.9)";
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = "#e0b4ff";
    g.stroke();
    g.font = `${Math.round(size * 0.5)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.fillText(glyph, size / 2, size / 2 + size * 0.03);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A clone scaled so its longest side is `size`, sitting on the ground, centred on its origin. */
function fitted(template: THREE.Object3D, size: number): THREE.Object3D {
  const o = template.clone();
  o.position.set(0, 0, 0);
  o.rotation.set(0, 0, 0);
  o.scale.set(1, 1, 1);
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o, true);
  const dims = box.getSize(new THREE.Vector3());
  const k = size / Math.max(dims.x, dims.y, dims.z, 1e-6);
  o.scale.setScalar(k);
  const c = box.getCenter(new THREE.Vector3());
  o.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  const holder = new THREE.Group();
  holder.add(o);
  holder.traverse((m) => (m.castShadow = true));
  return holder;
}

export class RoyaleView {
  readonly group = new THREE.Group();
  private crates = new Map<string, DrawnChest>();
  private items = new Map<string, DrawnItem>();
  private edge: THREE.Mesh | null = null;
  private outside: THREE.Mesh | null = null;
  private drawnR = -1;
  private readonly edgeMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  private readonly outsideMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  private readonly discGeo = new THREE.CircleGeometry(0.45, 24);
  private readonly discMats = new Map<number, THREE.MeshBasicMaterial>();
  private readonly crateGeo = new THREE.BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE);
  private readonly crateMat = new THREE.MeshStandardMaterial({ color: 0x9a6b3c, roughness: 0.9 });
  private readonly ballGeo = new THREE.SphereGeometry(0.16, 12, 10);
  // Healing items and shield charges: plain shapes, no model.
  private readonly bandageGeo = new THREE.BoxGeometry(0.34, 0.1, 0.22);
  private readonly medkitGeo = new THREE.BoxGeometry(0.42, 0.26, 0.3);
  private readonly bandageMat = new THREE.MeshStandardMaterial({ color: 0xf1e9dc, roughness: 0.8 });
  private readonly medkitMat = new THREE.MeshStandardMaterial({ color: 0xd8342c, roughness: 0.6 });
  private readonly shieldMat = new THREE.MeshStandardMaterial({ color: 0x7fc8ff, emissive: 0x2a6fb0, roughness: 0.3 });
  /** A perk's badge (a sprite, so it always faces the camera), one material per perk, made when first seen. */
  private readonly perkMats = new Map<number, THREE.SpriteMaterial>();
  private readonly haloGeo = new THREE.PlaneGeometry(HALO_SIZE, HALO_SIZE);
  private readonly haloMat = new THREE.MeshBasicMaterial({
    color: GLOW_COLOR,
    map: haloTexture(),
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  /** The glowing copy of each of the chest's own materials, shared by every closed chest. */
  private readonly glowMats = new Map<THREE.Material, THREE.Material>();

  constructor(
    /** The chest (models/chest.glb); null: the old crate prop (`crateModel`), or a plain box. */
    private readonly chestModel: THREE.Object3D | null,
    private readonly crateModel: THREE.Object3D | null,
    private readonly gunModels: readonly (THREE.Object3D | null)[],
    private readonly grenadeModel: THREE.Object3D | null,
  ) {
    this.group.name = "royale";
  }

  /** The glowing copy of `m` (an emissive in GLOW_COLOR, pulsed in `sync`), made once per material. */
  private glowMat(m: THREE.Material): THREE.Material {
    let g = this.glowMats.get(m);
    if (!g) {
      g = m.clone();
      if (g instanceof THREE.MeshStandardMaterial) {
        g.emissive.setHex(GLOW_COLOR);
        g.emissiveIntensity = 0.3;
      }
      this.glowMats.set(m, g);
    }
    return g;
  }

  private perkMat(id: number): THREE.SpriteMaterial {
    let m = this.perkMats.get(id);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: perkTexture(perkView(id)?.icon ?? "?"), transparent: true });
      this.perkMats.set(id, m);
    }
    return m;
  }

  private discMat(color: number): THREE.MeshBasicMaterial {
    let m = this.discMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
      this.discMats.set(color, m);
    }
    return m;
  }

  /** The zone's circle right now (null: no zone, nothing drawn). */
  setZone(circle: { x: number; z: number; r: number } | null) {
    if (!circle) {
      this.dropRings();
      return;
    }
    if (!this.edge || Math.abs(circle.r - this.drawnR) > REBUILD_STEP) {
      this.dropRings();
      const r = Math.max(0.01, circle.r);
      this.edge = new THREE.Mesh(new THREE.RingGeometry(Math.max(0, r - EDGE_WIDTH), r, 160), this.edgeMat);
      this.outside = new THREE.Mesh(new THREE.RingGeometry(r, r + OUTSIDE_REACH, 160), this.outsideMat);
      for (const m of [this.edge, this.outside]) {
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 2;
        this.group.add(m);
      }
      this.drawnR = circle.r;
    }
    this.edge.position.set(circle.x, 0.05, circle.z);
    this.outside!.position.set(circle.x, 0.04, circle.z);
  }

  private dropRings() {
    for (const m of [this.edge, this.outside]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.edge = this.outside = null;
    this.drawnR = -1;
  }

  /** A chest at `c`, closed (glowing) until `sync` sees it open. */
  private makeChest(c: CrateView): DrawnChest {
    const model = this.chestModel ?? this.crateModel;
    const o = model ? fitted(model, this.chestModel ? CHEST_SIZE : CRATE_SIZE) : new THREE.Mesh(this.crateGeo, this.crateMat);
    if (!model) o.position.y = CRATE_SIZE / 2;
    const holder = new THREE.Group();
    holder.add(o);
    holder.position.set(c.x, 0, c.z);
    holder.rotation.y = (c.x * 7 + c.z * 3) % Math.PI;
    holder.traverse((m) => (m.castShadow = true));
    const meshes: DrawnChest["meshes"] = [];
    holder.traverse((m) => {
      if (m instanceof THREE.Mesh) meshes.push({ mesh: m, base: m.material });
    });
    const halo = new THREE.Mesh(this.haloGeo, this.haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.02;
    halo.renderOrder = 1;
    holder.add(halo);
    const lid = this.chestModel ? (o.getObjectByName("lid") ?? null) : null;
    return { holder, meshes, halo, lid, openedAt: -1 };
  }

  /** Closed: the glowing materials and the halo. Open: the chest's own materials, no halo. */
  private setGlow(d: DrawnChest, on: boolean) {
    for (const { mesh, base } of d.meshes) mesh.material = on ? (Array.isArray(base) ? base.map((m) => this.glowMat(m)) : this.glowMat(base)) : base;
    d.halo.visible = on;
  }

  /**
   * The chests and the items on the floor (the latest snapshot's), at
   * `tickNow`: the server tick the client is at right now (a fraction), for
   * the loot still falling out of a chest.
   */
  sync(crates: ReadonlyMap<string, CrateView>, items: ReadonlyMap<string, FloorItemView>, now: number, tickNow: number) {
    for (const [id, d] of this.crates) {
      if (crates.has(id)) continue;
      this.group.remove(d.holder);
      this.crates.delete(id);
    }
    for (const [id, c] of crates) {
      let d = this.crates.get(id);
      if (!d) {
        d = this.makeChest(c);
        this.setGlow(d, !c.open);
        // Already open when first seen (joined late): open at once, no swing.
        if (c.open) d.openedAt = now - LID_MS;
        this.crates.set(id, d);
        this.group.add(d.holder);
      } else if (c.open && d.openedAt < 0) {
        d.openedAt = now;
        this.setGlow(d, false);
      }
      if (d.lid && d.openedAt >= 0) {
        const t = Math.min(1, (now - d.openedAt) / LID_MS);
        d.lid.rotation.x = LID_OPEN * (1 - (1 - t) * (1 - t));
      }
    }
    // The glow's pulse, shared by every closed chest.
    const pulse = 0.5 + 0.5 * Math.sin((now / GLOW_PULSE_MS) * 2 * Math.PI);
    for (const m of this.glowMats.values()) if (m instanceof THREE.MeshStandardMaterial) m.emissiveIntensity = 0.18 + 0.32 * pulse;
    this.haloMat.opacity = 0.32 + 0.3 * pulse;

    for (const [id, d] of this.items) {
      const it = items.get(id);
      if (it && d.key === `${it.kind}:${it.item}`) continue;
      this.group.remove(d.group);
      this.items.delete(id);
    }
    for (const [id, it] of items) {
      let d = this.items.get(id);
      if (!d) {
        d = { group: this.makeItem(it), key: `${it.kind}:${it.item}` };
        this.items.set(id, d);
        this.group.add(d.group);
      }
      // Loot still falling out of a chest: along its arc, no disc yet (nobody can take it until it lands).
      const falling = it.readyTick > it.dropTick && tickNow < it.readyTick;
      const disc = d.group.children[0];
      if (disc) disc.visible = !falling;
      if (falling) {
        const t = Math.min(1, Math.max(0, (tickNow - it.dropTick) / (it.readyTick - it.dropTick)));
        d.group.position.set(it.fromX + (it.x - it.fromX) * t, LOOT_FROM_Y * (1 - t) + LOOT_ARC * 4 * t * (1 - t), it.fromZ + (it.z - it.fromZ) * t);
      } else d.group.position.set(it.x, 0, it.z);
      // A slow turn and bob, so floor items read as pickups, not decor (a fast tumble while falling).
      const spin = d.group.children[1];
      if (spin) {
        spin.rotation.y = falling ? now / 120 : now / 900 + it.x;
        spin.position.y = falling ? 0.12 : 0.12 + 0.06 * Math.sin(now / 300 + it.z);
      }
    }
  }

  private makeItem(it: FloorItemView): THREE.Group {
    const g = new THREE.Group();
    // Its kind, for a test reading the scene (`__bagarre.scene.royale.group`).
    g.name = `item:${ITEM_KINDS[it.kind] ?? "unknown"}`;
    const gun = it.kind === ITEM_GUN;
    const color =
      it.kind === ITEM_GRENADE
        ? grenadeView(it.item).telegraph
        : it.kind === ITEM_HEAL
          ? 0x6dff9a
          : it.kind === ITEM_SHIELD
            ? 0x7fc8ff
            : it.kind === ITEM_PERK
              ? PERK_COLOR
              : 0xffd24a;
    const disc = new THREE.Mesh(this.discGeo, this.discMat(color));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.03;
    g.add(disc);
    let body: THREE.Object3D;
    if (gun) {
      const t = this.gunModels[it.item];
      body = t ? fitted(t, GUN_LENGTH) : new THREE.Mesh(new THREE.BoxGeometry(GUN_LENGTH, 0.15, 0.2), this.crateMat);
    } else if (it.kind === ITEM_HEAL) {
      const medkit = it.item === HEAL_MEDKIT;
      body = new THREE.Mesh(medkit ? this.medkitGeo : this.bandageGeo, medkit ? this.medkitMat : this.bandageMat);
      body.position.y = medkit ? 0.13 : 0.05;
      body.castShadow = true;
    } else if (it.kind === ITEM_SHIELD) {
      body = new THREE.Mesh(this.ballGeo, this.shieldMat);
      body.position.y = 0.2;
    } else if (it.kind === ITEM_PERK) {
      // Its glyph floating above the disc (the spin's turn does nothing to a sprite, the bob does).
      body = new THREE.Sprite(this.perkMat(it.item));
      body.scale.setScalar(PERK_BADGE);
      body.position.y = PERK_BADGE_Y;
    } else if (it.kind === ITEM_GRENADE) {
      body = this.grenadeModel ? fitted(this.grenadeModel, 0.35) : new THREE.Mesh(this.ballGeo, this.discMat(grenadeView(it.item).telegraph));
    } else {
      // A kind this client doesn't know (a newer server): a plain brown ball, never another kind's view.
      body = new THREE.Mesh(this.ballGeo, this.crateMat);
      body.position.y = 0.2;
    }
    const spin = new THREE.Group();
    spin.add(body);
    g.add(spin);
    return g;
  }

  /** Nothing drawn (map change, the end of a match, leaving). */
  clear() {
    for (const d of this.crates.values()) this.group.remove(d.holder);
    this.crates.clear();
    for (const d of this.items.values()) this.group.remove(d.group);
    this.items.clear();
    this.dropRings();
  }
}

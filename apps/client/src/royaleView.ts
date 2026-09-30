// The battle royale's things in the 3D scene: the zone's edge on the ground
// with a light tint outside it, the crates still standing, and the items on
// the floor (a gun lying on a gold disc, grenades on a disc in their type's
// colour, healing items as a small box on a green disc, shield charges as a
// blue orb). GameScene owns one and match.ts feeds it every frame from the
// latest snapshot; outside a royale it is simply empty.
//
// The zone's circle comes from the shared `zoneAt` on the synced numbers, at
// the server tick the client is at right now, so the edge drawn is the one
// the server hurts players with.

import { HEAL_MEDKIT, ITEM_GRENADE, ITEM_GUN, ITEM_HEAL, ITEM_SHIELD, type CrateView, type FloorItemView } from "@bagarre/shared";
import * as THREE from "three";
import { grenadeView } from "./items.ts";

/** Gun on the floor: its longest side, metres. Crate: its size. */
const GUN_LENGTH = 0.95;
const CRATE_SIZE = 0.95;
const EDGE_WIDTH = 0.35;
/** The tint outside the zone reaches this far past its edge (past any map). */
const OUTSIDE_REACH = 160;
/** Rebuild the ring meshes when the radius has moved more than this. */
const REBUILD_STEP = 0.04;

interface DrawnItem {
  group: THREE.Group;
  key: string;
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
  private crates = new Map<string, THREE.Object3D>();
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

  constructor(
    private readonly crateModel: THREE.Object3D | null,
    private readonly gunModels: readonly (THREE.Object3D | null)[],
    private readonly grenadeModel: THREE.Object3D | null,
  ) {
    this.group.name = "royale";
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

  /** The crates still standing and the items on the floor (the latest snapshot's). */
  sync(crates: ReadonlyMap<string, CrateView>, items: ReadonlyMap<string, FloorItemView>, now: number) {
    for (const [id, o] of this.crates) {
      if (crates.has(id)) continue;
      this.group.remove(o);
      this.crates.delete(id);
    }
    for (const [id, c] of crates) {
      if (this.crates.has(id)) continue;
      const o = this.crateModel ? fitted(this.crateModel, CRATE_SIZE) : new THREE.Mesh(this.crateGeo, this.crateMat);
      if (!this.crateModel) o.position.y = CRATE_SIZE / 2;
      const holder = new THREE.Group();
      holder.add(o);
      holder.position.set(c.x, 0, c.z);
      holder.rotation.y = (c.x * 7 + c.z * 3) % Math.PI;
      holder.traverse((m) => (m.castShadow = true));
      this.crates.set(id, holder);
      this.group.add(holder);
    }

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
      d.group.position.set(it.x, 0, it.z);
      // A slow turn and bob, so floor items read as pickups, not decor.
      const spin = d.group.children[1];
      if (spin) {
        spin.rotation.y = now / 900 + it.x;
        spin.position.y = 0.12 + 0.06 * Math.sin(now / 300 + it.z);
      }
    }
  }

  private makeItem(it: FloorItemView): THREE.Group {
    const g = new THREE.Group();
    const gun = it.kind === ITEM_GUN;
    const color =
      it.kind === ITEM_GRENADE ? grenadeView(it.item).telegraph : it.kind === ITEM_HEAL ? 0x6dff9a : it.kind === ITEM_SHIELD ? 0x7fc8ff : 0xffd24a;
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
    } else {
      body = this.grenadeModel ? fitted(this.grenadeModel, 0.35) : new THREE.Mesh(this.ballGeo, this.discMat(grenadeView(it.item).telegraph));
    }
    const spin = new THREE.Group();
    spin.add(body);
    g.add(spin);
    return g;
  }

  /** Nothing drawn (map change, the end of a match, leaving). */
  clear() {
    for (const o of this.crates.values()) this.group.remove(o);
    this.crates.clear();
    for (const d of this.items.values()) this.group.remove(d.group);
    this.items.clear();
    this.dropRings();
  }
}

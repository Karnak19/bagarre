import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_HALF, OBSTACLES, WALL_HEIGHT, WALL_THICKNESS, type Box } from "@bagarre/shared";

/**
 * The arena's looks. Collision is defined by `shared/src/arena.ts` only: every
 * prop here is scaled and placed to cover one of its boxes, and nothing added
 * here blocks anything. Decoration inside the arena stays flat (papers,
 * pallets, debris) so it never hides a player; the taller clutter sits outside
 * the walls.
 */
export function buildArena(scene: THREE.Scene, props: Map<string, THREE.Object3D> | null) {
  buildFloor(scene);
  if (!props || !hasAll(props)) {
    buildPlaceholder(scene);
    return;
  }
  const solid: THREE.Object3D[] = [];
  const size = ARENA_HALF * 2;
  const len = size + WALL_THICKNESS * 2;
  const off = ARENA_HALF + WALL_THICKNESS / 2;
  const walls: Box[] = [
    { x: 0, z: -off, w: len, d: WALL_THICKNESS, h: WALL_HEIGHT },
    { x: 0, z: off, w: len, d: WALL_THICKNESS, h: WALL_HEIGHT },
    { x: -off, z: 0, w: WALL_THICKNESS, d: len, h: WALL_HEIGHT },
    { x: off, z: 0, w: WALL_THICKNESS, d: len, h: WALL_HEIGHT },
  ];
  for (const w of walls) solid.push(...fill(props, "BrickWall_2", w, WALL_HEIGHT, true));
  for (const b of OBSTACLES) solid.push(...cover(props, b));
  scene.add(bake(solid, true));
  scene.add(bake(decor(props), false));
}

const NEEDED = ["BrickWall_2", "Crate", "Container_Small", "SackTrench_Small", "Barrier_Single"];
function hasAll(props: Map<string, THREE.Object3D>) {
  return NEEDED.every((n) => props.has(n));
}

function buildFloor(scene: THREE.Scene) {
  const size = ARENA_HALF * 2;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x3a3e46, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.01;
  outer.receiveShadow = true;
  scene.add(outer);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: 0x5f6570, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  // Faint 2 m grid, so movement still reads on the flat floor.
  const grid = new THREE.GridHelper(size, size / 2, 0x6d7380, 0x6d7380);
  grid.position.y = 0.005;
  const gm = grid.material as THREE.Material;
  gm.transparent = true;
  gm.opacity = 0.18;
  gm.depthWrite = false;
  scene.add(grid);
}

/** The pre-asset look: grey walls and sand-coloured boxes. */
function buildPlaceholder(scene: THREE.Scene) {
  const size = ARENA_HALF * 2;
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
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xc9b98f, roughness: 0.7, flatShading: true });
  for (const b of OBSTACLES) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), boxMat);
    m.position.set(b.x, b.h / 2, b.z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
}

/** Local bounds of a prop template. */
const boundsCache = new Map<THREE.Object3D, THREE.Box3>();
function boundsOf(t: THREE.Object3D): THREE.Box3 {
  let b = boundsCache.get(t);
  if (!b) {
    const c = t.clone();
    c.position.set(0, 0, 0);
    c.rotation.set(0, 0, 0);
    c.scale.set(1, 1, 1);
    c.updateMatrixWorld(true);
    b = new THREE.Box3().setFromObject(c, true);
    boundsCache.set(t, b);
  }
  return b;
}

/**
 * Places a prop so that its bounds exactly cover a box of `h` height at
 * (x, z) with footprint (w, d), rotated `turn` quarter turns.
 */
function place(t: THREE.Object3D, x: number, z: number, w: number, d: number, h: number, turn = 0, y = 0): THREE.Object3D {
  const b = boundsOf(t);
  const size = b.getSize(new THREE.Vector3());
  const c = b.getCenter(new THREE.Vector3());
  const o = t.clone();
  const q = turn % 2 === 1;
  // Footprint along the prop's own X / Z once turned.
  const sx = (q ? d : w) / size.x;
  const sz = (q ? w : d) / size.z;
  o.scale.set(sx, h / size.y, sz);
  o.rotation.set(0, (turn * Math.PI) / 2, 0);
  // Put the centre of the scaled, turned bounds at (x, z) and its bottom at y.
  const off = new THREE.Vector3(c.x * sx, 0, c.z * sz).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.rotation.y);
  o.position.set(x - off.x, y - b.min.y * (h / size.y), z - off.z);
  return o;
}

/**
 * Tiles a prop along the long side of a box. `nativeLength` keeps the prop's
 * own length (walls); otherwise the tile count is picked so the prop keeps
 * roughly its proportions.
 */
function fill(props: Map<string, THREE.Object3D>, name: string, box: Box, h: number, nativeLength = false): THREE.Object3D[] {
  const t = props.get(name)!;
  const size = boundsOf(t).getSize(new THREE.Vector3());
  const alongX = box.w >= box.d;
  const L = alongX ? box.w : box.d;
  const D = alongX ? box.d : box.w;
  // The prop's long side is its X.
  const propLong = size.x;
  const uniform = nativeLength ? 1 : D / size.z;
  const n = Math.max(1, Math.round(L / (propLong * uniform)));
  const step = L / n;
  const out: THREE.Object3D[] = [];
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + step * (i + 0.5);
    const x = alongX ? box.x + u : box.x;
    const z = alongX ? box.z : box.z + u;
    // Alternate facing so repeated tiles don't look copy-pasted.
    const turn = (alongX ? 0 : 1) + (i % 2) * 2;
    out.push(place(t, x, z, alongX ? step : D, alongX ? D : step, h, turn));
  }
  return out;
}

/** Picks and places the props for one obstacle box. */
function cover(props: Map<string, THREE.Object3D>, b: Box): THREE.Object3D[] {
  const long = Math.max(b.w, b.d);
  const short = Math.min(b.w, b.d);
  if (long / short >= 2) {
    // Long cover: sandbags along Z, concrete barriers along X.
    return b.d > b.w ? fill(props, "SackTrench_Small", b, 1.35) : fill(props, "Barrier_Single", b, 1.3);
  }
  if (short >= 2.5) {
    // Big square: a stack of crates, 2 x 2 (or more), with a box on top.
    const n = Math.max(2, Math.round(short / 1.5));
    const cw = b.w / n;
    const cd = b.d / n;
    const crateH = Math.min(cw, cd);
    const out: THREE.Object3D[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = b.x - b.w / 2 + cw * (i + 0.5);
        const z = b.z - b.d / 2 + cd * (j + 0.5);
        out.push(place(props.get("Crate")!, x, z, cw, cd, crateH, (i + j) % 4));
      }
    const top = props.get("CardboardBoxes_1");
    if (top) out.push(place(top, b.x - cw * 0.25, b.z + cd * 0.2, 1.0, 0.75, 0.5, 1, crateH));
    return out;
  }
  // Small square: a shipping container cut to size.
  return [place(props.get("Container_Small")!, b.x, b.z, b.w, b.d, Math.min(2, b.h + 0.6), b.x < 0 ? 1 : 3)];
}

/** Ground clutter with no collision. */
function decor(props: Map<string, THREE.Object3D>): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const put = (name: string, x: number, z: number, yaw: number, scale = 1) => {
    const t = props.get(name);
    if (!t) return;
    const o = t.clone();
    o.position.set(x, 0, z);
    o.rotation.y = yaw;
    o.scale.multiplyScalar(scale);
    out.push(o);
  };
  // Flat stuff inside the arena (never taller than a player's ankles).
  put("Debris_Papers_1", -3, -3.5, 0.4);
  put("Debris_Papers_2", 3.5, 3, 2.1);
  put("Debris_Papers_3", -10.5, 2.5, 1.2);
  put("Debris_Papers_1", 10, -2, 3.3);
  put("Debris_Papers_3", 1.5, 11.5, 0.2);
  put("Debris_Papers_2", -1, -11.8, 4.1);
  put("Debris_Pile", -12.6, -3.5, 0.6, 0.9);
  put("Debris_Pile", 12.6, 3.5, 3.7, 0.9);
  put("Pallet", -12.8, 6.5, 0.3);
  put("Pallet_Broken", 12.8, -6.5, 2.0);
  put("WoodPlanks", 6.5, 10.5, 1.1);
  put("WoodPlanks", -6.5, -10.5, 2.4);
  // Clutter outside the walls, framing the arena.
  const e = ARENA_HALF + WALL_THICKNESS + 0.9;
  put("TrafficCone", -e, -6, 0);
  put("TrafficCone", -e, -4.6, 0.7);
  put("TrafficCone", e, 6, 0.2);
  put("TrafficCone", e + 0.4, 4.8, 1.3);
  put("TrafficCone", 5, e, 0);
  put("TrafficCone", -5, -e, 0.9);
  put("Debris_Tires", -e - 0.3, 9, 0.5);
  put("Debris_Tires", e + 0.3, -9, 2.5);
  put("ExplodingBarrel", 9, -e - 0.2, 0);
  put("ExplodingBarrel", 9.9, -e - 0.3, 0.8);
  put("ExplodingBarrel", -9, e + 0.2, 0.3);
  put("CardboardBoxes_2", -11, -e - 0.3, 0.2);
  put("CardboardBoxes_4", 11, e + 0.4, 2.8);
  put("CardboardBoxes_1", -e - 0.2, 12, 1.4);
  put("CardboardBoxes_1", e + 0.2, -12, 4.2);
  put("Pallet", 0, e + 1, 0.1);
  put("Pallet", 0.3, -e - 1, 1.7);
  return out;
}

/** Local copy of a geometry with float position + normal only, transformed to world. */
function flat(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal"]) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) {
      arr[i * 3] = a.getX(i);
      arr[i * 3 + 1] = a.getY(i);
      arr[i * 3 + 2] = a.getZ(i);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  if (!out.getAttribute("normal")) out.computeVertexNormals();
  const idx = g.getIndex();
  if (idx) out.setIndex(Array.from(idx.array as ArrayLike<number>));
  else out.setIndex(Array.from({ length: out.getAttribute("position").count }, (_, i) => i));
  out.applyMatrix4(m);
  // Mirrored scale would flip winding; props are never mirrored here.
  return out;
}

/**
 * Merges static props into one mesh per material: the whole arena costs a
 * handful of draw calls (and shadow draw calls) instead of hundreds.
 */
function bake(objects: THREE.Object3D[], castShadow: boolean): THREE.Group {
  const group = new THREE.Group();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const o of objects) {
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mat = mats[0];
      let list = byMat.get(mat);
      if (!list) byMat.set(mat, (list = []));
      list.push(flat(mesh.geometry, mesh.matrixWorld));
    });
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

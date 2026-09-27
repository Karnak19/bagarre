import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WALL_HEIGHT, WALL_THICKNESS, type Box, type MapDef, type Obstacle, type WallStyle } from "@bagarre/shared";

/**
 * The arena's looks, built from a `MapDef`. Collision is defined by the map
 * data only: every prop here is scaled and placed to cover one of its boxes
 * (at the box's `h`), and nothing added here blocks anything. The map's decor
 * inside the walls is flat (papers, pallets, debris) so it never hides a
 * player; the taller clutter sits outside the walls.
 *
 * Everything goes into `group`. Its geometries are all made here (merged or
 * built), so `disposeArena` frees them all; materials are only freed when made
 * here too (`userData.ownMaterial`), never the loaded props' shared ones.
 */
export function buildArena(group: THREE.Group, props: Map<string, THREE.Object3D> | null, map: MapDef) {
  buildFloor(group, map);
  if (!props || !hasAll(props)) {
    buildPlaceholder(group, map);
    return;
  }
  const solid: THREE.Object3D[] = [];
  for (const w of outerWalls(map)) solid.push(...wall(props, map.theme.wall, w));
  for (const b of map.obstacles) solid.push(...cover(props, b));
  group.add(bake(solid, true));
  group.add(bake(decor(props, map), false));
}

/** Frees what `buildArena` made. The group itself is left empty. */
export function disposeArena(group: THREE.Group) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.geometry) return;
    m.geometry.dispose();
    if (m.userData.ownMaterial) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
  });
  group.clear();
}

const NEEDED = ["BrickWall_2", "Crate", "Container_Small", "SackTrench_Small", "Barrier_Single", "ExplodingBarrel"];
function hasAll(props: Map<string, THREE.Object3D>) {
  return NEEDED.every((n) => props.has(n));
}

/** The four outer walls, just outside the floor. */
function outerWalls(map: MapDef): Box[] {
  const lx = map.halfX * 2 + WALL_THICKNESS * 2;
  const lz = map.halfZ * 2 + WALL_THICKNESS * 2;
  const ox = map.halfX + WALL_THICKNESS / 2;
  const oz = map.halfZ + WALL_THICKNESS / 2;
  return [
    { x: 0, z: -oz, w: lx, d: WALL_THICKNESS, h: WALL_HEIGHT },
    { x: 0, z: oz, w: lx, d: WALL_THICKNESS, h: WALL_HEIGHT },
    { x: -ox, z: 0, w: WALL_THICKNESS, d: lz, h: WALL_HEIGHT },
    { x: ox, z: 0, w: WALL_THICKNESS, d: lz, h: WALL_HEIGHT },
  ];
}

/** An outer wall in the map's style. All stay at 1.4 m or lower. */
function wall(props: Map<string, THREE.Object3D>, style: WallStyle, b: Box): THREE.Object3D[] {
  if (style === "barrier") return fill(props, "Barrier_Single", b, 1.3);
  if (style === "sandbags") return fill(props, "SackTrench_Small", b, 1.35);
  return fill(props, "BrickWall_2", b, WALL_HEIGHT, true);
}

function own<T extends THREE.Mesh | THREE.LineSegments>(o: T): T {
  o.userData.ownMaterial = true;
  return o;
}

function buildFloor(group: THREE.Group, map: MapDef) {
  const t = map.theme;
  const sx = map.halfX * 2;
  const sz = map.halfZ * 2;
  const outer = own(new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: t.outerFloor, roughness: 1 })));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.01;
  outer.receiveShadow = true;
  group.add(outer);
  const floor = own(new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshStandardMaterial({ color: t.floor, roughness: 0.95 })));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  // Faint 2 m grid, so movement still reads on the flat floor. (GridHelper
  // is square only; the maps are rectangles.)
  const pts: number[] = [];
  for (let x = -map.halfX; x <= map.halfX + 1e-6; x += 2) pts.push(x, 0, -map.halfZ, x, 0, map.halfZ);
  for (let z = -map.halfZ; z <= map.halfZ + 1e-6; z += 2) pts.push(-map.halfX, 0, z, map.halfX, 0, z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const grid = own(
    new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: t.grid, transparent: true, opacity: t.gridOpacity, depthWrite: false })),
  );
  grid.position.y = 0.005;
  group.add(grid);
}

/** The pre-asset look: grey walls and sand-coloured boxes, at the map's heights. */
function buildPlaceholder(group: THREE.Group, map: MapDef) {
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b4150, roughness: 0.8, flatShading: true });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xc9b98f, roughness: 0.7, flatShading: true });
  const add = (b: Box, mat: THREE.Material) => {
    const m = own(new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat));
    m.position.set(b.x, b.h / 2, b.z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  for (const w of outerWalls(map)) add(w, wallMat);
  for (const b of map.obstacles) add(b, boxMat);
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

/** Dresses one obstacle box according to its `kind`, at its `h` height. */
function cover(props: Map<string, THREE.Object3D>, b: Obstacle): THREE.Object3D[] {
  switch (b.kind) {
    case "barrier":
      return fill(props, "Barrier_Single", b, b.h);
    case "sandbags":
      return fill(props, "SackTrench_Small", b, b.h);
    case "wall":
      return fill(props, "BrickWall_2", b, b.h);
    case "container":
      // One container cut to the footprint, doors facing away from the centre line.
      return [place(props.get("Container_Small")!, b.x, b.z, b.w, b.d, b.h, b.x < 0 ? 1 : 3)];
    case "barrels":
      return grid(props.get("ExplodingBarrel")!, b, 1, b.h);
    case "crate": {
      // A stack of ~1.5 m crates, with a box on top of the big ones.
      const out = grid(props.get("Crate")!, b, 1.5, b.h, true);
      const top = props.get("CardboardBoxes_1");
      if (top && b.w >= 2.5 && b.d >= 2.5) {
        const cw = b.w / Math.max(1, Math.round(b.w / 1.5));
        const cd = b.d / Math.max(1, Math.round(b.d / 1.5));
        out.push(place(top, b.x - cw * 0.25, b.z + cd * 0.2, 1.0, 0.75, 0.5, 1, b.h));
      }
      return out;
    }
  }
}

/**
 * Fills a box with a grid of one prop, cells of about `cell` metres a side,
 * each scaled to the cell and `h` tall. `turns` varies the facing per cell.
 */
function grid(t: THREE.Object3D, b: Box, cell: number, h: number, turns = false): THREE.Object3D[] {
  const nx = Math.max(1, Math.round(b.w / cell));
  const nz = Math.max(1, Math.round(b.d / cell));
  const cw = b.w / nx;
  const cd = b.d / nz;
  const out: THREE.Object3D[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const x = b.x - b.w / 2 + cw * (i + 0.5);
      const z = b.z - b.d / 2 + cd * (j + 0.5);
      out.push(place(t, x, z, cw, cd, h, turns ? (i + j) % 4 : 0));
    }
  return out;
}

/** The map's decor, with no collision. */
function decor(props: Map<string, THREE.Object3D>, map: MapDef): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const d of map.decor) {
    const t = props.get(d.prop);
    if (!t) continue;
    const o = t.clone();
    o.position.set(d.x, 0, d.z);
    o.rotation.y = d.yaw;
    o.scale.multiplyScalar(d.scale ?? 1);
    out.push(o);
  }
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

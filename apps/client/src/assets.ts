import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/**
 * Everything loaded before the game starts. Each entry is null when its file
 * failed to load, and the code that uses it falls back to the old placeholder
 * meshes, so a missing file never means a blank screen.
 */
export interface Assets {
  /** Character models, one per player slot (0: Enemy, 1: Soldier). */
  characters: (GLTF | null)[];
  /** Arena props by name (Crate, SackTrench_Small, ...), each a template to clone. */
  props: Map<string, THREE.Object3D> | null;
  /** The particle atlas: 4 x 4 greyscale cells, see vfx.ts. */
  atlas: THREE.Texture | null;
}

const base = import.meta.env.BASE_URL;

/** Loads every asset in parallel. `onProgress` gets a 0-1 fraction. */
export async function loadAssets(onProgress: (fraction: number) => void): Promise<Assets> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const files = ["models/enemy.glb", "models/soldier.glb", "models/props.glb", "vfx/particles.png"];
  const loaded = files.map(() => 0);
  const tick = (i: number, f: number) => {
    loaded[i] = f;
    onProgress(loaded.reduce((a, b) => a + b, 0) / files.length);
  };

  const gltf = (i: number) =>
    new Promise<GLTF>((resolve, reject) =>
      loader.load(
        base + files[i],
        (g) => {
          tick(i, 1);
          resolve(g);
        },
        (e) => e.lengthComputable && tick(i, e.loaded / e.total),
        reject,
      ),
    );
  const texture = (i: number) =>
    new Promise<THREE.Texture>((resolve, reject) =>
      new THREE.TextureLoader().load(
        base + files[i],
        (t) => {
          tick(i, 1);
          resolve(t);
        },
        undefined,
        reject,
      ),
    );

  const [enemy, soldier, props, atlas] = await Promise.allSettled([gltf(0), gltf(1), gltf(2), texture(3)]);
  const ok = <T>(r: PromiseSettledResult<T>, name: string): T | null => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[assets] ${name} failed to load, using the placeholder instead`, r.reason);
    return null;
  };

  let propMap: Map<string, THREE.Object3D> | null = null;
  const propsGltf = ok(props, files[2]);
  if (propsGltf) {
    propMap = new Map();
    for (const child of propsGltf.scene.children) propMap.set(child.name, child);
  }
  const tex = ok(atlas, files[3]);
  if (tex) {
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { characters: [ok(enemy, files[0]), ok(soldier, files[1])], props: propMap, atlas: tex };
}

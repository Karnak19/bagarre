import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { SKIN_ANIMS_FILE, WEAPONS, skinOf } from "@bagarre/shared";
import { GUN_VIEW } from "./items.ts";

/**
 * Everything loaded before the game starts. Each entry is null when its file
 * failed to load, and the code that uses it falls back to the old placeholder
 * meshes, so a missing file never means a blank screen.
 *
 * The skins are not in here: they load on demand, see `skinModel`.
 */
export interface Assets {
  /** The clips every skin plays (models/anims.glb, bones only). */
  anims: THREE.AnimationClip[] | null;
  /** The gun of each weapon, by weapon id (GUN_VIEW), each a template to clone. Null for one that failed. */
  guns: (THREE.Object3D | null)[];
  /** Arena props by name (Crate, SackTrench_Small, ...), each a template to clone. */
  props: Map<string, THREE.Object3D> | null;
  /** The particle atlas: 4 x 4 greyscale cells, see vfx.ts. */
  atlas: THREE.Texture | null;
}

const base = import.meta.env.BASE_URL;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

let resolveLoaded!: (a: Assets) => void;
/** Settles once `loadAssets` has (the skin preview waits on it). */
export const assetsLoaded = new Promise<Assets>((r) => (resolveLoaded = r));

/** Loads every startup asset in parallel. `onProgress` gets a 0-1 fraction. */
export async function loadAssets(onProgress: (fraction: number) => void): Promise<Assets> {
  const gunFiles = WEAPONS.map((w) => `models/${GUN_VIEW[w.key].model.file}`);
  const files = [`models/${SKIN_ANIMS_FILE}`, "models/props.glb", "vfx/particles.png", ...gunFiles];
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

  const [anims, props, atlas, ...guns] = await Promise.allSettled([
    gltf(0),
    gltf(1),
    texture(2),
    ...gunFiles.map((_, i) => gltf(3 + i)),
  ]);
  const ok = <T>(r: PromiseSettledResult<T>, name: string): T | null => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[assets] ${name} failed to load, using the placeholder instead`, r.reason);
    return null;
  };

  let propMap: Map<string, THREE.Object3D> | null = null;
  const propsGltf = ok(props, files[1]);
  if (propsGltf) {
    propMap = new Map();
    for (const child of propsGltf.scene.children) propMap.set(child.name, child);
  }
  const tex = ok(atlas as PromiseSettledResult<THREE.Texture>, files[2]);
  if (tex) {
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
  }
  const clips = ok(anims as PromiseSettledResult<GLTF>, files[0])?.animations ?? null;
  const result: Assets = {
    anims: clips && clips.length > 0 ? clips : null,
    guns: guns.map((g, i) => ok(g as PromiseSettledResult<GLTF>, gunFiles[i])?.scene ?? null),
    props: propMap,
    atlas: tex,
  };
  resolveLoaded(result);
  return result;
}

// --- Skins, on demand -------------------------------------------------------------

/** One fetch per skin id: the pending or settled load, shared by every caller. */
const skinLoads = new Map<string, Promise<THREE.Object3D | null>>();
/** Skins whose load has settled: the template, or null when it failed. */
const skinsSettled = new Map<string, THREE.Object3D | null>();

/**
 * The model of a skin (a SKINS id): its scene, a template to clone with
 * SkeletonUtils. Fetched the first time it is asked for, then cached; a
 * failed load is cached too, as null (with a warning), and an unknown or
 * empty id is null without any fetch.
 */
export function skinModel(id: string): Promise<THREE.Object3D | null> {
  let p = skinLoads.get(id);
  if (p) return p;
  const def = skinOf(id);
  if (!def) {
    p = Promise.resolve(null);
    skinsSettled.set(id, null);
  } else {
    p = loader.loadAsync(base + "models/" + def.file).then(
      (g) => {
        skinsSettled.set(id, g.scene);
        return g.scene;
      },
      (err: unknown) => {
        console.warn(`[assets] skin "${id}" failed to load, using the placeholder instead`, err);
        skinsSettled.set(id, null);
        return null;
      },
    );
  }
  skinLoads.set(id, p);
  return p;
}

/** The skin's template if its load has settled (null: failed or unknown), undefined while pending or never asked for. */
export function skinModelNow(id: string): THREE.Object3D | null | undefined {
  return skinsSettled.get(id);
}

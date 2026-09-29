// Builds apps/client/public/models/ from the Quaternius packs (see ASSETS.md):
//
//   anims.glb         the 5 clips every skin plays, on the pack's one 23-bone rig
//                     (bones only, no mesh, no skin)
//   skins/<id>.glb    one per skin in SKINS (packages/shared/src/skins.ts):
//                     mesh + skeleton, no clips
//   guns/<name>.glb   one per weapon in GUN_VIEW, from the Ultimate Guns FBX
//                     (converted by convert-guns.py in headless Blender)
//   props.glb         optional, from the Toon Shooter Game Kit (--props)
//
// The gltf-transform packages are not dependencies of the repo, so run it from
// a scratch directory (NODE_PATH, because Bun resolves imports from the
// script's folder, not from the current one):
//
//   mkdir /tmp/models && cd /tmp/models
//   bun add @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer
//   NODE_PATH=$PWD/node_modules bun <repo>/apps/client/scripts/assets/build-models.ts \
//     <chars glTF dir> <guns FBX dir> <repo>/apps/client/public/models [--props <kit glTF dir>]
//
// <chars glTF dir> is the glTF folder of the Ultimate Animated Character Pack
// (Soldier_Male.gltf, ...), <guns FBX dir> the FBX folder of the Ultimate Guns
// pack. The gun step spawns Blender (BLENDER env var, default the macOS app
// path) to run convert-guns.py into ./guns-raw of the current directory, which
// also gets guns.json (grip and muzzle of each gun, the numbers in GUN_VIEW).
// Pass "-" as <guns FBX dir> to skip the guns.
//
// With --props, <kit glTF dir> holds env/ (Environment/glTF) and guns/
// (Guns/glTF) of the Toon Shooter Game Kit, and props.glb is rebuilt: every
// prop as a named top-level node, plus the grenade.
//
// Every file goes through prune, dedup, resample (clips only) and meshopt
// compression (decoded by MeshoptDecoder in GLTFLoader). Quantization keeps
// the glTF coordinates: it moves the scale into a node transform.
import { NodeIO, Document, type Animation } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, meshopt, mergeDocuments, resample } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const propsAt = args.indexOf("--props");
const PROPS_SRC = propsAt >= 0 ? args.splice(propsAt, 2)[1] : undefined;
const [CHARS, GUNS, OUT] = args;
if (!CHARS || !GUNS || !OUT) {
  throw new Error("usage: bun build-models.ts <chars glTF dir> <guns FBX dir | -> <out dir> [--props <kit glTF dir>]");
}
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

// Pack file name -> skin id (the ids in SKINS).
const SKINS: Record<string, string> = {
  Soldier_Male: "soldier-male",
  Worker_Male: "worker-male",
  Worker_Female: "worker-female",
  Cowboy_Male: "cowboy-male",
  Cowboy_Female: "cowboy-female",
  Chef_Hat: "chef-hat",
  Chef_Female: "chef-female",
  Doctor_Male_Young: "doctor-male-young",
  Kimono_Female: "kimono-female",
  Knight_Golden_Male: "knight-golden-male",
  Ninja_Sand: "ninja-sand",
  Ninja_Sand_Female: "ninja-sand-female",
  OldClassy_Male: "oldclassy-male",
  Elf: "elf",
  Goblin_Male: "goblin-male",
  Zombie_Male: "zombie-male",
};
// Every character has the same rig and clips; the shared clips come from this one.
const ANIMS_FROM = "Soldier_Male";
const KEEP_ANIM = new Set(["Idle", "Run", "Shoot_OneHanded", "RecieveHit", "Death"]);
// The pack names both the skinned mesh node and a bone "Body", which three.js
// dedupes into "Body" / "Body_1". Renaming the mesh node keeps the bone "Body"
// in every file, so the clip tracks of anims.glb bind by name.
const MESH_NODE = "CharacterMesh";

// Pack gun name -> file name under guns/ (the files in GUN_VIEW).
const GUNS_MAP: Record<string, string> = {
  AssaultRifle_2: "rifle",
  Shotgun_ShortStock: "shotgun",
  SniperRifle_1: "sniper",
  SubmachineGun_1: "smg",
  Revolver_1: "revolver",
  Pistol_6: "burst-pistol",
  AssaultRifle2_1: "dmr",
};

/**
 * Drops a clip with its channels and samplers. Disposing only the animation
 * leaves the samplers alive and prune() then keeps their keyframes. The
 * accessors are left to prune(): clips share time tracks.
 */
function dropAnimation(a: Animation) {
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}

const accessorsBytes = (doc: Document) => doc.getRoot().listAccessors().reduce((n, a) => n + a.getByteLength(), 0);

async function finish(doc: Document, out: string, opts: { keepLeaves?: boolean; clips?: boolean } = {}) {
  await doc.transform(
    prune({ keepLeaves: opts.keepLeaves ?? false }),
    dedup(),
    ...(opts.clips ? [resample()] : []),
    prune({ keepLeaves: opts.keepLeaves ?? false }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const path = `${OUT}/${out}`;
  await io.write(path, doc);
  const root = doc.getRoot();
  const tris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  const kb = Math.round(Bun.file(path).size / 1024);
  console.log(`${out}: ${kb} KB, ${tris} tris, ${root.listAccessors().length} accessors (${accessorsBytes(doc)} B), clips [${root.listAnimations().map((a) => a.getName()).join(", ")}]`);
}

mkdirSync(`${OUT}/skins`, { recursive: true });
mkdirSync(`${OUT}/guns`, { recursive: true });

// anims.glb: the rig's bones and the kept clips. The mesh and the skin go
// (nothing to draw), and keepLeaves holds the end bones (Head, Fist.R...) that
// no longer hang under a skin.
{
  const doc = await io.read(`${CHARS}/${ANIMS_FROM}.gltf`);
  for (const a of doc.getRoot().listAnimations()) if (!KEEP_ANIM.has(a.getName())) dropAnimation(a);
  for (const node of doc.getRoot().listNodes()) {
    if (node.getMesh()) {
      node.getMesh()!.dispose();
      node.dispose();
    }
  }
  for (const s of doc.getRoot().listSkins()) s.dispose();
  await finish(doc, "anims.glb", { keepLeaves: true, clips: true });
}

// skins/<id>.glb: mesh and skeleton, no clips.
for (const [name, id] of Object.entries(SKINS)) {
  const doc = await io.read(`${CHARS}/${name}.gltf`);
  for (const a of doc.getRoot().listAnimations()) dropAnimation(a);
  for (const node of doc.getRoot().listNodes()) if (node.getMesh()) node.setName(MESH_NODE);
  await finish(doc, `skins/${id}.glb`);
}

// guns/<name>.glb: Blender converts the FBX (and measures grip and muzzle),
// then meshopt. The node stays where convert-guns.py put it.
if (GUNS !== "-") {
  const raw = resolve("guns-raw");
  const blender = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
  const script = resolve(import.meta.dir, "convert-guns.py");
  const proc = Bun.spawnSync([blender, "-b", "-P", script, "--", GUNS, raw, ...Object.keys(GUNS_MAP)], { stdout: "ignore", stderr: "inherit" });
  if (proc.exitCode !== 0) throw new Error(`convert-guns.py failed (exit ${proc.exitCode})`);
  console.log(`guns converted into ${raw} (guns.json has grip and muzzle)`);
  for (const [name, file] of Object.entries(GUNS_MAP)) {
    const doc = await io.read(`${raw}/${name}.glb`);
    await finish(doc, `guns/${file}.glb`);
  }
}

// props.glb (optional): one file with every prop as a named top-level node.
if (PROPS_SRC) {
  const PROPS = ["Crate", "SackTrench_Small", "Barrier_Single", "Container_Small", "BrickWall_2", "TrafficCone", "Pallet", "Pallet_Broken",
    "Debris_Papers_1", "Debris_Papers_2", "Debris_Papers_3", "Debris_Pile", "WoodPlanks", "Debris_Tires", "ExplodingBarrel", "CardboardBoxes_1", "CardboardBoxes_2", "CardboardBoxes_4"];
  const props = new Document();
  props.createBuffer();
  const main = props.createScene("props");
  props.getRoot().setDefaultScene(main);
  const addDoc = async (path: string, name: string) => {
    const src = await io.read(path);
    const map = mergeDocuments(props, src);
    for (const s of src.getRoot().listScenes()) {
      const scene = map.get(s) as any;
      const holder = props.createNode(name);
      for (const child of scene.listChildren()) holder.addChild(child);
      main.addChild(holder);
      scene.dispose();
    }
  };
  for (const p of PROPS) await addDoc(`${PROPS_SRC}/env/${p}.gltf`, p);
  await addDoc(`${PROPS_SRC}/guns/Grenade.gltf`, "Grenade");
  // Collapse to one buffer.
  const bufs = props.getRoot().listBuffers();
  for (const b of bufs.slice(1)) {
    for (const acc of props.getRoot().listAccessors()) if (acc.getBuffer() === b) acc.setBuffer(bufs[0]);
    b.dispose();
  }
  await finish(props, "props.glb");
}

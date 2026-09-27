// Builds client/public/models/*.glb from the Quaternius Toon Shooter Game Kit
// (glTF folder of the Google Drive download, see ASSETS.md).
//
// The gltf-transform packages are not dependencies of the repo, so run it from
// a scratch directory:
//
//   mkdir /tmp/models && cd /tmp/models
//   bun add @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer
//   bun <repo>/scripts/assets/build-models.ts <kit glTF dir> <repo>/client/public/models
//
// <kit glTF dir> holds Soldier.gltf and Enemy.gltf (Characters/glTF), plus
// env/ (Environment/glTF) and guns/ (Guns/glTF).
//
// Characters: keeps the body and the 4 guns we use (they hang off the right
// hand, visibility toggled in game), and the 6 clips we play. Props: one file
// with every prop as a named top-level node. Then prune, dedup, resample and
// meshopt compression (decoded by MeshoptDecoder in GLTFLoader).
import { NodeIO, Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, meshopt, mergeDocuments, resample } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) throw new Error("usage: bun build-models.ts <kit glTF dir> <out dir>");
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

const KEEP_MESH = new Set(["Body", "Head", "ShoulderPad.L", "ShoulderPad.R", "Character_Enemy", "Character_Enemy_Head", "AK", "Shotgun", "SMG", "Sniper"]);
const KEEP_ANIM = new Set(["Idle", "Idle_Shoot", "Run", "Run_Shoot", "HitReact", "Death"]);

async function finish(doc: Document, out: string) {
  await doc.transform(prune(), dedup(), resample(), prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await io.write(`${OUT}/${out}`, doc);
  const tris = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  console.log(out, "tris", tris, "anims", doc.getRoot().listAnimations().map((a) => a.getName()).join(","));
}

for (const name of ["Soldier", "Enemy"]) {
  const doc = await io.read(`${SRC}/${name}.gltf`);
  for (const node of doc.getRoot().listNodes()) {
    if (node.getMesh() && !KEEP_MESH.has(node.getName())) node.dispose();
  }
  for (const a of doc.getRoot().listAnimations()) if (!KEEP_ANIM.has(a.getName())) a.dispose();
  await finish(doc, `${name.toLowerCase()}.glb`);
}

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
for (const p of PROPS) await addDoc(`${SRC}/env/${p}.gltf`, p);
await addDoc(`${SRC}/guns/Grenade.gltf`, "Grenade");
// Collapse to one buffer.
const bufs = props.getRoot().listBuffers();
for (const b of bufs.slice(1)) {
  for (const acc of props.getRoot().listAccessors()) if (acc.getBuffer() === b) acc.setBuffer(bufs[0]);
  b.dispose();
}
await finish(props, "props.glb");

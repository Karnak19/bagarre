// Skins and gun models: what every player looks like and what they hold.
//
// Purely visual: every skin has the same hitbox (the physics capsule) and
// speed. The files are built by apps/client/scripts/assets/build-models.ts
// from Quaternius' Ultimate Animated Character Pack and Ultimate Guns pack
// (see ASSETS.md), and live in apps/client/public/models/.

export interface SkinDef {
  /** Stored on the account and sent over the network: never rename or reuse one. */
  id: string;
  /** Shown in the skin picker. */
  name: string;
  /** Mesh-only character file under models/, animated by the shared models/anims.glb. */
  file: string;
}

/**
 * Every skin, in the picker's order. Ids are stable: append new ones at the
 * end, and never renumber, rename or remove one (accounts store the id).
 */
export const SKINS: readonly SkinDef[] = [
  { id: "soldier-male", name: "Soldier", file: "skins/soldier-male.glb" },
  { id: "worker-male", name: "Worker", file: "skins/worker-male.glb" },
  { id: "worker-female", name: "Builder", file: "skins/worker-female.glb" },
  { id: "cowboy-male", name: "Cowboy", file: "skins/cowboy-male.glb" },
  { id: "cowboy-female", name: "Cowgirl", file: "skins/cowboy-female.glb" },
  { id: "chef-hat", name: "Chef", file: "skins/chef-hat.glb" },
  { id: "chef-female", name: "Cook", file: "skins/chef-female.glb" },
  { id: "doctor-male-young", name: "Doctor", file: "skins/doctor-male-young.glb" },
  { id: "kimono-female", name: "Kimono", file: "skins/kimono-female.glb" },
  { id: "knight-golden-male", name: "Golden knight", file: "skins/knight-golden-male.glb" },
  { id: "ninja-sand", name: "Sand ninja", file: "skins/ninja-sand.glb" },
  { id: "ninja-sand-female", name: "Desert ninja", file: "skins/ninja-sand-female.glb" },
  { id: "oldclassy-male", name: "Gentleman", file: "skins/oldclassy-male.glb" },
  { id: "elf", name: "Elf", file: "skins/elf.glb" },
  { id: "goblin-male", name: "Goblin", file: "skins/goblin-male.glb" },
  { id: "zombie-male", name: "Zombie", file: "skins/zombie-male.glb" },
];

/** The clips every skin plays, in one shared file (one rig for all skins). */
export const SKIN_ANIMS_FILE = "anims.glb";

const SKIN_IDS = new Set(SKINS.map((s) => s.id));
export const isSkinId = (id: unknown): id is string => typeof id === "string" && SKIN_IDS.has(id);
export const skinOf = (id: string | undefined | null): SkinDef | undefined => SKINS.find((s) => s.id === id);

/**
 * A random skin, preferring one nobody in `taken` wears. `random` is injectable
 * for tests (defaults to Math.random).
 */
export function randomSkin(taken: Iterable<string> = [], random: () => number = Math.random): string {
  const used = new Set(taken);
  const free = SKINS.filter((s) => !used.has(s.id));
  const pool = free.length > 0 ? free : SKINS;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].id;
}

# Assets

Every third-party asset in the game, where it comes from and its license.
The art is CC0 (public domain): no attribution required, credit given here
anyway. The one font is under the SIL Open Font License.

| Pack | Author | URL | License | Used for |
| --- | --- | --- | --- | --- |
| Ultimate Animated Character Pack | Quaternius | https://quaternius.com/packs/ultimatedanimatedcharacter.html | CC0 1.0 | Player skins and their clips |
| Ultimate Guns | Quaternius | https://quaternius.com/packs/ultimategun.html | CC0 1.0 | The gun in each player's hand |
| Toon Shooter Game Kit | Quaternius | https://quaternius.com/packs/toonshootergamekit.html | CC0 1.0 | Arena props, the grenade |
| Particle Pack (1.1) | Kenney | https://kenney.nl/assets/particle-pack | CC0 1.0 | Muzzle flashes, sparks, explosion, smoke, scorch marks |
| Black Ops One | James Grieshaber (Typeset.it) | https://fonts.google.com/specimen/Black+Ops+One | SIL OFL 1.1 | The menu's title and a few display labels |

## Files in the repo

| File | Size | What's in it |
| --- | --- | --- |
| `apps/client/public/models/anims.glb` | 101 KB | The 5 clips every skin plays, on the shared rig (bones only, no mesh) |
| `apps/client/public/models/skins/*.glb` | 64–141 KB each, 1.54 MB for all 16 | One character per skin in `SKINS` (`packages/shared/src/skins.ts`): mesh and skeleton, no clips |
| `apps/client/public/models/guns/*.glb` | 16–27 KB each, 152 KB for all 7 | One gun per weapon in `GUN_MODELS` |
| `apps/client/public/models/props.glb` | 128 KB | Arena props, one named node each |
| `apps/client/public/vfx/particles.png` | 212 KB | 4 x 4 greyscale atlas of Kenney particles |
| `apps/client/public/fonts/black-ops-one.woff2` | 23 KB | Black Ops One, Latin subset (the Google Fonts woff2) |

About 2.2 MB in total, but a match only loads the skins it shows: a room of 8
different skins is about 0.9 MB of characters.

### Characters

From the Ultimate Animated Character Pack's `glTF` folder, 16 of the 52
characters: Soldier_Male, Worker_Male, Worker_Female, Cowboy_Male,
Cowboy_Female, Chef_Hat, Chef_Female, Doctor_Male_Young, Kimono_Female,
Knight_Golden_Male, Ninja_Sand, Ninja_Sand_Female, OldClassy_Male, Elf,
Goblin_Male and Zombie_Male (why these: issue #11). Each becomes
`skins/<skin id>.glb`. The skinned mesh node is renamed `CharacterMesh`
(the pack calls it `Body`, like a bone).

Every character has the same 23-bone rig and the same clips, so the clips ship
once, in `anims.glb`, taken from Soldier_Male: 5 of the 17 (Idle, Run,
Shoot_OneHanded, RecieveHit, Death). The client binds them onto each skin's
skeleton by bone name.

### Guns

From the Ultimate Guns pack's `FBX` folder, 7 guns, one per weapon:
AssaultRifle_2 (rifle), Shotgun_ShortStock (shotgun), SniperRifle_1 (sniper),
SubmachineGun_1 (SMG), Revolver_1 (revolver), Pistol_6 (burst pistol) and
AssaultRifle2_1 (DMR).

### Props

From `Environment/glTF`: BrickWall_2 (outer walls), Crate and
CardboardBoxes_1 (centre stack), SackTrench_Small and Barrier_Single (long
cover), Container_Small (corner cover), and for decoration Debris_Papers_1-3,
Debris_Pile, Debris_Tires, Pallet, Pallet_Broken, WoodPlanks, TrafficCone,
ExplodingBarrel, CardboardBoxes_2 and CardboardBoxes_4. From `Guns/glTF`:
Grenade (the thrown grenade).

### Particles

From `PNG (Transparent)`: muzzle_01, muzzle_02, muzzle_04, muzzle_05,
spark_01, spark_02, trace_07, star_07, smoke_01, smoke_04, smoke_07, fire_01,
fire_02, scorch_01, scorch_03, circle_05. Only their alpha channel is kept,
downscaled to 256 px.

## Rebuilding

The raw packs are not in the repo. To rebuild the files above:

- Models: `apps/client/scripts/assets/build-models.ts` (gltf-transform: keep
  the clips we play, strip the rest, prune, dedup, resample, meshopt
  compression). It also runs `convert-guns.py` in headless Blender to turn the
  gun FBX into glTF and measure each gun's grip and muzzle (`guns.json`, the
  numbers in `GUN_MODELS`). `props.glb` is only rebuilt with `--props` and the
  Toon Shooter kit. Instructions at the top of the file. The client decodes
  meshopt with three's `MeshoptDecoder`.
- Previews: `apps/client/scripts/assets/render-previews.py` (Blender) renders
  contact sheets of the characters and guns.
- Particle atlas: `apps/client/scripts/assets/build-atlas.py` (Pillow), or
  `bun run assets:atlas <pack dir> public/vfx/particles.png` from `apps/client`.
  The cell order must match `Cell` in `apps/client/src/vfx.ts`.

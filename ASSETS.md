# Assets

Every third-party asset in the game, where it comes from and its license.
The art is CC0 (public domain): no attribution required, credit given here
anyway. The one font is under the SIL Open Font License.

| Pack | Author | URL | License | Used for |
| --- | --- | --- | --- | --- |
| Toon Shooter Game Kit | Quaternius | https://quaternius.com/packs/toonshootergamekit.html | CC0 1.0 | Characters, guns, arena props |
| Particle Pack (1.1) | Kenney | https://kenney.nl/assets/particle-pack | CC0 1.0 | Muzzle flashes, sparks, explosion, smoke, scorch marks |
| Black Ops One | James Grieshaber (Typeset.it) | https://fonts.google.com/specimen/Black+Ops+One | SIL OFL 1.1 | The menu's title and a few display labels |

## Files in the repo

| File | Size | What's in it |
| --- | --- | --- |
| `apps/client/public/models/enemy.glb` | 474 KB | Quaternius "Enemy" (player slot 0, tinted orange) |
| `apps/client/public/models/soldier.glb` | 488 KB | Quaternius "Soldier" (player slot 1, tinted blue) |
| `apps/client/public/models/props.glb` | 128 KB | Arena props, one named node each |
| `apps/client/public/vfx/particles.png` | 212 KB | 4 x 4 greyscale atlas of Kenney particles |
| `apps/client/public/fonts/black-ops-one.woff2` | 23 KB | Black Ops One, Latin subset (the Google Fonts woff2) |

About 1.2 MB in total.

### Characters

From the kit's `Characters/glTF` folder: `Enemy.gltf` and `Soldier.gltf`.
They share one 43-bone rig. Each file ships with 14 guns attached to the
right hand; we keep the 7 we use (AK for the rifle, Shotgun, Sniper, SMG, Revolver, Pistol for the burst pistol, Sniper_2 for the DMR) and
6 of the 17 clips (Idle, Idle_Shoot, Run, Run_Shoot, HitReact, Death).

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

- Models: `apps/client/scripts/assets/build-models.ts` (gltf-transform: strip unused guns
  and clips, prune, dedup, resample, meshopt compression). Instructions at the
  top of the file. The client decodes meshopt with three's `MeshoptDecoder`.
- Particle atlas: `apps/client/scripts/assets/build-atlas.py` (Pillow), or
  `bun run assets:atlas <pack dir> public/vfx/particles.png` from `apps/client`.
  The cell order must match `Cell` in `apps/client/src/vfx.ts`.

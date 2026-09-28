# Maps

Seven maps live in `packages/shared/src/maps/`: the original arena (Yard) plus six new
ones. They are plain data, and each match picks one at random (never the one
just played). The wiring plan at the end of this file is implemented; its
"As built" notes list where the code differs from it.

None of the maps is mirrored. Each side of a map is built differently (a
maze against open ground, tall containers against crates, a trench against
stepping stones), and the validator measures that both sides still get the
same deal (see "Fairness").

| Map | Size | Plays like | Favours |
| --- | --- | --- | --- |
| Yard | 30 x 30 | The original: open, a crate stack and a different bit of cover in each corner | rifle, SMG |
| Runway | 40 x 28 | A long airstrip: low cover at the terminal, brick hangars and a fuel depot at the far end, open tarmac between | sniper, rifle |
| Trenchworks | 28 x 28 | Sandbag trenches round a broken crater: a tight warren on one side, a barrel yard on the other | shotgun, SMG |
| Fort | 32 x 32 | A brick blockhouse with a guardroom annex, an open field on one side and a walled courtyard on the other | rifle, SMG |
| Dockside | 36 x 28 | Three lanes: tall container stacks on one side, crates and barrels at the berth on the other | rifle (middle), SMG (stacks) |
| Nest | 30 x 30 | King of the hill: a lopsided sandbag nest, reached by a trench on one side and crate hops on the other | rifle, shotgun |
| Scrapyard | 34 x 30 | A maze of low junk walls on one side, open ground and big wrecks on the other | SMG, shotgun, rifle |

## Tools

```sh
bun run maps:validate                   # from the root, through turbo: check every map, print the table, exit 1 on error

# From packages/shared:
bun run maps:validate runway            # just one
bun run maps:preview [outDir] [mapId...]   # PNG plans + iso views (+ all-maps.png)
bun run typecheck                       # type-checks the maps (src/) and the tools (scripts/)
```

`preview.ts` writes SVG and converts it with `sips` (macOS). Default output is
`.previews/maps/` at the repo root (git-ignored); pass a directory as the first argument to change it.
Each map gets `<id>-top.png` (plan with exposure heat, longest sightlines in
yellow, the spawn-to-spawn path dotted, box heights written on the boxes) and
`<id>-iso.png` (the game's camera angle, heights as drawn, players 1.8 m).

What the validator checks, per map:

- size within 24..40 m a side; every box inside the floor, at least 0.5 m
  thick, between 0.8 m and 2.0 m tall (see "Readability");
- no box overlaps a spawn (player radius + 0.25 m); spawns come in pairs;
- fairness: for each spawn pair (2k, 2k + 1), ten measures taken for both
  sides, and the gap between them must stay within a tolerance (see
  "Fairness" below);
- the map must not read as mirrored: at most 45 % of the box footprint may
  have a twin under any one mirror (see "Fairness");
- no gap narrower than 1.6 m (player diameter 1 m + 0.6 m) between two boxes
  or a box and the outer wall, unless it is closed (touching) or filled by
  another box;
- flood fill on a 10 cm grid of player-centre positions: every standable cell
  is reachable from spawn 0 (no sealed pockets), every spawn is reachable;
- no two spawns can shoot each other (three parallel rays, centre and both
  body edges, against boxes inflated by the bullet radius);
- time to contact: both players walk the shortest path (visibility graph over
  the boxes inflated by the player radius) toward each other from each spawn
  pair; they must meet within 2.5..6.5 s (warning outside 3..6 s);
- a warning for a spawn seen from more than 30 % of the floor, or more than
  8 % of the floor hiding a chest from the camera;
- tall decor (cones, barrels, cardboard, tyres) only outside the walls.

Columns of the table: `cover` share of the floor under boxes; `longest LOS`
the longest clear shot between two standable points; `LOS>18m` of the point
pairs farther apart than rifle range, the share with a clear shot (the sniper
number); `open` share of all point pairs with a clear shot; `contact` and
`first sight` (when the two walkers first get a clear shot, and at what
distance); `cam-hidden` share of the floor where a player's chest (1 m) is
hidden from the camera; `spawn exp` the most exposed spawn; `mirror` the
most mirrored reading of the box footprint; `worst gap` the fairness measure
closest to failing, as a share of what it is allowed.

Current results:

```
map          size m  boxes  cover  longest LOS  LOS>18m  open  spawn path  contact  first sight   cam-hidden  spawn exp  mirror  worst gap                   result
yard         30x30   9      4.9%   37.6 m       29%      51%   36.0 m      3.00 s   1.27 s @21 m  0.2%        48%        25%     57% territory               ok
runway       40x28   26     10.4%  40.3 m       15%      32%   43.6 m      3.64 s   2.00 s @19 m  0.4%        13%        27%     84% cover spots near spawn  ok
trenchworks  28x28   32     18.3%  24.7 m       0%       11%   39.2 m      3.27 s   2.83 s @5 m   0.0%        11%        33%     88% walk to centre          ok
fort         32x32   31     13.7%  31.6 m       2%       15%   39.7 m      3.31 s   2.10 s @14 m  0.1%        13%        27%     60% walk to centre          ok
dockside     36x28   26     18.5%  35.2 m       3%       16%   41.4 m      3.45 s   2.47 s @12 m  2.9%        9%         29%     87% cam-hidden territory    ok
nest         30x30   21     9.3%   32.6 m       10%      31%   37.0 m      3.08 s   2.57 s @6 m   0.5%        16%        32%     69% tall-box camera shadow  ok
scrapyard    34x30   25     15.2%  38.6 m       5%       20%   39.9 m      3.33 s   2.70 s @7 m   1.2%        17%        21%     81% cam-hidden territory    ok
```

Accepted warnings: Yard's respawn pair (spawns 2 and 3) is exposed (42-48 %
of the floor sees it; Yard is meant to be open), and the respawn pairs of
Yard, Dockside and Scrapyard meet in 2.6-2.9 s, a bit under the 3 s target
(the first pair, used at match start, is at 3.0-3.6 s everywhere).

## The MapDef format

`packages/shared/src/maps/types.ts`:

```ts
interface MapDef {
  id: string;            // stable, sent over the wire as mapId
  name: string;
  blurb: string;         // one line
  halfX: number;         // floor is [-halfX, halfX] x [-halfZ, halfZ]
  halfZ: number;
  obstacles: readonly Obstacle[];   // Obstacle = arena.ts Box + kind
  spawns: readonly Spawn[];         // balanced pairs: spawns[2k] vs spawns[2k+1], measured, not mirrored
  decor: readonly Decor[];          // { prop, x, z, yaw, scale? }, no collision
  theme: MapTheme;
  favours: readonly WeaponTag[];    // "rifle" | "shotgun" | "sniper" | "smg"
}
```

- `Obstacle` is exactly arena.ts's `Box` (`x, z, w, d, h`, centre + full
  footprint) plus `kind`, so a `MapDef` can be handed to anything that takes
  boxes. Collision ignores `kind` and `h`.
- `h` is the height the renderer draws the prop at.
- `kind` picks the prop (all exist in `props.glb`):

  | kind | prop | how to dress the box |
  | --- | --- | --- |
  | `crate` | `Crate` (+ `CardboardBoxes_1` on top of big stacks) | grid of crates, ~1.5 m cells, scaled to `h` |
  | `barrier` | `Barrier_Single` | tiled along the long side |
  | `sandbags` | `SackTrench_Small` | tiled along the long side |
  | `container` | `Container_Small` | one container stretched to the footprint, at `h` |
  | `wall` | `BrickWall_2` | tiled along the long side, at `h` |
  | `barrels` | `ExplodingBarrel` | packed on a ~1 m grid (visual only, no explosion) |

- Spawn order: slot 0 starts a match on `spawns[0]`, slot 1 on `spawns[1]`.
  Respawns pick among all of them: a spawn the opponent can't see first
  (`bodiesSee`), then the farthest from the opponent (`respawnPoint` in
  `packages/shared/src/sight.ts`). Every map has two pairs.
- `Decor.prop` is a union of prop names. Flat ones (`Debris_*`, `Pallet*`,
  `WoodPlanks`) may sit anywhere; tall ones (`TrafficCone`, `Debris_Tires`,
  `ExplodingBarrel`, `CardboardBoxes_*`) only outside the walls, where nobody
  can stand behind them. Decor is placed at native size times `scale`.
- `MapTheme`: `floor`, `grid`, `gridOpacity`, `outerFloor`, `background`,
  `wall` (`"brick" | "barrier" | "sandbags"`, the prop tiled along the outer
  walls), `hemiSky`, `hemiGround`, `hemiIntensity`, `sun`, `sunIntensity`,
  `sunDir` (a position for the DirectionalLight, like `(12, 25, 6)`).
  Colours are 0xRRGGBB numbers.

Extras in `types.ts` and `index.ts`:

- `MAPS` (Yard first), `DEFAULT_MAP_ID = "yard"`, `mapById(id)` (falls back to
  Yard for an unknown id).
- Authoring helpers: `box(kind, x, z, w, d, h)` and `ascii(halfX, halfZ,
  rows, legend, { cell? })`: the whole floor as ASCII art, rows from -z to
  +z, one character per `cell` metres (default 1), `.` for floor, runs of the
  same character merged into as few boxes as possible (Runway, Dockside
  and Scrapyard are drawn this way). What is drawn is the map; nothing is
  mirrored.

## Fairness

The maps used to be mirrored: one half drawn, the other half its copy
rotated 180 degrees. That is fair on paper but boring to learn (every spot
has a twin), and it turned out not even to be fair on screen (see "Why
mirroring is not enough" below). Now each side is built on its own and the
validator checks that the two sides of every spawn pair get the same deal.

`scripts/analyze.ts` (`FAIR`, `fairness`) takes ten measures for each side of
a spawn pair. The gap between the two sides may be at most max(abs, rel x
the larger of the two values). Pairs after 0/1 are respawn spots
(`respawnPoint` sends players away from the opponent, so they rarely face
off from a standing start) and get 1.5 times more room (`RESPAWN_SLACK`).
`bun run maps:validate` prints each pair's table (side A, side B, gap,
allowed, score = gap / allowed) and the `worst gap` column; over 100 % fails.

| measure | abs | rel | what |
| --- | --- | --- | --- |
| spawn exposure | 3 pp | 15 % | share of the floor with a clear shot at the spawn |
| long-LOS exposure | 3 pp | 20 % | of the floor more than 18 m away, the share with a clear shot at the spawn (sniper lanes) |
| nearest cover | 1 m | - | spawn to the nearest box surface |
| cover spots near spawn | 2 m² | 25 % | floor within 8 m walk of the spawn, hugging a box (<= 1 m) that blocks the shot from the enemy spawn |
| walk to centre | 1.5 m | 5 % | walk from the spawn to the centre (the standable floor closest to (0, 0)) |
| retreat at first sight | 1 m | - | both walk toward each other; at first sight, how far each is from a spot the other can't see |
| territory | 6 pp | - | share of the floor closer (walking) to this spawn than to the other |
| cam-hidden territory | 1.5 pp | - | share of the side's territory where a chest (1 m) is hidden from the camera |
| cam-hidden cover spots | 8 pp | - | of the cover spots in the territory, the share where the chest is hidden from the camera |
| tall-box camera shadow | 2 pp | - | share of the territory where a box taller than 1.2 m hides the waist (0.5 m) from the camera |

For example, spawn exposure 20 % against 23 % passes (the gap, 3 pp, is
within max(3 pp, 15 % of 23 %)), 20 % against 24 % fails.

The mirror check (`mirrorShares`, `mirrorCheck` in `analyze.ts`, limit
`MAX_MIRROR_SHARE` = 45 %) keeps the maps from drifting back to copies. For
each way the arena can be mirrored (the 180 degree turn, across x = 0,
across z = 0, and on a square arena across both diagonals) it samples the
floor under boxes every 0.5 m and counts how much of it lands under a box
again once mirrored. A map built by hand sits around 10-35 %; a mirrored
one near 100 %. The FFA validator uses the same check.

### Why mirroring is not enough

The camera looks down from one corner, so "up the screen" (-x/-z) and "down
the screen" (+x/+z) are not the same. On a map turned 180 degrees, the
player up the screen takes cover on the far side of a box from the enemy,
which is also the side the camera can't see: on screen they vanish behind
it. The player down the screen hides on the side facing the camera and
stays in plain view. The old point-mirrored maps all failed the camera
measures for that reason.

The easy fix, learned on Dockside: put the two starts on the screen's
left-right axis (one at -x/+z, the other at +x/-z). Then both players face
each other across the screen, both hide on faces the camera sees the same
way, and the camera measures come out even almost by themselves. Moving
Dockside's spawns did more for its camera numbers than any amount of moving
containers. Dockside, Scrapyard and Nest start this way; the others start
in opposite corners and balance the camera with box heights and placement
instead.

## Readability from the iso camera

The camera looks down (-1, -1, -1): a box hides what stands right behind it
towards -x/-z (up the screen). Since every box is axis-aligned, every wall
sits at 45 degrees to the view, so there is no "safe" direction for long
walls; height is what matters. A player's centre is always at least 0.5 m
from a box, so the ray from a point at height `y` back to the camera clears a
box shorter than `y + 0.35` m. In practice:

- a box up to 1.35 m can never hide a player's chest (1 m), and one up to
  2.0 m can never hide a whole player (head ~1.7 m);
- all long walls are low: sandbags 1.1 m, barriers 1.2 m, brick 1.4 m
  (1.2 m on Runway, see its section);
- containers (1.8 m) are only used for compact blocks (the Runway terminal and
  tower, the Dockside stacks, spawn shelters, the Scrapyard wrecks), never as thin maze walls;
- the validator refuses anything over 2.0 m and reports `cam-hidden`: 0 to
  2.9 % of the floor. Dockside is the highest, behind its container stacks,
  by design (it is the "break line of sight" map);
- outer walls stay at 1.4 m or lower on every theme.

Screen reach: the view is 22 m tall at 16:9, so the visible ground around the
player reaches about 19 m along the screen axes (world diagonals) and about
27 m along the world X and Z axes. Runway's long lanes run along X on purpose.

## The maps

Coordinates: `x` right, `z` down on the plans; "top" means -z. On screen the
top-left corner of the plan (-x, -z) is at the top. "Side A" is spawn 0's
side, "side B" spawn 1's.

### Yard

The original arena, rebuilt without mirroring, 30 x 30 m. Still sparse and
open (51 % of point pairs see each other, 3.0 s to contact), and still the
default and the map most smoke checks run on. Each corner has its own cover:

- **Trench** (north-west, spawn 0): two low sandbag lines.
- **Pen** (south-east, spawn 1): a container and a long sandbag line.
- North-east: two barrel stacks and a short barrier. South-west: one barrier.
- A 3 x 3 crate stack a step north of the centre.

Balance: the two starts are in opposite corners as before; the Trench's
two lines and the Pen's container give each side about the same cover and
view. The first clear shot now comes at about 21 m (the old layout gave 7 m).
The respawn corners (2 and 3) no longer see each other.

### Runway: the sniper's map

An abandoned desert airstrip at noon, 40 x 28 m, the widest map. Only 10 %
of the floor is under cover, and the strip between the two ends stays open:
the longest clear shot is 40 m and 15 % of the long point pairs see each
other, the most of any map after Yard.

- **Terminal** (west, spawns 0 and 2): a 5 x 3 m container block on the north
  wall with a walled forecourt sheltering spawn 0, a jet-bridge barrier, low
  sandbag pieces and parked baggage carts on the apron. In the south-west a
  9 m blast fence stands in front of spawn 2's sandbag shelter.
- **Hangars** (east, north wall): two open-fronted brick hangars sharing a
  middle wall, with door stubs and a tug parked in one. Spawn 3 is inside
  the eastern one.
- **Fuel Depot** (south-east): three barrel tanks, a sandbag bund, and a fuel
  truck (a container) next to spawn 1.
- **Strip**: the control **Tower** (a 2 x 2 container) just west of the
  middle, and taxiway edge barriers, on the north side of the west half and
  the south side of the east half. The 40 m sniper lane runs along world X,
  so it stays on screen longer.
- Balance: the Terminal is low cover in many pieces, the east end fewer and
  bigger. Both starts are seen from about 7 % of the floor; cover spots near
  the spawn (4.3 against 6.0 m²) are the measure closest to its limit. The
  hangar walls are 1.2 m, not the usual 1.4 m brick: at 1.4 m they cast too
  much camera shadow and the respawn pair failed.

### Trenchworks: the shotgun map

Mud, overcast light, 28 x 28 m, sandbag trenches (1.1 m) all over. The
longest clear shot is 25 m and only 11 % of point pairs see each other.

- **Warren** (top of the screen, spawn 0): long parallel sandbag trenches
  in tight 3 m cells, with crate stacks at the junctions. The **Long
  Trench**, a 10 m sandbag wall at x = -6.5, is its spine.
- **Barrel Yard** (bottom right, spawn 1): wider cells broken up by barrel
  piles, short sandbag stubs off the east wall and a brick L.
- **Brick Row** (bottom left, spawn 2): one brick wall and a few stubs off
  the south wall, split from the Barrel Yard by a sandbag line.
- **Crater** (the middle): a broken sandbag ring, open to the west and the
  south-east.
- Balance: the Warren has more walls, the Barrel Yard fatter blocks. Cover
  spots near the spawn come out at 5.4 against 6.2 m²; the walk to the
  Crater (19.9 against 18.6 m) is the measure closest to its limit.
- Grenades: every trench is about 3 m wide, so a grenade on a corner covers
  both legs.

### Fort: the central structure

A brick blockhouse at dusk, 32 x 32 m. In the middle, a 12 x 9 m hall with a
guardroom annex on its south-east corner, round a crate **Keep**: inside,
the floor is an L. Four 1.4 m brick walls, four doors, no two facing each
other (north and south-west on the Field side, east on the Courtyard side,
the guardroom's on the South Yard), and a thick brick pier between hall and
guardroom that stops any shot straight through the building.

- **Field** (top of the screen, spawn 0): open ground with a sandbag
  dugout, one trench line, a crate stack and a few barrels. Long looks, few
  pieces.
- **Courtyard** (bottom right, spawn 1): brick stubs and a crate off the
  east wall, barrels and crates in front of the spawn. Short looks, more
  corners.
- **North Post** (spawn 3) and **South Yard** (spawn 2) on the other two
  corners.
- Balance: the dugout right at spawn 0 makes up for the Field's open
  ground. Both starts are seen from 10.3 % of the floor and have the same
  cover spots nearby (5.8 against 5.7 m²); the Field's walk to the middle is
  0.9 m longer.
- Grenades fly over the 1.4 m walls: from outside you can clear the hall
  without going in. The inside is a trap if you sit still.

### Dockside: lanes and flanks

The container docks at night, 36 x 28 m. Two broken rows of cargo split the
map into three lanes.

- **Stacks** (west, bottom-left of the plan, spawn 0): tall containers
  (1.8 m) standing in rows and columns, narrow alleys, sight broken
  everywhere. SMG ground.
- **Berth** (east, top-right, spawn 1): crate stacks, barrels and a low
  barrier, with two containers waiting to be loaded. More, smaller cover.
- **Mid**: the lane between the two cargo rows, a barrel pile in the middle.
  The rifle lane.
- Spawns: the two starts at the screen's left and right ends (-x/+z and
  +x/-z), the respawn pair in the middle of each quay.
- Balance: exposure, cover and the walk to the middle are within a few
  tenths. The Stacks' tall containers hide more floor from the camera (3.0 %
  of the side against 1.7 %), the measure closest to its limit; the starts
  on the screen's left-right axis are what keeps that even (see "Why
  mirroring is not enough").

### Nest: king of the hill

A cold field, 30 x 30 m. In the middle a lopsided sandbag **Nest**, closed
at the top of the screen (a sandbag wall meeting a barrier) and open three
ways, none alike: a wide gap at the screen-left corner and two narrow slots
on the screen-right side, one each side of a crate block. Whoever holds it
has cover from every side; the other player comes at it across open ground,
or throws a grenade: the 3.5 m blast covers most of it.

- **Trench** (screen left, spawns 0 and 2): two long sandbag lines from the
  spawn to the nest's wide corner. Covered all the way.
- **Stepping stones** (screen right, spawns 1 and 3): low crate stacks about
  a dash apart across open ground, to the two narrow slots.
- Flanks: at the top of the screen a container block, a barrier stub and a
  crate stack; at the bottom a sandbag line, a stub and barrels. They cut the
  long edge lanes.
- Balance: the trench is safe but long, the crates quicker but exposed. Both
  sides reach the nest in about the same time (3.1 s to contact on both
  pairs), and the spawns sit on the screen's left-right axis.

### Scrapyard: really lopsided

A junkyard at sunset, 34 x 30 m.

- **Heap** (west, bottom-left of the plan, spawn 0): a maze of low junk walls
  (sandbags, barriers, brick) on a 3 m grid with 2 m alleys, and a barrel
  dump. Cover everywhere, short sightlines, slow to cross. SMG and shotgun.
- **Lot** (east, top-right, spawn 1): open ground with a few big wrecks
  (three containers, a crate pile, two brick stubs in the middle) and a
  sandbag shelter at the start. Long lanes between the wrecks. Rifle.
- Spawns: the two starts at the screen's left and right ends, like Dockside.
- Balance: the Heap's many walls and the Lot's few big ones give about the
  same cover near each spawn (9.1 against 7.8 m²). The Lot's wrecks hide a
  little more from the camera (1.6 % of the side against 0.4 %), the
  measure closest to its limit.

## Wiring plan

**Implemented.** The plan below is kept as written; "As built" at the end
lists what changed on the way.

Order matters: shared first (the compiler then points at every caller).

### 1. `packages/shared/src/arena.ts`

Add an `Arena` shape that both the legacy constants and `MapDef` satisfy:

```ts
export interface Arena {
  halfX: number;
  halfZ: number;
  obstacles: readonly Box[];
}
```

Keep `Box`, `WALL_HEIGHT`, `WALL_THICKNESS`. Once every caller below is moved,
delete `ARENA_HALF`, `OBSTACLES` and `SPAWN_POINTS` (Yard now lives in
`maps/yard.ts`); until then leave them, they still describe Yard.

`MapDef` is structurally an `Arena` (its obstacles are `Box`es with an extra
`kind`), so maps can be passed directly.

### 2. `packages/shared/src/index.ts`

Add `export * from "./maps/index.ts";`. No name clashes: the maps module
exports `MapDef`, `Obstacle`, `ObstacleKind`, `Decor`, `DecorProp`,
`FLAT_DECOR`, `TALL_DECOR`, `MapTheme`, `WallStyle`, `WeaponTag`,
`Spawn`, `AsciiLegend`, `MAPS`, `DEFAULT_MAP_ID`, `mapById`, `box`, `ascii`.

### 3. `packages/shared/src/physics.ts`

Take the arena as an explicit first parameter, with no default. A default
would silently collide against Yard on another map and desync prediction; no
default means `tsc` finds every call site. No module-level "current map"
either: the server can run several rooms in one process.

- `movePlayer(arena: Arena, pos, dx, dz)`: use
  `limX = arena.halfX - PLAYER_RADIUS`, `limZ = arena.halfZ - PLAYER_RADIUS`
  in the final clamp, and loop over `arena.obstacles`.
- `walk(arena, pos, input, dt = TICK_DT)`.
- `bulletBlocked(arena, x, z)`: per-axis limits `arena.halfX - BULLET_RADIUS`,
  `arena.halfZ - BULLET_RADIUS`, loop over `arena.obstacles`.
- `stepBullet(arena, b, onSubstep?, dt = TICK_DT)`.
- Drop the `ARENA_HALF, OBSTACLES` import.

### 4. `packages/shared/src/combat.ts`

- `stepPlayer(arena, prev, input, weaponId, canAct)`: pass `arena` to both
  `movePlayer` calls (dash and walk) and to `grenadeTarget`.
- `grenadeTarget(arena, x, z, gx, gz)`: clamp x to
  `arena.halfX - BULLET_RADIUS`, z to `arena.halfZ - BULLET_RADIUS`.
- Drop the `ARENA_HALF` import.

### 5. `apps/server/src/state.ts`

Add to `DuelState`: `mapId: t.string().default(DEFAULT_MAP_ID)`.

### 6. `apps/server/src/DuelRoom.ts`

- Field `private map: MapDef = mapById(DEFAULT_MAP_ID);` and
  `private fixedMap = false;`.
- `onCreate(options: { mapId?: string } = {})`: if `options.mapId` names a map
  in `MAPS`, set `this.map` to it and `fixedMap = true`. Always write
  `this.state.mapId = this.map.id`.
- New `private pickMap()`: if `!fixedMap`, pick a random map from `MAPS`,
  avoiding the one just played when there is more than one; set `this.map`
  and `this.state.mapId`. Call it at the top of `startMatch()`, before
  players are placed. (The server may use `Math.random`, only the shared sim
  must be deterministic.)
- Replace every `SPAWN_POINTS` with `this.map.spawns`: `onJoin` (initial
  spawn by slot), `startMatch`, `respawn`.
- `onJoin`: face the centre instead of the hard-coded Yard angles:
  `player.aim = Math.atan2(-spawn.z, -spawn.x);`.
- `stepPlayer(this.map, ...)` in `applyInput`; `stepBullet(this.map, ...)` in
  `stepBullets`.
- A player waiting alone plays on the current map; when the second joins,
  `startMatch` may switch maps and teleports both to the new spawns (the
  client's prediction snaps: the correction is over `SNAP_DISTANCE`).

### 7. `apps/server/src/app.ts`

`createServer(options: { ...; mapId?: string })` and register the room with
`defineRoom(DuelRoom, options.mapId ? { mapId: options.mapId } : undefined)`
(Colyseus passes those default options to `onCreate`).

### 8. Client

- `apps/client/src/net.ts` / `main.ts`: read `state.mapId` from every snapshot;
  `const map = mapById(state.mapId)`. When it differs from the current one
  (including the first snapshot), call `scene.setMap(map)` and give the map
  to the predictor and the bullet predictor. Clear predicted bullets on a
  change.
- `apps/client/src/prediction.ts`: `Predictor` gets a `map: MapDef` field (set by
  main.ts), used in both `stepPlayer(this.map, ...)` calls.
- `apps/client/src/bullets.ts`: same, `stepBullet(this.map, ...)`.
- `apps/client/src/scene.ts`:
  - build the arena into its own `THREE.Group` (`this.arena`), and add
    `setMap(map)`: remove the old group from the scene, dispose its merged
    geometries (the materials belong to the loaded props, don't dispose
    those), build the new one, then apply the theme;
  - theme: `scene.background = new Color(t.background)`; keep references to
    the hemisphere light and the sun made in `buildLights()` and set
    `hemi.color = t.hemiSky`, `hemi.groundColor = t.hemiGround`,
    `hemi.intensity = t.hemiIntensity`, `sun.color = t.sun`,
    `sun.intensity = t.sunIntensity`, `sun.position.set(sunDir.x, sunDir.y,
    sunDir.z)`; shadow camera extents `Math.max(map.halfX, map.halfZ) + 3`,
    then `sun.shadow.camera.updateProjectionMatrix()`;
  - the spark test (`for (const o of OBSTACLES)` around line 414): loop over
    `this.map.obstacles`; the four wall tests use `map.halfX` for the walls
    at x = +-(halfX + WALL_THICKNESS / 2) (half-length along z
    `halfZ + WALL_THICKNESS`) and `map.halfZ` for the walls at
    z = +-(halfZ + WALL_THICKNESS / 2) (half-length along x
    `halfX + WALL_THICKNESS`).
- `apps/client/src/arenaView.ts`: `buildArena(group, props, map)` instead of the
  globals.
  - `buildFloor`: `PlaneGeometry(2 * halfX, 2 * halfZ)` with `t.floor`; outer
    plane `t.outerFloor`. `GridHelper` is square only: draw the 2 m grid as a
    `LineSegments` of lines every 2 m over the rectangle, colour `t.grid`,
    opacity `t.gridOpacity`.
  - walls: the four boxes from `halfX`/`halfZ` (x walls are
    `2 * halfX + 2 * WALL_THICKNESS` long, z walls `2 * halfZ + ...`), filled
    with `BrickWall_2` (native length, `WALL_HEIGHT`) for `"brick"`,
    `Barrier_Single` at 1.3 m for `"barrier"`, `SackTrench_Small` at 1.35 m
    for `"sandbags"`.
  - `cover(props, b)`: switch on `b.kind` instead of guessing from the aspect
    ratio, and use `b.h` as the height everywhere: `crate` the existing crate
    grid (cells `max(1, round(side / 1.5))` per side, each scaled to
    `(cw, b.h, cd)`, the cardboard box on top only when both sides are
    >= 2.5 m); `barrier` `fill(props, "Barrier_Single", b, b.h)`; `sandbags`
    `fill(props, "SackTrench_Small", b, b.h)`; `container` `place(Container_Small,
    b.x, b.z, b.w, b.d, b.h, turn)` (no more `+ 0.6`); `wall`
    `fill(props, "BrickWall_2", b, b.h)`; `barrels` a grid of
    `ExplodingBarrel` on ~1 m cells scaled to `b.h`. Add `"ExplodingBarrel"`
    and `"BrickWall_2"` to `NEEDED` (both are in props.glb already).
  - `decor(props, map)`: `for (const d of map.decor) put(d.prop, d.x, d.z,
    d.yaw, d.scale ?? 1)`. Remove the hard-coded list (it is in `yard.ts`).
  - placeholder path: same data (`map.halfX/halfZ`, `map.obstacles`, each box
    at `b.h`).
- HUD (optional): show `map.name` and `map.blurb` for a few seconds when a
  match starts.

### 9. Smoke test (`apps/server/smoke.ts`)

- Boot with the map forced: `createServer({ gracefullyShutdown: false,
  mapId: "yard" })`. The duel checks depend on Yard's geometry (the dash into
  the wall, the clear lane at z = -12, the grenade target points).
- Replace `ARENA_HALF` with `YARD.halfX` (import `YARD` or
  `mapById("yard")`), and pass the map to the local `stepPlayer` calls (lines
  ~143 and ~229).
- New checks:
  - the synced `state.mapId` is `"yard"` once playing;
  - collision follows the map: from a point next to a Runway hangar, walk
    into it with `stepPlayer(mapById("runway"), ...)` and check the player
    stops at its face, and that the same move on Yard doesn't stop there;
  - a bullet stepped with `stepBullet(mapById("trenchworks"), ...)` into a
    trench wall dies at the wall;
  - `grenadeTarget` clamps to a rectangular map's own `halfX`/`halfZ` (Runway:
    x up to 19.9, z up to 13.9);
  - optionally a second server without `mapId` that runs two matches and
    checks that `mapId` is a valid id and players spawn on that map's spawns.
- Run `bun run maps:validate` next to `smoke` (it is a root script, through
  turbo).

### As built (differences from the plan)

- **Pinning a map.** `createServer({ mapId })` registers
  `DuelRoom.pinnedTo(mapId)`, a subclass that carries the map, instead of
  `defineRoom(DuelRoom, { mapId })`. Colyseus merges the client's join options
  into the room options, so a room option could be spoofed by any client
  sending `mapId`. `pinnedTo` throws on an unknown id.
- **Dev `?map=<id>`.** The client sends it as the join option `map`. The room
  honours it when `NODE_ENV` isn't `"production"` (read at join time), from
  the creator (`onCreate`) or from the second player (`onJoin`, while
  waiting); an unknown id is ignored and a pinned server wins. It then holds
  for every match of that room.
- **Which map when.** A room starts on a random map (not always Yard), and
  its first match stays on it, so the waiting player isn't moved when the
  opponent arrives. Every later match start (after a match end, or after the
  opponent left and someone joined again) picks a random map other than the
  current one. A dev `?map=` from the second player moves a waiting player to
  that map's spawn right away, in the same tick as the match start.
- **Respawn.** `segHitsBox`, `clearShot` and `bodiesSee` moved from
  `scripts/analyze.ts` to `packages/shared/src/sight.ts` (typed on `Arena`;
  `analyze.ts` re-exports them), with the new `respawnPoint(arena, spawns,
  opponent, fallback)`: out of the opponent's sight first, then farthest.
- **`ARENA_HALF`, `OBSTACLES`, `SPAWN_POINTS` are deleted**; `arena.ts` keeps
  `Box`, `Arena`, `WALL_HEIGHT`, `WALL_THICKNESS`. `RoomStateView` (protocol.ts)
  has `mapId` too.
- **Client map switch.** Each `Snapshot` carries `mapId`; main.ts's
  `switchMap` runs before the snapshot is buffered or reconciled. Besides the
  planned steps it empties the interpolation buffer, drops drawn bullets and
  grenades without sparks, pending blasts and opponent flashes, and re-snaps
  the camera. `Predictor.setMap` forgets the predicted state but keeps the
  pending inputs: the server applied everything up to the snapshot's
  `lastSeq` on the old map and will apply the rest on the new one, so
  replaying them on the new map is exact.
- **arenaView.** `buildArena(group, props, map)` plus `disposeArena(group)`,
  which frees every geometry in the group and only the materials made for the
  arena (marked `userData.ownMaterial`), never the loaded props'. The grid is
  a `LineSegments` every 2 m; the outer ground plane is 160 m (Runway is 40 m
  wide). Crates use the planned grid; barrels a 1 m grid; containers keep
  today's facing (`b.x < 0 ? 1 : 3` quarter turns).
- **HUD.** The map's name and blurb show for 3.5 s at each match start. The
  time counts in frames (at most 100 ms per frame), not wall clock: the first
  frames of a match can take seconds while shaders compile, and would
  otherwise use the card up before anyone sees it.
- **Muzzle flash.** The opponent's flash now comes from their ammo count
  going down (one per round, at the same moment as the shot sound), not from
  a new bullet showing up: at point blank a bullet can hit and vanish within
  one tick. Our own flash still comes from our predicted bullets.
- **Smoke test.** It registers extra room types on the running server with
  `matchMaker.defineRoomType`: `duel_random` (unpinned) and one pinned room per
  wall case (Runway, Trenchworks, Fort). Checks: collision and bullets follow
  the map (pure and live), prediction exact on non-Yard maps, the synced
  `mapId` and spawns, a real match end (five kills through the room's own
  damage path) then leave-and-rejoin cycles each landing on a different map,
  the respawn rule, and the `?map=` option in dev and with
  `NODE_ENV=production`.

## Limits of the current mechanics

- Every box blocks bullets. There is no low cover to shoot over, so heights
  are purely visual and a 1.1 m sandbag line reads like cover you can shoot
  over but isn't. Proposal: a `low` flag on boxes that blocks movement, but
  lets bullets through when the shooter is within about 1 m of it (leaning
  over cover), or always. That would give trench maps real firing steps.
- Grenades ignore cover twice: they fly over everything, and the blast goes
  through walls (damage is plain distance). A wall between you and a grenade
  doesn't help. This makes tight maps like Trenchworks very grenade-friendly
  (fine, it is their counter), but "hide behind the wall from the blast" can't
  exist. Proposal: a line-of-sight check from the blast centre, with a damage
  cut behind a box. Grenades can also land inside a box's footprint.
- Boxes are axis-aligned only, so every wall is at 45 degrees on screen. No
  diagonal walls, no round cover.
- The sim is flat: "king of the hill" can only be a walled pit, not a hill.
- The camera shows about 19-27 m around the player, less than the sniper's 30
  m range: long shots on Runway can be at targets off screen. A camera that
  leans toward the aim direction would fix it.
- Respawn line of sight is checked against where the opponent stands at that
  moment, not where they will be a second later.

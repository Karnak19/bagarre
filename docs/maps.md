# Maps

Seven maps live in `shared/src/maps/`: the original arena (Yard) plus six new
ones. They are plain data, not wired into the game yet. A match will pick one
at random; the wiring plan at the end of this file lists every change needed.

| Map | Size | Symmetry | Plays like | Favours |
| --- | --- | --- | --- | --- |
| Yard | 30 x 30 | point | The original: open, four pieces of cover | rifle, SMG |
| Runway | 40 x 28 | point | Big open airstrip, long lanes, few islands | sniper, rifle |
| Trenchworks | 28 x 28 | point | Sandbag maze of 3 m trenches around a plaza | shotgun, SMG |
| Fort | 32 x 32 | point | A walled blockhouse around a crate keep | rifle, SMG |
| Dockside | 36 x 28 | point | Three lanes split by container rows | rifle (middle), SMG (flanks) |
| Nest | 30 x 30 | mirror (screen left/right) | King of the hill: one sandbag pit in an open field | rifle, shotgun |
| Scrapyard | 34 x 30 | point, dressed unevenly | Junk piles that look random but mirror exactly | SMG, shotgun, rifle |

## Tools

```sh
bun scripts/maps/validate.ts            # check every map, print the table, exit 1 on error
bun scripts/maps/validate.ts runway     # just one
bun scripts/maps/preview.ts [outDir] [mapId...]   # PNG plans + iso views (+ all-maps.png)
bunx tsc --noEmit -p scripts/maps       # type-check the tools (the maps are checked with -p shared)
```

`preview.ts` writes SVG and converts it with `sips` (macOS). Default output is
the session scratchpad; pass a directory as the first argument to change it.
Each map gets `<id>-top.png` (plan with exposure heat, longest sightlines in
yellow, the spawn-to-spawn path dotted, box heights written on the boxes) and
`<id>-iso.png` (the game's camera angle, heights as drawn, players 1.8 m).

What the validator checks, per map:

- size within 24..40 m a side; every box inside the floor, at least 0.5 m
  thick, between 0.8 m and 2.0 m tall (see "Readability");
- no box overlaps a spawn (player radius + 0.25 m);
- symmetry: every box has a mirror twin with the same footprint and height
  (the kind may differ, see Scrapyard); spawn `2k + 1` mirrors spawn `2k`;
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
- tall decor (cones, barrels, cardboard, tyres) only outside the walls.

Columns of the table: `cover` share of the floor under boxes; `longest LOS`
the longest clear shot between two standable points; `LOS>18m` of the point
pairs farther apart than rifle range, the share with a clear shot (the sniper
number); `open` share of all point pairs with a clear shot; `contact` and
`first sight` (when the two walkers first get a clear shot, and at what
distance); `cam-hidden` share of the floor where a player's chest (1 m) is
hidden from the camera; `spawn exp` the most exposed spawn.

Current results:

```
map          size m  boxes  cover  longest LOS  LOS>18m  open  spawn path  contact  first sight   cam-hidden  spawn exp
yard         30x30   7      4.1%   35.2 m       29%      51%   34.9 m      2.91 s   2.27 s @7 m   0.3%        61%
runway       40x28   24     12.1%  41.8 m       21%      37%   42.5 m      3.54 s   2.00 s @18 m  1.4%        9%
trenchworks  28x28   26     14.0%  23.4 m       0%       12%   41.1 m      3.43 s   2.43 s @12 m  0.0%        15%
fort         32x32   28     10.9%  33.6 m       6%       23%   41.2 m      3.44 s   2.63 s @9 m   0.0%        27%
dockside     36x28   24     17.5%  35.2 m       3%       17%   40.7 m      3.39 s   2.77 s @7 m   2.8%        19%
nest         30x30   24     9.0%   36.1 m       10%      29%   40.8 m      3.40 s   2.40 s @12 m  0.6%        28%
scrapyard    34x30   28     12.0%  33.2 m       7%       23%   40.3 m      3.36 s   2.43 s @11 m  0.8%        22%
```

Accepted warnings: Yard's side spawns see each other and are very exposed
(it is the original layout, kept as-is); Nest's and Scrapyard's second spawn
pair meets in 2.7-2.9 s, a bit under the 3 s target (the first pair, used at
match start, is at 3.4 s).

## The MapDef format

`shared/src/maps/types.ts`:

```ts
interface MapDef {
  id: string;            // stable, sent over the wire as mapId
  name: string;
  blurb: string;         // one line
  halfX: number;         // floor is [-halfX, halfX] x [-halfZ, halfZ]
  halfZ: number;
  symmetry: "point" | "mirrorDiag";
  obstacles: readonly Obstacle[];   // Obstacle = arena.ts Box + kind
  spawns: readonly Spawn[];         // mirrored pairs: spawns[2k+1] = mirror(spawns[2k])
  decor: readonly Decor[];          // { prop, x, z, yaw, scale? }, no collision
  theme: MapTheme;
  favours: readonly WeaponTag[];    // "rifle" | "shotgun" | "sniper" | "smg"
}
```

- `Obstacle` is exactly arena.ts's `Box` (`x, z, w, d, h`, centre + full
  footprint) plus `kind`, so a `MapDef` can be handed to anything that takes
  boxes. Collision ignores `kind` and `h`.
- `h` is the height the renderer should draw the prop at. arena.ts's own `h`
  was never used by the renderer; Yard's converted `h` values are the heights
  arenaView.ts actually draws today (crate stack 1.5, sandbags 1.35, barriers
  1.3, containers 1.8), so a renderer that honours `h` keeps Yard's look.
- `kind` picks the prop (all exist in `props.glb`):

  | kind | prop | how to dress the box |
  | --- | --- | --- |
  | `crate` | `Crate` (+ `CardboardBoxes_1` on top of big stacks) | grid of crates, ~1.5 m cells, scaled to `h` |
  | `barrier` | `Barrier_Single` | tiled along the long side, like today |
  | `sandbags` | `SackTrench_Small` | tiled along the long side, like today |
  | `container` | `Container_Small` | one container stretched to the footprint, at `h` |
  | `wall` | `BrickWall_2` | tiled along the long side, at `h` |
  | `barrels` | `ExplodingBarrel` | packed on a ~1 m grid (visual only, no explosion) |

- Spawn order: slot 0 starts a match on `spawns[0]`, slot 1 on `spawns[1]`.
  Respawns keep today's rule (farthest spawn from the opponent) over all of
  them. Every map has two pairs.
- `Decor.prop` is a union of prop names. Flat ones (`Debris_*`, `Pallet*`,
  `WoodPlanks`) may sit anywhere; tall ones (`TrafficCone`, `Debris_Tires`,
  `ExplodingBarrel`, `CardboardBoxes_*`) only outside the walls, where nobody
  can stand behind them. Decor is placed at native size times `scale`, which
  is what arenaView.ts does today.
- `MapTheme`: `floor`, `grid`, `gridOpacity`, `outerFloor`, `background`,
  `wall` (`"brick" | "barrier" | "sandbags"`, the prop tiled along the outer
  walls), `hemiSky`, `hemiGround`, `hemiIntensity`, `sun`, `sunIntensity`,
  `sunDir` (a position for the DirectionalLight, like today's `(12, 25, 6)`).
  Colours are 0xRRGGBB numbers. Yard's theme is exactly today's values.

Extras in `types.ts` and `index.ts`:

- `MAPS` (Yard first), `DEFAULT_MAP_ID = "yard"`, `mapById(id)` (falls back to
  Yard for an unknown id).
- Authoring helpers: `box(kind, x, z, w, d, h)`, `symmetric(sym, half,
  reskin?)` (adds the mirror of every box), `spawnPairs(sym, firsts)`,
  `mirrorPoint`, `mirrorBox`, and `asciiPoint(halfX, halfZ, topRows, legend,
  { reskin? })`, which builds a point-symmetric layout from ASCII art, one
  character per metre, merging runs into as few boxes as it can. Five of the
  maps are drawn that way; the art in each file is the easiest way to read
  and edit them.
- `reskin` changes the kind of the mirrored copies only. Scrapyard uses it:
  its collision is point-symmetric but a container on one side is a crate
  stack on the other, and so on.

## Readability from the iso camera

The camera looks down (-1, -1, -1): a box hides what stands right behind it
towards -x/-z (up the screen). Since every box is axis-aligned, every wall
sits at 45 degrees to the view, so there is no "safe" direction for long
walls; height is what matters. A player's centre is always at least 0.5 m
from a box, so the ray from a point at height `y` back to the camera clears a
box shorter than `y + 0.35` m. In practice:

- a box up to 1.35 m can never hide a player's chest (1 m), and one up to
  2.0 m can never hide a whole player (head ~1.7 m);
- all long walls are low: sandbags 1.1 m, barriers 1.2 m, brick 1.4 m;
- containers (1.8 m) are only used for compact blocks (hangars, the Dockside
  rows, tower, spawn shelters), never as thin maze walls;
- the validator refuses anything over 2.0 m and reports `cam-hidden`: 0 to
  2.8 % of the floor, against 0.3 % for Yard. Dockside is the highest, right
  behind its container rows, by design (it is the "break line of sight" map);
- outer walls stay at 1.4 m or lower on every theme.

Nest uses the other symmetry on purpose: mirrored across the x = z line,
which is the vertical axis of the screen. The two spawns sit on the far left
and far right of the screen and both players see the map exactly the same
way, including what hides behind what. Point symmetry only approximates this
(each box hides its own "north" side, and the twin of that spot is on the
twin's south side).

Screen reach: the view is 22 m tall at 16:9, so the visible ground around the
player reaches about 19 m along the screen axes (world diagonals) and about
27 m along the world X and Z axes. Runway's long lanes run along X on purpose.

## The maps

Coordinates: `x` right, `z` down on the plans; "top" means -z. On screen the
top-left corner of the plan (-x, -z) is at the top.

### Yard

The original arena, unchanged: a 3 x 3 crate stack in the middle, two
sandbag lines, two barriers, two small containers. Open (51 % of point pairs
see each other) and fast (2.9 s to contact). Kept as the default and as the
map the smoke test runs on.

### Runway: the sniper's map

An abandoned desert airstrip at noon, 40 x 28 m. The widest and emptiest map
(`longest LOS` 41.8 m, `LOS>18m` 21 %), with the safest spawns (9 %).

- **Bays** (four corners): sandbag revetments, U-shaped, 6 x 5 m, opening
  towards the middle through a 2 m gap. You spawn under cover.
- **Blast walls** (x = +-17, z = 0): 6 x 2 m barriers splitting each end in two
  bays.
- **Hangars**: four 5 x 3 m containers on the aprons (x = +-6.5 and +-7.5,
  z = +-10.5), the only tall cover.
- **Taxiways** (z from -8 to -4 and 4 to 8): open end to end, 40 m. The
  sniper lane, along world X so it stays on screen longer.
- **Strip**: a 2 x 2 container **Tower** at the centre and six 2 x 1 barrier
  islands around it, 5-6 m apart: a rifle player can dash island to island to
  close the distance on a sniper.
- Grenades: into a bay through its opening (10 m throw from the taxiway), or
  behind a hangar.

### Trenchworks: the shotgun map

Mud, overcast light, 28 x 28 m. A 7 x 7 grid of 3 m trench cells with 1 m
sandbag walls (1.1 m tall), plus a 12 x 12 m plaza in the middle. The longest
clear shot is 23 m and only 12 % of point pairs see each other; nothing
lines up past rifle range.

- **Plaza** (x, z from -6 to 6): four 3 m doors in a pinwheel (top-left,
  right-top, bottom-right, left-bottom), a 2 x 2 crate in the middle, four
  barrel stubs. No two doors line up.
- **Long Trench**: the 14 m wall at x = -6.5 (and its twin at 6.5) along the
  plaza's west side, the spine of the maze.
- **Edge runs**: the 3 m corridors along the outer walls give the longest
  straight shots (about 20 m), the one place a rifle does well.
- **Dugouts**: the corner cells where the spawns are. Every cell has at least
  two exits; there are no dead ends.
- Grenades: every trench cell is 3 m wide, so a grenade on a corner covers
  both legs; the plaza doors are the classic flush.

### Fort: the central structure

A brick blockhouse at dusk, 32 x 32 m. The middle is a 12 x 12 m walled
square (1.4 m brick) around a 4 x 4 m crate **Keep**, which leaves a 3 m
**Ring** corridor inside. Four 3 m doors in a pinwheel, each with a 3 x 1 m
sandbag 2-3 m outside it. You can hold the Ring, circle the Keep, or fight
around the outside.

- **Doors**: top (x -4..-1), right (z -4..-1), bottom (x 1..4), left
  (z 1..4). Because they are offset, you can't see through the fort.
- **Edge walls** at the middle of each side (brick, 2 x 4 m) keep the spawn
  corners from seeing each other along the edges.
- **Corners**: a sandbag L in front of spawns 0 and 1, a 2 x 2 crate stack in
  front of spawns 2 and 3, each about a dash from the spawn.
- Grenades fly over the 1.4 m walls: from outside you can clear a Ring leg
  without entering. The inside is a trap if you sit still.

### Dockside: lanes and flanks

The container docks at night, 36 x 28 m. Two rows of containers (z -7..-5 and
5..7, 1.8 m tall) split the map into three lanes, with three 3 m **Gaps** in
each row.

- **Mid** (z -5..5): long and open (35 m), two barriers each side and a crate
  pair at the centre. The rifle lane.
- **Quays** (top and bottom lanes): cluttered with barrels and crates, broken
  in the middle by a 2 x 4 m crate **Stack** against the wall. SMG flanks. The
  spawns sit at the ends of the quays.
- **Gaps**: x -9..-6, 6..9 and one at the far end of each row. Crossing a gap
  is the risky move; a grenade in a gap flushes a camper.

### Nest: king of the hill

A cold field, 30 x 30 m, mirrored left/right on screen. In the middle, a
**Pit** of four sandbag L corners (6 x 6 m inside, 2 m openings in the middle
of each side). Whoever holds it has cover from every side; the other player
has to come at it across open ground (29 % of pairs see each other), or throw
a grenade: the 3.5 m blast covers almost the whole pit.

- **Tower** (screen top, x = z = -8): a 3 x 3 m container. **Barrels** (screen
  bottom, x = z = 7): a 2 x 2 m barrel stack.
- Approach cover about a dash apart on both sides: crates, a barrier and a
  sandbag line each.
- **Shelters**: a container and a sandbag wall around each pair of spawns
  (far left and far right of the screen).

### Scrapyard: looks lopsided, isn't

A junkyard at sunset, 34 x 30 m. The collision is point-symmetric, but each
half is dressed differently (12 twin pairs wear different props: the
**Crusher** container at the top right is a crate pile at the bottom left,
barrels become crates, sandbags become barriers). The layout is irregular on
purpose: no straight lanes, piles of different sizes.

- **Spine**: a staircase of junk from top right to bottom left through the
  centre (container, crate pile, barrels, then their twins), with 2 m gaps
  between the steps. It runs across the screen, so it splits the two
  players' halves.
- **Ruin**: an L of brick walls on the left edge (and its twin on the right)
  that keeps the two spawns of a side apart.
- Grenades: into the Ruin's corner, or through a Spine gap.

## Wiring plan

Order matters: shared first (the compiler then points at every caller).

### 1. `shared/src/arena.ts`

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

### 2. `shared/src/index.ts`

Add `export * from "./maps/index.ts";`. No name clashes: the maps module
exports `MapDef`, `Obstacle`, `ObstacleKind`, `Decor`, `DecorProp`,
`FLAT_DECOR`, `TALL_DECOR`, `MapTheme`, `WallStyle`, `WeaponTag`, `Symmetry`,
`Spawn`, `Reskin`, `AsciiLegend`, `MAPS`, `DEFAULT_MAP_ID`, `mapById`, `box`,
`symmetric`, `spawnPairs`, `mirrorPoint`, `mirrorBox`, `asciiPoint`.

### 3. `shared/src/physics.ts`

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

### 4. `shared/src/combat.ts`

- `stepPlayer(arena, prev, input, weaponId, canAct)`: pass `arena` to both
  `movePlayer` calls (dash and walk) and to `grenadeTarget`.
- `grenadeTarget(arena, x, z, gx, gz)`: clamp x to
  `arena.halfX - BULLET_RADIUS`, z to `arena.halfZ - BULLET_RADIUS`.
- Drop the `ARENA_HALF` import.

### 5. `server/src/state.ts`

Add to `DuelState`: `mapId: t.string().default(DEFAULT_MAP_ID)`.

### 6. `server/src/DuelRoom.ts`

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

### 7. `server/src/app.ts`

`createServer(options: { ...; mapId?: string })` and register the room with
`defineRoom(DuelRoom, options.mapId ? { mapId: options.mapId } : undefined)`
(Colyseus passes those default options to `onCreate`).

### 8. Client

- `client/src/net.ts` / `main.ts`: read `state.mapId` from every snapshot;
  `const map = mapById(state.mapId)`. When it differs from the current one
  (including the first snapshot), call `scene.setMap(map)` and give the map
  to the predictor and the bullet predictor. Clear predicted bullets on a
  change.
- `client/src/prediction.ts`: `Predictor` gets a `map: MapDef` field (set by
  main.ts), used in both `stepPlayer(this.map, ...)` calls.
- `client/src/bullets.ts`: same, `stepBullet(this.map, ...)`.
- `client/src/scene.ts`:
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
- `client/src/arenaView.ts`: `buildArena(group, props, map)` instead of the
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

### 9. Smoke test (`server/smoke.ts`)

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
- Add `"maps": "bun scripts/maps/validate.ts"` to the root `package.json`
  scripts and run it next to `smoke`.

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
- Respawn picks the spawn farthest from the opponent, ignoring line of sight.
  With the maps' mirrored pairs that is fine, but a "farthest spawn the
  opponent can't see" rule (the validator's `bodiesSee` is a ready-made
  check) would be safer on open maps.

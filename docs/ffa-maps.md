# Free-for-all maps

Three maps for the free-for-all mode (3-6 players, first to 15 kills or the
most kills after 6 minutes) and the team mode. They live in
`packages/shared/src/maps/ffa/`, apart from `MAPS`, so duel rooms never draw
them. Like the duel maps, none of them is mirrored: every quarter or side is
its own place, and the validator measures that the spawns and the two team
sides still get the same deal.

| Map | Size | Boxes | Plays like | Favours |
| --- | --- | --- | --- | --- |
| Crossroads | 60 x 60 | 69 | Two streets crossing at a clock tower: a walled garden, a market, a building site and a car park | rifle, sniper, shotgun |
| Freight | 62 x 52 | 81 | An open quay on the water under two cranes, a fenced container yard inland, a crane in the middle | sniper, rifle, SMG |
| Bastion | 60 x 60 | 69 | A broken keep, a ring to run round it, a rampart, and four fields each built its own way | rifle, shotgun, sniper |

## Tools

From `packages/shared`:

```sh
bun scripts/ffa/validate.ts [mapId...]           # checks + a table per map, exit 1 on any error
bun scripts/ffa/preview.ts [outDir] [mapId...]   # <id>-top.png, <id>-iso.png, all-ffa-maps.png
bunx tsc --noEmit -p scripts/ffa                 # type-checks the FFA tools (src/ is covered by -p .)
```

Suggested (not added, package.json was off limits): a `maps:ffa` script and a
second `tsc -p scripts/ffa` in `typecheck`.

The plan shows zones (tinted), the "sees" heat (red = floor that sees a lot
within 30 m), the best camping spot (red X), each spawn with its exposure,
the longest sightlines (yellow), every spawn's walk to the hub (dots) and the
landmarks.

## Map notes

Coordinates as in docs/maps.md: `x` right, `z` down on the plans, "top" is
-z, and the top-left corner of the plan is the top of the screen.

### Crossroads: a town square

A shelled town at morning where two streets cross at a small square. Each
quarter between the streets is its own place, and so is each street.

- **Square** (|x|, |z| < 9): the **Clock Tower** in a pinwheel of four
  offset flower beds, so nobody sees the middle from a street mouth.
- **Walled Garden** (NW): a brick wall with four gates round hedges and a
  **Gazebo**. Closed, middle-range fights.
- **Market** (SW): a dense grid of stalls with 2 m aisles. The shotgun and
  SMG ground.
- **Building Site** (NE): a barrier fence, closed toward the Square, round a
  half-built brick shell, the tall **Site Office** and stacks of material.
  Mixed.
- **Car Park** (SE): a big open lot with a few parked cars, open to the East
  Road. The rifle and sniper ground.
- **Streets**: the North Road is a wide boulevard with jersey barriers down
  the middle; the West Lane has a broken wall down the middle; the East Road
  opens into the Car Park; the South Street is lined with the market's
  overflow stalls. The longest sightline (67 m) runs along them.
- **Teams**: West (spawns 0-7: the Garden and the Market, the closed side)
  against East (8-15: the Site and the Car Park, the open side). The spawns
  are placed so both sides are as exposed, as close to cover and as far from
  the Square: mean distance to the hub 25.6 against 26.5 m, territory 49
  against 51 %, every camera measure within 0.5 pp. No West spawn sees an
  East spawn: the Market's south-east spawn sits at (-12, 24), a step back
  behind the South Street stalls, so it doesn't look along the south wall at
  the Car Park's spawn at (20, 28).

### Freight: the port

A cargo port at dusk. The two halves are different places.

- **North Quay** (the water is the north wall): a long, open strip along the
  screen's X, the sniper lane. Two gantry cranes (**Crane One**, **Crane
  Two**) stand over it, legs on the water's edge and on the landside rail;
  the only tall cargo sits flush against the water, so nothing tall stands
  between the quay and the camera. Behind the rail: the low brick **Harbour
  Office** (NW), an **Apron** of loose cargo, and two **Reefers** standing
  end-on (NE).
- **Container Yard** (the land side, south): dense and closed, behind a
  barrier fence with five gates, each masked by a crate stack so you can't
  see straight through. West of the middle, container rows and crate stacks
  run along X (the **Container Stacks**); east of it, containers stand in
  columns along Z with the **Truck Bays** between them. The **Gate Road**
  runs along the south wall, with the **Gatehouse** at its west end.
- **Boulevard** (|z| < 7) across the whole port, with the yard **Crane** in
  the middle (four legs round a hanging container): the hub.
- **Teams**: North Quay (even spawns) against Container Yard (odd spawns).
  The quay is open and its spawns sit at its edges; the yard is closed and
  some of its spawns sit in front of the fence to make up for it. The camera
  looks from the +x/+z corner, so tall boxes on the quay stand against the
  water or end-on, and the yard's containers face the hub with their +z
  side. Margins are thin here: exposure 7.9 against 6.9 %, walk to the hub
  24.1 against 25.1 m, territory 52 against 48 %.

### Bastion: the ring round the keep

A hill fort at noon.

- **Keep** (about -8..6 on x, -6..7 on z): an irregular brick hall with
  five doors round a crate **Vault**, its north-east corner knocked in onto
  a small barrel yard, the **Breach**. The shotgun room, and a grenade trap.
- **Ring**: a corridor round the Keep you can run round forever, wider on
  the north where the Breach is. A chased player can always go round.
- **Rampart** (about 12-14 m out): sandbags on the north and south,
  concrete barriers on the east and west, each side with its own uneven
  gates, and a jutting **Outwork** at the north-west corner.
- **Fields** (out to 30 m), each built differently:
  - North, the **Trenches**: long staggered sandbag lines and a container
    bunker in the north-west corner (rifle cover).
  - West, the **Supply Dump**: four tall containers you weave between, and a
    sandbag nest in the south-west.
  - East, the **Checkpoint**: a few long concrete barriers on open ground and
    a crate tower in the north-east. The sniper field.
  - South, the **Fuel Depot**: a dense patch of barrels and crate stacks,
    with a big pile in the south-east.
- **Teams**: West (spawns 0-3 and 12-15: Trenches and Supply Dump) against
  East (4-11: Checkpoint and Fuel Depot). The Supply Dump's containers throw
  more camera shadow; the East side answers with crate stacks, which are
  also over 1.2 m (tall-box shadow 2.9 against 1.7 %). No West spawn sees an
  East one. That took three East spawns tucked in: the NE Tower's corner
  spawn at (24.5, -26.5) and the one by its crates at (13.5, -16) no longer
  look down the Trenches, and the SE Stacks spawn at (25, 23) no longer sees
  across the Fuel Depot to the south-west.

## What FfaMapDef adds

`packages/shared/src/maps/ffa/index.ts`. `FfaMapDef extends MapDef`, so
physics, sight and `buildArena` take these maps as they are.

```ts
interface FfaMapDef extends MapDef {
  mode: "ffa";
  players: { min: number; max: number };   // 3..6 on all three
  zones: readonly FfaZone[];               // { id, name, x0, z0, x1, z1, tint } rectangles
  landmarks: readonly FfaLandmark[];       // { name, x, z }
  hub: Spawn;                              // the contested centre (0, 0 on all three)
}
```

- `zones`: named rectangles (they may overlap; the first match wins). They're
  for callouts, a minimap (tint = the zone's main prop colour) and the
  previews.
- `landmarks`: what to label on a minimap or in a kill feed ("killed near
  the Crane").
- `hub`: where players drift when they don't know where anyone is. The
  validator's first-contact model walks everyone there.
- `spawns`: 16 per map, **not** in pairs (the MapDef comment about
  `spawns[2k + 1]` is for duels). Balance is measured (spawn spread and team
  balance, below), not built in by mirroring.
- `royale` (optional, on any MapDef): the battle royale's crate spots and
  the rectangle its zone may close on (`RoyaleMapData` in `maps/types.ts`).
  No FFA map has it: the royale pool (`ROYALE_MAPS`) is Ironvale alone, a
  map of its own in `maps/royale/` (see docs/royale-maps.md). Bastion was
  the test bed while the mode was built (#32) and lost its crate spots once
  Ironvale landed.
- `decor` is empty for now. The zone looks come from the obstacle kinds; a
  flat-decor pass (papers in the Square, pallets on the quays, tyres and
  cones outside the walls) can come after playtesting.

Helpers in the same file:

- `FFA_MAPS`, `ffaMapById(id)` (falls back to Crossroads).
- `ffaRespawnPoint(arena, spawns, opponents, rand?)`: the respawn rule for N
  opponents.
  1. First, spawns no living opponent can see (`bodiesSee`) and that are at
     least 10 m (`FFA_SPAWN_NEAR`) from all of them.
  2. Then spawns that are hidden but nearer.
  3. Then spawns that are seen.
  4. Within each group, the one whose nearest opponent is farthest, capped at
     22 m (`FFA_SPAWN_FAR`). Ties are broken by `rand`.

  The cap matters: on a 60 m map, "the farthest spawn" is always the same
  corner, far from the fight.
- `ffaStartSpawns(arena, spawns, n, rand?)`: match start. The first spawn is
  random. Each next one is a spawn nobody placed so far can see, with the
  farthest nearest-player (uncapped), picked at random among those within
  3 m of the best.

## Validator

`scripts/ffa/validate.ts`, using `scripts/ffa/analyze.ts`, which imports the
duel geometry (`standable`, walk grid, flood fill, gaps, shortest path,
camera occlusion, `bodiesSee`/`clearShot`).

- **Kept from the duel checks**: bounds, box thickness and height (0.8-2.0 m),
  gaps under 1.6 m, spawn overlap, tall decor inside, flood-fill
  reachability, and cam-hidden floor.
- **Changed**: size is 50..64 m. The long-wall rule is "a box under 1.5 m
  thick and 4 m or longer must be 1.1-1.4 m tall", so the 2 m deep container
  rows (Dockside-style) may be 1.8 m.
- **New**:
  - **Box budget**: 90 at most.
  - **Spawn spread**: at least 16 spawns, at least 8 m apart, every standable
    point within 20 m of one (the hub is kept free of spawns on purpose), and
    even quadrants.
  - **Spawn balance**: exposure is the share of the floor with a clear shot
    at the spawn within 30 m. The max must be 15 % or less, and max / min must
    be 3 or less (min floored at 2 %). Nearest cover must be within 3 m, with
    a max / min ratio of 3 or less.
  - **Spawn sightlines**: two spawns less than 20 m apart must not see each
    other.
  - **No camping spot**: no standable point may see more than **25 %** of the
    floor within 30 m. Why 25 %: with 6 players spread out, a camper there has
    on average 5 x 0.25 = 1.25 opponents in view, a fair fight. At a third
    they have 1.7, often 2 or more, and the spot becomes a place to farm third
    parties from.
  - **Mixed ranges**: at least 10 % of the floor is "tight" (sees less than
    250 m² within 30 m), and at least 10 % is "open" (sees 150 m² or more at
    18-30 m, which only the sniper reaches).
  - **First contact**: 300 seeded match starts per player count, placed with
    `ffaStartSpawns`. Everyone walks the shortest path to the hub at full
    speed; contact is the first clear centre-line shot between two players
    within 20 m (on screen, in rifle range). For 4 players the median must be
    3..8 s and the p90 10 s or less; 3 and 6 players are reported.
  - **Respawns**: 1500 draws of 5 opponents on random floor. At least 95 %
    must find a spawn none of them sees.
  - **Longest sightline**: reported, with a warning over 45 m.
  - **Not mirrored**: the duel validator's mirror check (`mirrorCheck` in
    `scripts/analyze.ts`): at most 45 % of the box footprint may have a
    twin under any one mirror. The three maps sit at 26-31 %.
  - **Spawn spread** (`SPREAD` in `scripts/ffa/analyze.ts`): every spawn
    within max(abs, rel x median) of the 16 spawns' median. One-sided for
    exposure (+5 pp or +80 %), nearest cover (+1.5 m), walk to the hub
    (+8 m or +55 %) and cover spots against the hub within 10 m walk (-6 m²
    or -60 %); two-sided for the camera, within 10 m walk: chest hidden
    (+-3 pp) and waist hidden by a box over 1.2 m (+-5 pp).
  - **No enemies in sight at the start**: no spawn on one side may see a
    spawn on the other, at any distance. The server picks each team's starts
    on its own side without looking at the other team, so a single pair in
    sight could open a match with enemies face to face. Distance is no
    excuse: a pair out of range is a few steps from being in range. All
    three maps have none.
  - **Team balance** (`BALANCE` in `scripts/ffa/teams.ts`), red vs blue, on
    top of the hub-distance rules: mean exposure (1.5 pp or 15 %), mean
    nearest cover (0.5 m), mean walk to the hub (1.5 m or 5 %), mean
    cam-hidden floor near the spawns (1.5 pp), territory split by walking
    distance (6 pp), cam-hidden territory (1.5 pp), tall-box shadow in the
    territory (2 pp), cam-hidden cover spots against the hub (8 pp).

Results:

```
map         size   boxes  camp   exp ratio  contact med/p90  longest  hidden resp  worst gap                      teams  result
crossroads  60x60  69     24.2%  2.50       3.47 / 4.00 s    67.2 m   100.0%       85% spawn 12 exposure          ok     ok
freight     62x52  81     24.4%  2.79       3.53 / 3.93 s    61.7 m   100.0%       92% spawn 1 tall shadow near   ok     ok
bastion     60x60  69     20.1%  2.56       3.67 / 3.87 s    61.1 m   100.0%       91% spawn 12 tall shadow near  ok     ok
```

`worst gap` is the spawn-spread or team-balance measure closest to failing,
as a share of what it is allowed (over 100 % fails). All three are close to
their limits (85-92 %), Freight the most: move a spawn or a tall box there
and rerun the validator.

| | Crossroads | Freight | Bastion |
| --- | --- | --- | --- |
| spawn exposure | 4.1-10.3 % | 4.1-11.4 % | 5.3-13.5 % |
| nearest cover | 1.0-2.0 m | 1.0-2.2 m | 1.1-3.0 m |
| tight / open floor | 46 / 14 % | 46 / 10 % | 19 / 12 % |
| first contact, 3 / 6 players (median) | 4.0 / 0.9 s | 3.9 / 0.5 s | 4.0 / 1.6 s |
| respawn to nearest opponent (median) | 27 m | 26 m | 26 m |
| cam-hidden floor | 0.1 % | 1.4 % | 0.3 % |
| mirrored box footprint (worst mirror) | 31 % | 30 % | 26 % |

Accepted warnings: the longest sightline is over 45 m on all three (the
Crossroads streets, the Freight quay and boulevard, the Bastion field
diagonals). Those are the sniper lanes, and past 30 m nothing can shoot
anyway.

How to read the contact numbers: the model is pessimistic about speed.
Everyone rushes the centre and the first sight counts. With 6 players, the
start spreads them less (16 spawns for 6 people), so contact comes in under
1.5 s (0.5 s on Freight); fine for 6, where someone is always fighting.

## Performance

- **Boxes**: 69-81 per map, against 7-28 on duel maps. `movePlayer` and
  `bulletBlocked` loop over every box. With 6 players and about 30 live
  bullets at 4 sub-steps, that is about 10k box tests per tick. That's cheap,
  and a spatial grid can wait.
- **Draws**: arenaView bakes all the solid props into merged meshes per
  material, so the number of draw calls stays at about one per prop material
  (six kinds, plus the walls and decor), whatever the box count. What grows is
  vertices: a wall tiles its prop along its length, a crate box is a grid of
  crates. The biggest cost is the outer wall, which is 240 m of tiles instead
  of about 130 m. Worth a look in the profiler at 60 m, but it shouldn't be a
  problem.
- **Shadows**: scene.ts sizes the sun's shadow camera to
  `max(halfX, halfZ) + 3`, so 34 m here against 23 m on the biggest duel map.
  The same shadow map covers twice the area, and shadows get softer and more
  jagged. Either raise `shadow.mapSize` for FFA maps or (better) make the
  shadow frustum follow the local player (about 25 m across, the visible area).

## Wiring plan for the FFA mode

Shared first, as for the duel maps.

### 1. Shared

- `src/index.ts`: `export * from "./maps/ffa/index.ts";`. It exports
  `FfaMapDef`, `FfaZone`, `FfaLandmark`, `FFA_MAPS`, `ffaMapById`,
  `ffaRespawnPoint`, `ffaStartSpawns`, `FFA_SPAWN_FAR`, `FFA_SPAWN_NEAR`, with
  no clashes.
- **Trap: map lookup by id.** The client builds the arena with
  `mapById(state.mapId)`, which falls back to Yard for an unknown id. An FFA
  room would silently render and predict Yard. Add
  `anyMapById(id) = ffaMapById-or-mapById` (or make `mapById` search both
  lists) and use it wherever `state.mapId` is resolved. Do **not** put the FFA
  maps into `MAPS`: `DuelRoom.pickMap` draws from it, and the duel validator
  would reject their size.
- `constants.ts`: `FFA_ROOM_NAME = "ffa"`, `FFA_MAX_PLAYERS = 6`,
  `FFA_MIN_PLAYERS = 3`, `FFA_KILLS_TO_WIN = 15`, `FFA_TIME_LIMIT = 360`
  (seconds). Keep `RESPAWN_DELAY` (2 s) or go to 3 s for FFA; with more
  players, instant respawns feel spammy.
- `protocol.ts`: players already carry `kills`. Add `deaths`, a match
  `timeLeft` (in ticks, or an end tick), and a small kill-feed event
  `{ killer, victim, weapon }`.

### 2. Server: an `FfaRoom`

Reuse DuelRoom's simulation (`applyInput`, `stepBullets`, damage). The
cleanest route is to pull the tick loop into a base class, or into functions
both rooms call, and keep only the match rules per room.

- `maxClients = FFA_MAX_PLAYERS`. The map comes from `FFA_MAPS`, with the
  same `pickMap` (random, never the one just played) and the same pinning /
  dev `?map=` handling, but against `FFA_MAPS`.
- **Start**: once `FFA_MIN_PLAYERS` are in (or 2 players after a 20 s wait,
  so nobody waits forever), a 3 s countdown, then
  `ffaStartSpawns(map, map.spawns, n)`. Face the hub:
  `aim = atan2(hub.z - s.z, hub.x - s.x)`.
- **Late join** while playing: allowed until 60 s are left. The joiner
  spawns with `ffaRespawnPoint(map, map.spawns, livingOthers)`.
- **Respawn** after `RESPAWN_DELAY`:
  `ffaRespawnPoint(map, map.spawns, livingOpponents)`. Pass everyone alive
  except the player (dead players don't count, their bodies aren't there).
  The room may use `Math.random`; tests pass a seeded `rand`.
- **Kills and the end**: credit the last player who damaged the victim
  within 5 s, so dying to your own grenade after someone hit you still gives
  them the kill. A pure self-kill costs the player one kill. The match ends at `FFA_KILLS_TO_WIN` or when the timer
  runs out. The winner has the most kills, ties go to fewer deaths, and a tie
  on both is a shared win. Then `MATCH_END_DELAY` and a new map.
- **What the room needs from a map**: `spawns` (16 or more), `hub` (initial
  aim, and bots later), `players.min/max` (clamp the start threshold and
  `maxClients` per map if they ever differ), and `obstacles/halfX/halfZ` as
  today. `zones` and `landmarks` are client-only, except the kill feed may
  name the victim's zone.

### 3. Client

- Resolve `state.mapId` with the unified lookup above. Everything else in
  `switchMap` works as is.
- **HUD**: timer, your kills and your place ("3rd, 7 kills"), the top 3,
  and a kill feed (the last 4 kills, with the zone name:
  "A killed B at the Crane").
- **Finding each other.** On a 60 m map the others are off screen most of
  the time. I recommend **a minimap with shot pings**, and nothing more to
  start with:
  - a 140 px square in a corner, drawn from `zones` (tints) and `landmarks`
    (labels), with the obstacles as dark rectangles. It is the same data the
    preview draws, so it takes about 60 lines of canvas code;
  - your own position and facing;
  - **enemies appear only when they fire**, as a dot that fades over 1.5 s.
    Staying quiet keeps you hidden, noise draws a crowd. That is exactly the
    third-party dynamic the maps are built for, and it makes the hub fights
    visible from anywhere;
  - no permanent enemy dots: they would kill flanking and the loops.

  Second choice, and cheap to add later: an **edge-of-screen arrow toward
  whoever last damaged you** (2 s). It answers "where is that coming from?",
  which the minimap pings only answer if you look down. Both read from data
  the client already has: remote players' positions in the snapshots, and
  their ammo count going down (the same signal as the muzzle flash).
- **Camera** (optional): leaning the camera about 4 m toward the aim
  direction would help the sniper on the long lanes, as docs/maps.md already
  suggests.

### 4. Tests

- Smoke: an `ffa` room pinned to Crossroads, with 3 clients. Check the synced
  `mapId`, that players spawn on distinct spawns out of each other's sight,
  a kill, then a respawn out of sight of the other two, then the match end at
  `FFA_KILLS_TO_WIN`.
- `bun scripts/ffa/validate.ts` next to `maps:validate`.

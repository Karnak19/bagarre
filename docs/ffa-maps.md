# Free-for-all maps

Three maps for a free-for-all mode (3-6 players, first to 15 kills or the
most kills after 6 minutes). They live in `packages/shared/src/maps/ffa/` and
nothing uses them yet: the mode is wired later, following the plan at the
end of this file. They are not in `MAPS`, so duel rooms never draw them.

| Map | Size | Boxes | Plays like | Favours |
| --- | --- | --- | --- | --- |
| Crossroads | 60 x 60 | 69 | A wide town square round a clock tower, ruined quarters and an alley all round | rifle, sniper, shotgun |
| Freight | 62 x 52 | 73 | A cargo pier: open quays along the water, container rows, a warehouse, a crane in the middle | sniper, rifle, SMG |
| Bastion | 60 x 60 | 57 | A keep in the middle, an empty ring to run round it, a broken rampart, open fields | rifle, shotgun, sniper |

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

A shelled town at morning where two roads cross. One quarter is authored and
rotated four times, so the four quarters play the same but each wears its own
props. That is the only way to tell them apart at a glance, so keep it that
way when editing.

- **Square** (|x|, |z| < 9, open to the roads): the **Clock Tower** (a 3 x 3
  container) in the middle, a crate stall at each corner and a sandbag line
  at each road mouth. The open ground: the rifle and sniper fight here.
- **Roads** (4.5 m either side of the axes): four straight lanes from the
  Square to the town wall, with nothing in them. Each one is a 60 m sniper
  lane across the Square, so crossing a road is the risky move. The longest
  sightlines (61-63 m) are the diagonals along them.
- **Quarters**, each a ruined **Chapel** (four walls, three gaps, an altar)
  plus two long **row houses** (two offset walls, a hall you run through) along
  its roads. The shotgun and SMG ground: 37 % of the floor sees less than
  250 m².
  - NW **Chapel**: brick and crates.
  - NE **Depot**: concrete barriers and containers.
  - SE **Barracks**: sandbags and fuel barrels.
  - SW **Market**: concrete barriers and crate stalls.
- **Alley** (the outer 5 m): a loop round the whole town, broken by two crate
  piles per side so it is never a 60 m lane.
- **Loops**: the alley, the Square, and the lanes between the chapel and the
  row houses, which join the alley to the Square's corners. From anywhere
  there are at least two ways out.
- **Spawns**: 4 per quarter (the road by a row house, the alley between the
  crates, the alley corner, inside the chapel).

### Freight: the port

A cargo pier at dusk, water on both long sides. The collision is
point-symmetric; the second half is dressed differently.

- **Quays** (the outer 7 m on the north and south edges): long, mostly open
  lanes along world X (which stays on screen longer), with cargo against the
  water's edge. The sniper lanes.
- **Container Yard** (NW) and its twin, the **Crate Stacks** (SE): three
  staggered rows of 2 m deep stacks (1.8 m tall) with 2 m aisles. A maze for
  the SMG. Crossing an aisle is exposed along its whole length.
- **Warehouse** (NE): a brick shell with five doors round three crate
  stacks, for close fights. Its twin is the sandbagged **Fuel Depot** (SW),
  with barrels.
- **Truck Lanes** (between the Yard and the Warehouse, and their twins): a
  barrier and a crate each, the link from the quay to the middle.
- **Boulevard** (|z| < 7, the full width) with the **Crane** in the middle: four
  container legs round a crate pallet, the landmark and the hub. Islands
  (crates, sandbags, barriers, barrels) about a dash apart along it.
- **Loops**: quay, truck lane, boulevard, and back through the Yard or the
  Warehouse; or all the way round the pier.

### Bastion: the ring round the keep

A hill fort at noon. One quarter is authored and rotated four times. The Keep
stays brick; the outer works change props per quarter (north: sandbags and
crates, east: concrete, south: fuel barrels, west: barriers and containers).

- **Keep** (|x|, |z| < 7): brick walls with four doors in a pinwheel (you
  can't see through), round the crate **Vault**. The shotgun room, and a
  grenade trap.
- **Ring** (7..12): a 5 m corridor round the Keep with a small crate in each
  corner. The loop: a chased player can always go round.
- **Rampart** (12..13): sandbags or barriers with two gates per side, offset
  so no gate lines up with a Keep door.
- **Field** (13..30): open ground with trench lines, crate piles, barrels
  and a container **Bunker** in each corner. The rifle and sniper ground: 54 %
  of the floor has a long view.
- **Spawns**: 4 per quarter (behind the trench line, by the barrels off the
  rampart corner, in the bunker's corner, in the Ring by a Keep door).

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
- `spawns`: 16 per map, **not** in mirrored pairs (the MapDef comment about
  `spawns[2k + 1]` is for duels). `symmetry` is `"point"` on all three, which
  is true (a four-fold rotation includes the half turn), but nothing relies
  on it.
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
  rows (Dockside-style) may be 1.8 m. There is no symmetry check.
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

Results:

```
map         size   boxes  camp   exp ratio  contact med/p90  longest  hidden resp  result
crossroads  60x60  69     21.7%  2.52       4.47 / 4.47 s    63.3 m   100.0%       ok
freight     62x52  73     24.1%  2.71       3.67 / 3.93 s    61.1 m   100.0%       ok
bastion     60x60  57     22.5%  1.51       3.67 / 4.00 s    61.5 m   100.0%       ok
```

| | Crossroads | Freight | Bastion |
| --- | --- | --- | --- |
| spawn exposure | 4.7-11.9 % | 4.2-11.4 % | 7.9-11.9 % |
| nearest cover | 1.0-1.6 m | 1.0-2.0 m | 1.0-2.2 m |
| tight / open floor | 37 / 11 % | 31 / 14 % | 13 / 54 % |
| first contact, 3 / 6 players (median) | 4.5 / 1.9 s | 3.9 / 2.1 s | 4.0 / 1.2 s |
| respawn to nearest opponent (median) | 27 m | 27 m | 26 m |
| cam-hidden floor | 0.1 % | 1.8 % | 0.3 % |

Accepted warnings: the longest sightline is over 45 m on all three (the
Crossroads roads, the Freight quays and boulevard, the Bastion field
diagonals). Those are the sniper lanes, and past 30 m nothing can shoot
anyway.

How to read the contact numbers: the model is pessimistic about speed.
Everyone rushes the centre and the first sight counts. With 6 players, the
start spreads them less (16 spawns for 6 people), so contact comes in 1-2 s;
that seems right for 6.

## Performance

- **Boxes**: 57-73 per map, against 7-28 on duel maps. `movePlayer` and
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

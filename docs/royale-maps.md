# Battle royale maps

One map for the battle royale mode (up to 10 players, one life, chests to
loot, a zone that closes on a final circle; the rules are in the README's
battle royale section). It lives in `packages/shared/src/maps/royale/`,
and `ROYALE_MAPS` there is the mode's pool (`ROYALE_RULES.maps`): Ironvale
alone, so every royale match plays on it. It is apart from `MAPS`,
`FFA_MAPS` and `TEAM_MAPS`, so duel, FFA and team rooms never draw it, and
`ffaMapById` never falls back to it. `findMap` finds it (a synced `mapId`
resolves), and it is on the Maps page, in its own "Battle royale" section
with a "Royale" tag.

One royale map and no random pick is the scope of #33. Bastion carried
crate spots and zone limits while the mode was built (#32); they are gone,
so it is an FFA and team map only and the royale pool can't pick it.

| Map | Size | Boxes | Starts | Crates | Plays like | Favours |
| --- | --- | --- | --- | --- | --- | --- |
| Ironvale | 150 x 150 | 366 | 26 | 48 | A mining town in the snow: a walled shaft tower in the middle, an open ring road, the pit works halfway out, the old town's cluttered districts against the walls, open snow between | rifle, sniper, SMG |

## Tools

From `packages/shared`:

```sh
bun test src/maps/royale                          # the layout tests below (also part of `bun run test`)
bun test src/royale.test.ts                       # the mode's rules, and the pool's crate spots and zone (also in `bun run test`)
bun scripts/royale-maps.ts                        # the stats table under "Results"
bun scripts/royale.preview.ts [outDir] [mapId...]  # <id>-top.png and <id>-iso.png (default .previews/royale-maps/)
```

The plan shows the districts, the boxes with their heights, the start spots
(numbered), the crate spots (yellow), the final zone's rectangle (blue
dashes), the tight floor (violet) and, for each possible final centre, how
many boxes the zone holds 30 s before it closes there (red under 2).

## What RoyaleMapDef adds

`packages/shared/src/maps/royale/index.ts`. `RoyaleMapDef extends MapDef`
with `mode: "royale"`, `players`, `zones`, `landmarks` and `hub` (the FFA
shapes), and:

- `spawns`: the start spots. Nobody respawns, so they are about fair
  starts: no two in sight of each other, at any distance.
- `royale` (`RoyaleMapData` in `maps/types.ts`, optional on a MapDef and
  required here): `crates`, the crate spots, and `zone`, the rectangle the
  zone's final centre is drawn in (`pickZone` in `src/royale.ts`, from the
  match id). The server stands a closed chest on every spot at the start
  (`GameRoom`, `floor.reset`) and aims the starts toward `hub`
  (`ffaStartSpawns` spreads the players over `spawns`).

## Checks

Two test files run on every map in `ROYALE_MAPS`, both part of `bun run test`.
`src/royale.test.ts` (from #32) checks the mode's rules and, for the
maps, that the crates stand on open floor (the crate's radius plus the
player's, 1.1 m, clear of every box), inside the walls, and at least 3 m
from every spawn, and that the zone closes inside `royale.zone`.
`src/maps/royale/royale-maps.test.ts` checks the layout, using the duel validator's
geometry (`scripts/analyze.ts`):

1. Size 80..160 m a side. Boxes 0.8-2.0 m tall; a box under 1.5 m thick and
   4 m or longer is 1.1-1.4 m tall. No gap between boxes (or a box and the
   outer wall) under 1.6 m unless they touch.
2. At least 10 start spots. Every start spot clear of every box by the
   player radius plus 0.25 m, every crate spot by 1.1 m (royale.test.ts's
   rule), and inside the walls.
3. No two start spots see each other (`bodiesSee`, all pairs).
4. 15-60 crate spots, none within 3 m of a start (royale.test.ts's rule),
   none within 1.5 m of another.
5. Flood fill (0.2 m grid) from start 0 reaches every start and crate, and
   the whole floor is one connected region, so any open part of the circle
   can be walked into.
6. The final zone rectangle is at least 12 m from every edge.
7. Endgame cover: for every final centre on a 1 m grid inside the
   rectangle, the real zone `LATE_SECONDS` (30 s) before it closes there
   (`lateCircle`: `pickZone`'s circles through `zoneAt`) holds at least 2
   boxes and at least 50 % floor a player can stand on. The zone shrinks
   linearly from about 108 m on Ironvale (the map's half-diagonal plus 2 m)
   to nothing over 360 s (`ZONE`: 45 s wait, closed at 6:45), about 0.3 m/s
   (royale.test.ts keeps it at most 0.35 m/s, walking is 6), while its
   centre slides from the middle to the final one. 30 s before the end its
   radius is 9 m (18 m wide: the issue's "last 10 to 15 m" and a little
   more), centred 11/12 of the way to the final centre; that is the last
   circle two or three players still move and fight in (20 s before, 6 m,
   it is a shootout at arm's length).
8. Tall decor (the trees) stands outside the walls and hides no floor from
   the camera. The camera looks down (-1, -1, -1) from the +x / +z side, so
   a tree just outside the +x or +z wall stands between it and the floor
   near that wall: a 7 m pine there hides a strip about 7 m deep. Each tree
   is modelled as a column (the largest pine or dead tree of the pack, times
   its scale) and run through the duel validator's `hiddenFromCamera` for
   every floor cell.

`bun scripts/royale-maps.ts` (the endgame and sight helpers the tests and
the preview share) prints each map's stats, among them, without a limit,
the tight and open floor shares as the
FFA validator defines them (`ffaSight` in `scripts/ffa/analyze.ts`): tight
floor sees less than 250 m² within 30 m (shotgun and SMG ground), open floor
sees at least 150 m² beyond 18 m (sniper lanes). Samples every 2 m (1 m
takes about 25 s on a 90 m map and differs by 0.1 pp), which is nearly all
of the script's minute on the 150 m map. The tests skip it and take about a
second.

Results:

```
map        size   boxes  starts  crates  min start gap  worst endgame circle           tight  open   time
ironvale   150x150 366    26      48      20.8 m         (-30, -30) 2 boxes 95% floor   7.6%   87.9%  60.2 s
```

The worst endgame circle is the zone closing on (-30, -30), the ring's
north-west corner: two boxes, the least cover. On the 90 m map (228 boxes,
14 starts, 23 crates) it was 30.9 % tight and 28.1 % open, the worst circle
(-2, 5) in the Headframe compound. The 150 m map kept every district's
lanes as they were (moved, not scaled), so the dense districts are as tight
as before; the tight share fell because the new floor is mostly open snow
and the lighter pit works, on purpose (room to travel and loot before the
fights). The open share is high for the same reason: the snow between the
belts is long sight lines.

On the 90 m map, the first version (149 boxes, an even scatter round the middle) was 13 %
tight and 74 % open. The ring road and the Checkpoint are more than half the
floor and stay open on purpose (about 2-8 % tight), so the tight share comes
from the districts, the Headframe compound and the four ring yards. Ironvale
keeps a player's chest hidden from the camera on 1.0 % of the floor (the
duel maps sit at 0-2.9 %).

## Ironvale: the mining town

An abandoned mining town under an overcast winter sky: pale blue-white
snow, a cold low sun. 150 m a side (90 m until the first play tests: a
7-player match was over in about 30 s, everyone met at once). Coordinates
as in docs/maps.md, north is -z.

Plan, metres from the centre: the Headframe compound to 9, the Ring Road to
about 31, open snow to 35, the pit works from 35 to about 53, open snow to
57, the old town from 57 to the walls at 75.

- **Headframe** (|x|, |z| < 9): the mine shaft tower, a 5 x 5 m container
  (1.9 m), in a brick compound with four doors in a pinwheel (none on a
  road axis). Crate stacks and barrels against the inside walls leave a ring
  of 3.5 m lanes round the tower. Four crates sit in those lanes: the
  reason to go in early.
- **Roads**: four clear 9 m lanes (|x| or |z| < 4.5) from the compound to
  the edge, with cover only along their edges (barriers and crates in the
  ring and the pit works, wagons and crates in the Rail Sidings, huts in
  Workers' Row).
- **Ring Road** (about 9-31 m out): open ground round four small brick
  yards, one per quarter at (±19, ±19) (9 x 9 m, two 2.5 m doors in
  opposite corners, a crate stack inside), and a crate on each road where
  it leaves the ring. They are what gives every final circle cover.
- **The pit works** (35-53 m out): four districts on the diagonals, built
  the same way as the old town (2-3 m lanes), and lighter outskirts by the
  roads:
  - North-west, **Sawmill**: three rows of lumber stacks (crates) along x,
    2.5 m lanes, each row broken once (staggered), and the saw house.
  - North-east, **Freight Depot**: tall shipping containers (1.9 m) in
    three staggered rows.
  - South-east, **Pithead Baths**: a 14 x 12 m brick building, a door in
    each side, a partition with a doorway: lockers in the west room, the
    boiler (a tank) in the east one.
  - South-west, **Tank Farm**: three lines of lying tanks along z, each
    broken once, and gas tank clusters.
  - North road, **Dugouts**: four U-shaped sandbag posts, open to the south.
  - East road, **Truck Stop**: parked trucks (dumpsters) in two lots.
  - South road, **Spoil Tips**: loose boulders.
  - West road, **Powder Store**: two brick magazines with gas tanks round
    them.
- **The old town** (57-75 m out, against the walls): the eight districts of
  the 90 m map, each moved out as one piece (30 m along x and/or z, nothing
  scaled, so their lanes are the same). Five are dense, with 2-3 m lanes:
  - North, **Rail Sidings**: three lines of container wagons along x; the
    ones nearest the middle line the north road. Crates span the strips
    between the lines every few wagons, and crates between line A and the
    wall close that lane into pockets.
  - South-east, **Slag Heaps**: a staggered maze of crate stacks and barrel
    piles, 2-2.5 m lanes.
  - South-west, **Fuel Yard**: two tanks and packed barrel clusters.
  - North-west, **Quarry Camp**: an L of sandbag trenches, more trench
    lines, two bunkers and cut stone.
  - South, **Workers' Row**: two rows of brick huts with 2.5 m lanes; the
    front row's inner huts line the south road; carts across the lane
    between the rows. The back huts that open north keep a crate, the two
    that open south onto the wall keep a start.
  - The other three are built up but less tight:
  - North-east, **Engine Shed**: a 14 x 10 m brick shed with three doors
    round a locomotive, spares in its corners, a coal pile by the south
    door. Two safe crates inside.
  - East, **Main Street**: eight brick houses either side of a north-south
    street, carts parked against the houses on alternating sides so the
    street zigzags, barrels in two houses and junk in the yards.
  - West, **Checkpoint**: a barrier chicane across the west road and two
    guard huts. Kept open.
- **The Outskirts**: the open snow between the old districts along the
  walls (north, south, east and west), two lone miner's huts in each, door
  to the wall and a start inside, two boulders beside each hut.
- **Props** (see ASSETS.md): snowy rocks (`rock`) in the Quarry Camp, the
  Slag Heaps, the Spoil Tips and the Outskirts, dumpsters (`dumpster`) in
  the Main Street yards, Workers' Row alleys and the Truck Stop, long
  containers (`wagon`) for the rail wagons, full-size sandbags (`trench`)
  for the Quarry Camp and Checkpoint trenches, gas tanks (`gastank`) and
  lying water tanks (`tank`) in the Fuel Yard, the Engine Shed, the Tank
  Farm, the Pithead Baths and the Powder Store.
- **Trees**: 52 snowy pines and dead trees (scale 2-2.2) outside the walls:
  20 along the north wall and 16 along the west wall, 5-10 m out (the top
  of the screen, where nothing they cover is floor), and 8 each 15 m out
  beyond the south and east walls (far enough that their tops clear the
  arena, check 8).
- **Starts**: 26, all in the old town, the pit works and the Outskirts,
  none on the Ring Road; each tucked in a building or a pocket. The closest
  two are 20.8 m apart, and `ffaStartSpawns` spreads up to 10 players over
  them, farthest first.
- **Final zone**: centres within |x|, |z| <= 30, the whole ring; no district.
- **Crates**: 48. Four in the Headframe lanes (the early cluster), ten in
  the old town's buildings and cluttered districts, ten in the pit works'
  districts and the Powder Store, thirteen in the open on the roads and the
  ring, eleven in the outskirts by the roads, the Rail Sidings' west end and
  the snow along the walls.
- Hardest to satisfy: the tight share against the endgame cover rule. The
  ring must stay open, yet every late circle in it needs two boxes; the four
  walled yards and the road crates do both.

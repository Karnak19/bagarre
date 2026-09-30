# Battle royale maps

One map for the battle royale mode (up to 10 players, one life, crates to
loot, a zone that closes on a final circle). It lives in
`packages/shared/src/maps/royale/`, apart from `MAPS` and `FFA_MAPS`, so
duel and FFA rooms never draw it. `findMap` finds it, and it is on the Maps
page with a "Royale" tag.

| Map | Size | Boxes | Starts | Crates | Plays like | Favours |
| --- | --- | --- | --- | --- | --- | --- |
| Ironvale | 90 x 90 | 228 | 14 | 23 | A mining town in the snow: a walled shaft tower in the middle, an open ring road, cluttered districts round it | rifle, sniper, SMG |

## Tools

From `packages/shared`:

```sh
bun scripts/royale.check.ts                       # the checks below (also part of `bun run check`)
bun scripts/royale.preview.ts [outDir] [mapId...]  # <id>-top.png and <id>-iso.png (default .previews/royale-maps/)
```

The plan shows the districts, the boxes with their heights, the start spots
(numbered), the crate spots (yellow), the final zone's rectangle (blue
dashes), the tight floor (violet) and, for each possible final circle
centre, how many boxes the circle holds (red under 2).

## What RoyaleMapDef adds

`packages/shared/src/maps/royale/index.ts`. `RoyaleMapDef extends MapDef`
with `mode: "royale"`, `players`, `zones`, `landmarks` and `hub` (the FFA
shapes), and:

- `spawns`: the start spots. Nobody respawns, so they are about fair
  starts: no two in sight of each other, at any distance.
- `crates`: the crate spots.
- `finalZone`: the rectangle where the final zone's centre may land.

`crates` and `finalZone` are placeholder names: the royale mode (#32) is
built in parallel and adds its own fields for these. Rename them to what
it lands with, and wire `ROYALE_MAPS` into its map pool.

## Checks

`scripts/royale.check.ts`, on every map in `ROYALE_MAPS`, using the duel
validator's geometry (`scripts/analyze.ts`):

1. Size 80..100 m a side. Boxes 0.8-2.0 m tall; a box under 1.5 m thick and
   4 m or longer is 1.1-1.4 m tall. No gap between boxes (or a box and the
   outer wall) under 1.6 m unless they touch.
2. At least 10 start spots. Every start and crate spot clear of every box by
   the player radius plus 0.25 m, and inside the walls.
3. No two start spots see each other (`bodiesSee`, all pairs).
4. 15-25 crate spots, none within 2 m of a start, none within 1.5 m of
   another.
5. Flood fill (0.2 m grid) from start 0 reaches every start and crate, and
   the whole floor is one connected region, so any open part of the circle
   can be walked into.
6. The final zone rectangle is at least 12 m from every edge.
7. Endgame cover: for every centre on a 1 m grid inside the rectangle, a
   circle of `FINAL_CIRCLE_RADIUS` (7 m, a placeholder until #32 fixes the
   final circle's size) holds at least 2 boxes and at least 50 % floor a
   player can stand on.
8. Tall decor (the trees) stands outside the walls and hides no floor from
   the camera. The camera looks down (-1, -1, -1) from the +x / +z side, so
   a tree just outside the +x or +z wall stands between it and the floor
   near that wall: a 7 m pine there hides a strip about 7 m deep. Each tree
   is modelled as a column (the largest pine or dead tree of the pack, times
   its scale) and run through the duel validator's `hiddenFromCamera` for
   every floor cell.

It also reports, without a limit, the tight and open floor shares as the
FFA validator defines them (`ffaSight` in `scripts/ffa/analyze.ts`): tight
floor sees less than 250 m² within 30 m (shotgun and SMG ground), open floor
sees at least 150 m² beyond 18 m (sniper lanes). Samples every 2 m (1 m
takes about 25 s on a 90 m map and differs by 0.1 pp), which is most of the
check's 3-4 s.

Results:

```
map        size   boxes  starts  crates  min start gap  worst endgame circle           tight  open   time
ironvale   90x90  228    14      23      14.1 m         (3, -21) 2 boxes 86% floor     30.9%  28.1%  3.5 s
```

The first version (149 boxes, an even scatter round the middle) was 13 %
tight and 74 % open. The ring road and the Checkpoint are more than half the
floor and stay open on purpose (about 2-8 % tight), so the tight share comes
from the districts, the Headframe compound and the four ring yards. Ironvale
keeps a player's chest hidden from the camera on 1.0 % of the floor (the
duel maps sit at 0-2.9 %).

## Ironvale: the mining town

An abandoned mining town under an overcast winter sky: pale blue-white
snow, a cold low sun. Coordinates as in docs/maps.md, north is -z.

- **Headframe** (|x|, |z| < 9): the mine shaft tower, a 5 x 5 m container
  (1.9 m), in a brick compound with four doors in a pinwheel (none on a
  road axis). Crate stacks and barrels against the inside walls leave a ring
  of 3.5 m lanes round the tower. Four crates sit in those lanes: the
  reason to go in early.
- **Roads**: four clear 9 m lanes (|x| or |z| < 4.5) from the compound to
  the edge, with cover only along their edges (barriers and parked trucks
  in the ring, wagons and crates in the Rail Sidings, huts in Workers' Row).
- **Ring Road** (about 9-27 m out): open ground round four small brick
  yards, one per quarter (9 x 9 m, two 2.5 m doors in opposite corners, a
  crate stack inside). The yards are what gives every final circle cover.
- Districts round the ring. Five are dense, with 2-3 m lanes:
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
- **Props** (see ASSETS.md): snowy rocks (`rock`) in the Quarry Camp and
  the Slag Heaps, dumpsters (`dumpster`) in the Main Street yards and
  Workers' Row alleys, long containers (`wagon`) for the rail wagons,
  full-size sandbags (`trench`) for the Quarry Camp and Checkpoint trenches,
  gas tanks (`gastank`) and lying water tanks (`tank`) in the Fuel Yard and
  the Engine Shed.
- **Trees**: 34 snowy pines and dead trees (scale 2-2.2, 4.4-7.9 m tall)
  outside the walls: 14 along the north wall and 10 along the west wall (the
  top of the screen, where nothing they cover is floor), and 5 each 15 m out
  beyond the south and east walls (far enough that their tops clear the
  arena, check 8). They are baked into one mesh per material like the
  cover: 3 draw calls, about 62,000 triangles, no shadow pass.
- **Starts**: 14, one or two per district plus two in ring yards (north-east
  and south-west), none in the centre. Each is tucked next to cover or
  inside a building whose door faces a wall.
- **Final zone**: centres within |x|, |z| <= 24, the whole ring and the
  inner edge of the districts; no corner pocket.
- Hardest to satisfy: the tight share against the endgame cover rule. The
  ring must stay open, yet every 7 m circle in it needs two boxes; the four
  walled yards do both (tight inside, cover for the circles round them).
  Clutter that only breaks lanes (spans in the strips, carts in a lane)
  moved the tight share by less than 1 pp each: a spot is tight only when
  it is closed in on most sides.

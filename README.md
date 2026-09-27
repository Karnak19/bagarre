# bagarre

A 1v1 isometric twin-stick shooter in the browser. Three.js on the client,
an authoritative Colyseus server, Bun everywhere.

## Run it

```sh
bun install
bun run dev      # server on ws://localhost:2567, client on http://localhost:5173
```

Other scripts:

| Command         | What it does                                                      |
| --------------- | ----------------------------------------------------------------- |
| `bun run build` | Type-checks shared + server, then type-checks and builds the client |
| `bun run smoke` | Boots a real server, connects two headless clients, checks the game loop |
| `bun run start` | Runs the server alone (no watch)                                  |

## Play against yourself

1. Run `bun run dev`.
2. Open http://localhost:5173 in a first tab. It shows "Waiting for opponent".
3. Open the same URL in a second tab or window. The match starts.

Put the two windows side by side: a tab in the background stops sending input
(browsers pause `requestAnimationFrame` there), so that player just stands still.

## Controls

| Input              | Action                                                        |
| ------------------ | ------------------------------------------------------------- |
| **WASD** / arrows  | Move, relative to the screen (W is always "up")               |
| Mouse              | Aim                                                           |
| Left button (hold) | Fire                                                          |
| **R**              | Reload (also automatic when the magazine is empty)            |
| **Space**          | Dash: a short burst in the move direction (facing if still)   |
| **Q**              | Grenade: lobbed at the cursor, max 10 m, flies over cover     |
| **E**              | Shield: a bubble that soaks damage before your HP             |
| **1**-**4**        | Pick a weapon, while dead or between matches (see below)      |

Keys are read by physical position, so on AZERTY it's ZQSD to move and the
key labelled **A** throws a grenade. First to 5 kills wins; the match restarts
a few seconds later.

A grenade lands, then explodes 0.6 s later: the red circle on the ground is
its blast radius, so get out of it. It hurts its thrower too, at half rate.
The dash has no invulnerability, you dodge by getting out of the bullet's path.

## Weapons

The pick is shown above the ability bar. It only goes in your hand when you
(re)spawn, so choose while dead or while waiting for a match.

| Key | Weapon  | Damage   | Fire interval | Bullet speed | Range | Spread | Magazine | Reload | Role                         |
| --- | ------- | -------- | ------------- | ------------ | ----- | ------ | -------- | ------ | ---------------------------- |
| 1   | Rifle   | 20       | 0.2 s         | 22 m/s       | 18 m  | 2.3°   | 12       | 1.5 s  | All-rounder, 5 hits (0.8 s)  |
| 2   | Shotgun | 6 × 12   | 0.7 s         | 18 m/s       | 7 m   | 23°    | 5        | 2.0 s  | Close range, 2 blasts (0.7 s)|
| 3   | Sniper  | 70       | 1.2 s         | 45 m/s       | 30 m  | 0°     | 4        | 2.5 s  | Long range, 2 hits (1.2 s)   |
| 4   | SMG     | 11       | 0.1 s         | 20 m/s       | 12 m  | 9°     | 30       | 1.8 s  | Mid range, 10 hits (0.9 s)   |

| Ability | Numbers                                                                 |
| ------- | ----------------------------------------------------------------------- |
| Dash    | 5 m in 5 ticks (0.17 s), 3 s cooldown, stops at walls and cover          |
| Grenade | 10 m max range, 0.6 s fuse after landing, 3.5 m radius, 60 → 15 damage (half on yourself), 8 s cooldown |
| Shield  | 2.5 s, absorbs up to 40 damage, 10 s cooldown                             |

All of these live in `shared/src/constants.ts`, one table per weapon and
ability, so balancing is a one-file change.

## Testing with latency: `?lag=`

Everything is instant on localhost, which hides netcode bugs. Add `?lag=` to
the client URL to add artificial round-trip latency, in milliseconds:

```
http://localhost:5173/?lag=150
```

Half of it delays outgoing messages, half delays incoming ones. With prediction
your own player should still respond instantly, while the opponent and bullets
run a bit behind. The bottom-left line shows how many inputs are waiting for the
server to confirm them, and the size of the last correction (0.000 m means the
prediction matched the server exactly). Your own bullets should still leave the
gun the instant you click, while the opponent's show up a bit later. Each tab has its own setting, so you can
give only one player the lag.

`?server=http://host:2567` points the client at another server
(or set `VITE_SERVER_URL` at build time).

## Layout

```
shared/src/     constants and balance tables, arena layout, message types,
                the pure step functions (physics.ts: movement/bullets,
                combat.ts: the player step with dash, weapons, abilities)
server/src/     Colyseus room (DuelRoom), synced state schema, bootstrap
server/smoke.ts headless end-to-end test
client/src/     Three.js scene, input, prediction, predicted bullets, interpolation, HUD,
                animated characters (character.ts), arena props (arenaView.ts), particles (vfx.ts)
client/public/  models (glTF, meshopt-compressed) and the particle atlas, see ASSETS.md
```

The characters, props and particles are CC0 packs by Quaternius and Kenney;
[ASSETS.md](ASSETS.md) lists them and how the files were built. They load
before the game starts; if one fails, the game falls back to plain boxes and
capsules for that part.

## How the netcode works

The server is the only source of truth. It runs a fixed 30 Hz loop, and the
client sends it exactly one input per tick: a sequence number, a move direction,
an aim angle, a "firing" flag, the cursor point (for grenades) and the ability
press counters. It never sends a position. The movement and
collision code lives in `shared/` as a pure function, `stepPlayer`, which the
server calls once per input it receives. The client calls the very same function
the moment it sends an input, so your player moves right away instead of waiting
a round trip (prediction). Every server snapshot carries, for each player, the
last input sequence number the server has applied. When one arrives, the client
drops the inputs the server already applied, starts again from the server's
position, and re-applies the ones still in flight (reconciliation). Since both
sides run the same code on the same inputs, this is usually a no-op; when they
disagree, the server wins and the gap is smoothed out over a few frames. The
opponent, their bullets and the grenades aren't predicted: the client keeps a short buffer of
snapshots and draws them 100 ms in the past, blended between the two snapshots
on either side of that moment (interpolation), so they move smoothly at 30
updates per second.

### Abilities, weapons and your own bullets

The player step (`stepPlayer` in `shared/src/combat.ts`) covers more than
walking: dash, fire interval, magazine and reload, and the grenade and shield
cooldowns. All of its state is synced, so reconciliation restarts from the
server's exact values and replaying the inputs lands on the same result.
Cooldowns count simulation steps, and the server applies at most one input per
tick on average, so sending inputs faster can't make anything come back sooner.

The ability keys are sent as press counters, not one-tick flags: every input
carries "Space has been pressed 7 times so far". The step acts when the number
goes up. If an input is lost, the next one still carries the higher number, so
the press isn't lost, and hammering a key during its cooldown gets you nothing.

Your own shots are predicted too. When the step says an input fires, the client
spawns the bullets right away with the same function the server uses. The
spread comes from a small seeded random generator fed with the input number and
pellet index, so a predicted shotgun blast spreads exactly like the server's.
Each bullet id is `slot:seq:pellet` on both sides. The client keeps drawing its
own copy (same path as the server's) and never draws the server's copy of a
bullet it predicted, so there is no second bullet trailing behind. The server's
copy only decides when the bullet ends: if the server never spawned it, or it
hit something, the predicted one is removed. The opponent's bullets and all
grenades are interpolated like before.

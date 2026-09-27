# bagarre

A 1v1 isometric twin-stick shooter in the browser. Three.js on the client,
an authoritative Colyseus server, Bun everywhere.

## Run it

```sh
bun install
bun run dev      # server on ws://localhost:2567, client on http://localhost:5173, plus convex dev
```

The repo is a Turborepo monorepo on Bun workspaces. Every root script goes
through `turbo`, which runs the matching script in each package and caches
what it can (a second `bun run build` with nothing changed is instant).

| Command                 | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `bun run dev`           | Client (Vite), game server (watch mode) and `convex dev` together, output prefixed per package |
| `bun run build`         | Type-checks every package, then builds the client into `apps/client/dist` |
| `bun run typecheck`     | Type-checks every package                                          |
| `bun run lint`          | oxlint on every package                                             |
| `bun run smoke`         | Boots a real server, connects headless clients, checks the game loop and accounts |
| `bun run maps:validate` | Checks every map and prints its stats (see [docs/maps.md](docs/maps.md)) |
| `bun run start`         | Runs the server alone (no watch)                                    |

To run one package's task only: `bunx turbo run dev --filter=@bagarre/client`,
or `bun run <script>` inside the package's folder.

## Accounts (optional)

You can always play right away as a guest (`Guest-4821`). Signing in (Clerk)
keeps a username and stats (Convex). Copy `.env.example` to `.env.local` at the
repo root and fill it in; with no keys at all the game stays guest-only and the
corner widget says sign-in isn't configured. `bun run dev` also runs
`convex dev`.

That one root `.env.local` is read by everything: Vite (`envDir` points at the
root, only `VITE_*` reach the browser), the game server
(`bun --env-file=../../.env.local`) and the Convex CLI, which runs from
`packages/backend`. The Convex CLI only ever reads and writes `.env.local` in
the folder it runs from, so `packages/backend/.env.local` is a symlink to the
root file, created automatically by `packages/backend/scripts/link-env.ts`
before each of that package's Convex scripts. Other Convex commands go through
the same script, for example:

```sh
cd packages/backend
bun run convex env set GAME_SERVER_SECRET=<value>
bun run push        # one-off push of the functions (convex dev --once)
```

- The client sends its Clerk token when joining (`client.auth.token`). The
  server checks it in `DuelRoom.onAuth` (networkless, against `CLERK_JWT_KEY`),
  reads the username from Convex, and puts it in the synced player state. A
  bad token is refused, and the client joins again as a guest.
- At the end of a match the server sends each account player's kills, deaths
  and result to `matches.record`, which only accepts calls carrying
  `GAME_SERVER_SECRET` and ignores a match id it has already seen.
- Signing in or out takes effect on the next join (the page reloads).

Code: `packages/backend/convex/` (schema, `users.ts`, `matches.ts`,
`auth.config.ts`), `apps/server/src/accounts.ts`, `apps/client/src/auth.ts` and
`apps/client/src/accountUi.ts`. The client and the server import the Convex
API from the `@bagarre/backend` package (`@bagarre/backend/api`,
`@bagarre/backend/username`), never by relative path.

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
| **M**              | Mute / unmute sound (remembered between visits)               |

Keys are read by physical position, so on AZERTY it's ZQSD to move and the
key labelled **A** throws a grenade. First to 5 kills wins; the match restarts
a few seconds later.

A grenade lands, then explodes 0.6 s later: the red circle on the ground is
its blast radius, so get out of it. It hurts its thrower too, at half rate.
The dash has no invulnerability, you dodge by getting out of the bullet's path.

Sound starts after your first click or key press (browser autoplay rules).
Your own actions are heard instantly, from the prediction. The opponent's are
delayed by the interpolation delay (100 ms) so they match what you see, and
are panned and softened by distance.

## Weapons

The pick is shown above the ability bar. It only goes in your hand when you
(re)spawn, so choose while dead or while waiting for a match.

| Key | Weapon  | Damage   | Fire interval | Bullet speed | Range | Spread | Magazine | Reload | Role                         |
| --- | ------- | -------- | ------------- | ------------ | ----- | ------ | -------- | ------ | ---------------------------- |
| 1   | Rifle   | 20       | 0.2 s         | 45 m/s       | 18 m  | 2.3°   | 12       | 1.5 s  | All-rounder, 5 hits (0.8 s)  |
| 2   | Shotgun | 6 × 12   | 0.7 s         | 36 m/s       | 7 m   | 23°    | 5        | 2.0 s  | Close range, 2 blasts (0.7 s)|
| 3   | Sniper  | 70       | 1.2 s         | 90 m/s       | 30 m  | 0°     | 4        | 2.5 s  | Long range, 2 hits (1.2 s)   |
| 4   | SMG     | 11       | 0.1 s         | 40 m/s       | 12 m  | 9°     | 30       | 1.8 s  | Mid range, 10 hits (0.9 s)   |

| Ability | Numbers                                                                 |
| ------- | ----------------------------------------------------------------------- |
| Dash    | 5 m in 5 ticks (0.17 s), 3 s cooldown, stops at walls and cover          |
| Grenade | 10 m max range, 0.6 s fuse after landing, 3.5 m radius, 60 → 15 damage (half on yourself), 8 s cooldown |
| Shield  | 2.5 s, absorbs up to 40 damage, 10 s cooldown                             |

All of these live in `packages/shared/src/constants.ts`, one table per weapon and
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
apps/
  client/             @bagarre/client: Vite + Three.js
    src/              scene, input, prediction, predicted bullets, interpolation, HUD,
                      animated characters (character.ts), arena props (arenaView.ts), particles (vfx.ts)
    public/           models (glTF, meshopt-compressed), particle atlas and sounds, see ASSETS.md
    scripts/          asset rebuild scripts (assets/, sfx/)
  server/             @bagarre/server: Colyseus on Bun
    src/              Colyseus room (DuelRoom), synced state schema, accounts, bootstrap
    smoke.ts          headless end-to-end test (smoke-accounts.ts: its account part)
packages/
  shared/             @bagarre/shared: TypeScript source, no build step
    src/              constants and balance tables, maps and arena layout, message types,
                      the pure step functions (physics.ts: movement/bullets,
                      combat.ts: the player step with dash, weapons, abilities)
    scripts/          map validator and preview renderer
  backend/            @bagarre/backend: the Convex functions
    convex/           schema, users, matches, Clerk auth config, _generated/
    testing.ts        the functions as a module map, for convex-test in the smoke test
docs/                 design notes (maps.md)
turbo.json            task graph and caching
```

`@bagarre/shared` and `@bagarre/backend` are "internal packages": their
`exports` point straight at TypeScript source, and Vite, Bun and `tsc` read it
as is. Only the client has a build output.

The characters, props and particles are CC0 packs by Quaternius and Kenney;
[ASSETS.md](ASSETS.md) lists them and how the files were built. They load
before the game starts; if one fails, the game falls back to plain boxes and
capsules for that part.

## How the netcode works

The server is the only source of truth. It runs a fixed 30 Hz loop, and the
client sends it exactly one input per tick: a sequence number, a move direction,
an aim angle, a "firing" flag, the cursor point (for grenades) and the ability
press counters. It never sends a position. The movement and
collision code lives in `packages/shared/` as a pure function, `stepPlayer`, which the
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

The player step (`stepPlayer` in `packages/shared/src/combat.ts`) covers more than
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

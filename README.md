# bagarre

An isometric twin-stick shooter in the browser: 1v1 duels, and a free for
all for 3 to 6 players. Three.js on the client,
an authoritative Colyseus server, Bun everywhere.

## Run it

```sh
bun install
bun run dev      # server on ws://localhost:2567, client on http://localhost:5173, plus convex dev
```

http://localhost:5173 opens the menu: the game's own scene slowly circling
two soldiers, with Play (quick match), Private game, the open games list, your
account, How to play and Settings. Nothing connects to the game server until
you pick a game.

In dev, add `?play` to skip the menu and quick-match at once, like the page
used to do (handy for test scripts and quick testing):
http://localhost:5173/?play. It combines with the other dev switches
(`?play&map=nest&lag=150`) and is ignored in production builds.

The repo is a Turborepo monorepo on Bun workspaces. Every root script goes
through `turbo`, which runs the matching script in each package and caches
what it can (a second `bun run build` with nothing changed is instant).

| Command                 | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `bun run dev`           | Client (Vite), game server (watch mode) and `convex dev` together, output prefixed per package |
| `bun run build`         | Type-checks every package, then builds the client into `apps/client/dist` |
| `bun run typecheck`     | Type-checks every package                                          |
| `bun run lint`          | oxlint on every package                                             |
| `bun run smoke`         | Boots a real server, connects headless clients, checks the game loop, accounts, reconnection and shutdown |
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
  server checks it in `GameRoom.onAuth` (networkless, against `CLERK_JWT_KEY`),
  reads the username from Convex, and puts it in the synced player state. A
  bad token is refused, and the client joins again as a guest.
- At the end of a match the server sends each account player's kills, deaths
  and result to `matches.record`, which only accepts calls carrying
  `GAME_SERVER_SECRET` and ignores a match id it has already seen.
- Signing in and out happen from the menu's account panel (Clerk's modal
  and user button), and apply to the next game you join, with no reload: each
  join reads a fresh token. A guest keeps the `Guest-4821` name the menu
  shows (drawn once per browser; the server only accepts names in that exact
  format, and draws another if the opponent has the same one).

Code: `packages/backend/convex/` (schema, `users.ts`, `matches.ts`,
`auth.config.ts`), `apps/server/src/accounts.ts`, `apps/client/src/auth.ts`
(the account store) and `apps/client/src/ui/account/` (the chip, the panel,
and `ClerkRoot.tsx`: `@clerk/react` and `convex/react`, loaded as its own
chunk only when `VITE_CLERK_PUBLISHABLE_KEY` is set). The client and the server import the Convex
API from the `@bagarre/backend` package (`@bagarre/backend/api`,
`@bagarre/backend/username`), never by relative path.

## Play against yourself

1. Run `bun run dev`.
2. Open http://localhost:5173 in a first tab and press **Play**. It shows
   "Looking for an opponent…" and the game's own page, `/game/<code>`.
3. Open http://localhost:5173 in a second tab: the first tab's game is in the
   open games list. Click it, or press Play (quick match joins it too), or
   paste the first tab's invite link. The match starts.

Or skip the menu in both tabs with http://localhost:5173/?play.

Put the two windows side by side: a tab in the background stops sending input
(browsers pause `requestAnimationFrame` there), so that player just stands still.

## Games, pages and the menu

Every game is its own room with its own page: `/` is the menu, `/game/<code>`
is one game (the code is the Colyseus room id). Many games run at once on one
server, and a game's link can be shared.

- **Play** (quick match) joins a public game waiting for a second player, or
  opens a new one, then goes to its page.
- **Private game** creates a room that is never listed and never
  quick-matched; the waiting card shows its invite link with a copy button.
- **Open games** lists the public games waiting for an opponent (host name,
  map, age), refreshed every 3 seconds while the menu is up. It reads
  `GET /games` on the game server, built from each room's matchmaking
  metadata (host, map, phase, players, creation time), which the room keeps up
  to date on every join, leave, phase and map change.
- Opening a `/game/<code>` link joins that room by id. A full room shows
  "This game is full", a missing or finished one "This game doesn't exist
  anymore", both with a way back to the menu.
- In a game: the waiting card (players, invite link, weapon pick, Cancel),
  then the match; at the end the result with the scoreboard, **Rematch** (stay:
  it counts down to the server's automatic restart, same room, same URL) and
  **Main menu**. **Esc** opens the match menu (Resume, Settings, Leave match).
  It is not a pause: the match keeps running underneath, and the card says so.
- Leaving (Cancel, Leave match, Main menu, or the browser's Back button)
  really leaves the room and frees everything the game made; Forward returns
  to the game's page and joins it again if there is a seat.
- `?lag=`, `?map=` and `?server=` work on game pages too. The invite link
  carries `?server=` only.
- While the menu, a card or a panel is up, the game gets no input at all
  (keys, mouse, firing), and keys typed in a text field never reach it.
- On a phone or a small window the menu says the game needs a keyboard and a
  mouse; the menu itself works at phone width.

Production hosting needs an SPA rewrite: every path (`/game/...` included)
must serve `index.html`. Vite's dev server and `vite preview` already do.

The flow (screens, joining and leaving, the per-game flags) lives in
`apps/client/src/app.ts` and the open games data in `lobby.ts`, both plain
TypeScript stores with `getState()` / `subscribe()`. The pages are TanStack
Router routes (`src/routes/`): entering `/` or `/game/$code` calls the flow's
`routeMenu()` / `routeGame(code)` (the route's `onEnter` / `onStay`), so
Back, Forward and pasted links all go through the same join and leave. See
[Client UI](#client-ui) below.

## Client UI

The UI is React, on TanStack Router (file-based, with its Vite plugin) and
the Astryx design system. The Three.js scene and the game loop stay plain
TypeScript: React never runs per frame and there is no React Three Fiber.

- `src/engine.ts` owns the scene, the attract loop, the match frames and the
  one `requestAnimationFrame` loop. Each frame it publishes what the views
  need into small stores: the game view (`GameView`, which card is up, the
  latest snapshot) and the HUD model (`hud.ts`, written by `match.ts`).
- React reads every store through `useSelector` / `useStore`
  (`src/ui/hooks.ts`, on `useSyncExternalStore`): a component re-renders only
  when the few fields it picked change. Values that move every frame (ability
  cooldowns, the reload bar, the map card's fade, the debug line) are written
  to the DOM from a store subscription (`useStoreEffect`), outside React. An
  idle HUD does not re-render at all; in dev, `window.__bagarre.renders`
  counts renders per widget.
- `src/keys.ts` holds the app keys (Esc, Tab, M and 1-4 on cards) and the
  input isolation rules; `src/uiState.ts` says which panel is open, so the
  loop keeps the game's input off meanwhile.
- `src/ui/`: `Shell.tsx` (root layout: theme, cards, Tab scoreboard, panels,
  the lazy Clerk root), `menu/`, `game/` (HUD, cards, scoreboard, weapon
  picker), `account/`, `Panels.tsx` and `Settings.tsx`.
- Stable `data-testid`s mark the pieces tests drive: `play`, `private-game`,
  `open-games`, `open-game`, `invite-link`, `copy-invite`, `waiting-card`,
  `scoreboard`, `scoreboard-row`, `esc-menu`, `esc-resume`, `esc-settings`,
  `esc-leave`, `result-card`, `rematch`, `main-menu`, `notice`,
  `notice-retry`, `notice-back`, `account-chip`, `account-panel`,
  `settings-volume`, `settings-mute`, and the HUD's `hud-*`. The free for
  all adds `play-ffa`, `private-ffa`, `ffa-countdown`, `ffa-players`,
  `placement-row`, `result-winner`, `scoreboard-time`, `hud-ffa`,
  `hud-ffa-rank`, `hud-ffa-top`, `hud-ffa-time`, `hud-killfeed`,
  `hud-killfeed-row` and `hud-minimap`.

Astryx conventions (the agent cheat sheet `astryx init` wrote is
`apps/client/.claude/CLAUDE.md`; `bun run astryx docs <topic>` and
`bun run astryx component <Name>` in `apps/client` print the full reference):

- Astryx components first (`Button`, `Card`, `Dialog`, `Table`, `Text`,
  `HStack` / `VStack`...), imported per component
  (`@astryxdesign/core/Button`). No raw layout `<div>`s.
- Anything custom is StyleX: `stylex.create()` next to the component, passed
  as `xstyle` to Astryx components. StyleX compiles at build time
  (`@stylexjs/unplugin` in `vite.config.ts`). Values are theme tokens:
  `var(--color-*)`, `var(--spacing-*)`, and the game's own `var(--bagarre-*)`.
  A conditional style needs a `default` at every level
  (`":hover": { default: null, "@media (hover: hover)": ... }`) or it won't
  type-check as `xstyle`.
- The look lives in the theme, `src/ui/theme/bagarre.source.ts`: Astryx's
  neutral theme extended with the game's palette (orange `#ff6b4a` and blue
  `#4ab8ff` player colours, dark translucent panels, the Black Ops One
  stencil for display text). After editing it run `bun run theme:build` in
  `apps/client`, which regenerates `bagarre.css` / `bagarre.js` next to it
  (both committed).
- The only plain CSS is `src/ui/global.css`: the font face, the full-screen
  canvas and the page background.


## Free for all

Every player for themselves, 3 to 6 per room, on the three big FFA maps
(Crossroads, Freight, Bastion, see [docs/ffa-maps.md](docs/ffa-maps.md)).
Duel maps stay duel-only, and FFA maps never show up in a duel.

- **Winning**: first to 15 kills (`FFA_KILLS_TO_WIN`), or the most kills
  after 6 minutes (`FFA_TIME_LIMIT`). A tie for the most kills when the time
  runs out goes to **sudden death**: the match ends as soon as one player
  alone has the most kills (so the next kill by one of the tied leaders wins).
  If that takes more than 60 s (`FFA_SUDDEN_DEATH_MAX`), it ends anyway and
  deaths break the tie.
- **Places**: most kills, then fewest deaths; players equal on both share
  the place (`placements` in `packages/shared/src/modes.ts`, used by the
  server and the client alike).
- **Start**: once 3 players are in, a 10 s countdown (`FFA_COUNTDOWN`), then
  everyone spawns spread out, out of each other's sight (`ffaStartSpawns`),
  facing the centre. If a player leaves before the end of the countdown and
  fewer than 3 are left, it stops.
- **Drop-in**: players can join a match in progress, up to 6. They spawn
  out of every living player's sight (`ffaRespawnPoint`) with 0 kills. The
  open games list keeps a running FFA listed while it has a free seat.
- **Respawn**: 3 s after dying (`FFA_RESPAWN_DELAY`), out of every living
  opponent's sight, not too near anyone and not too far from the action
  (`ffaRespawnPoint`).
- **Kills**: the kill goes to whoever dealt the killing blow. Dying to your
  own grenade credits no one and counts as a death; no kill is taken away.
- **Too few players**: below 2 players mid-match, the match ends (the one
  left wins).
- **After the match**: the placement table for 8 s (`FFA_END_DELAY`), then a
  rematch in the same room on another FFA map, if 3 players are still
  connected; otherwise back to waiting.
- **Stats**: `matches.record` gets FFA matches too. First place (shared or
  not) is a win, every other place a loss; each account player's place is
  kept on the match's `recordedMatches` row, with the mode.

In a game: the HUD adds your rank ("2nd of 5 · 7 kills"), the top three, the
time left, a kill feed (killer, weapon, victim) and a minimap in the bottom
right corner (zones, cover, landmarks, you; enemies only show up when they
fire, as a dot fading over 1.5 s). Tab lists every player by place. The
waiting card lists who's in and says the match starts when 3 are in, then
counts down.

On the menu, **Free for all** quick-matches an FFA (joins an open one or
opens a new one), and **Private FFA** makes a private one. In dev,
`?play=ffa` skips the menu and quick-matches an FFA.

### Rooms and modes

One room class plays both modes: `GameRoom` (`apps/server/src/GameRoom.ts`),
driven by the mode's rules (`ModeRules` in `packages/shared/src/modes.ts`:
seats, start threshold, kill target, time limit, countdown, respawn delay,
result delay, drop-in, map pool). `DuelRoom` and `FfaRoom` only pick the
rules, and are registered as the `duel` and `ffa` room types. The simulation
(inputs, bullets, grenades, damage) is shared; the mode shows up in a few
places only: spawns, respawns, what a leave does, and the end conditions.
`GameRoom.pinnedTo(mapId)` pins a room class to one map of its own pool
(`createServer({ mapId, ffaMapId })`), `GameRoom.withRules({...})` tweaks the
rules (the smoke test's short countdown and time limit), and the dev
`?map=<id>` works in both modes, for that mode's maps only.

Map lookup: `findMap(id)` searches the duel and FFA maps and returns null for
an unknown id. The client resolves the synced `mapId` with it and logs an
error rather than silently drawing Yard; `mapById` (which falls back to Yard)
is only for display. A room only ever picks from its own pool.

The synced state (`GameState`) carries the mode, the kill target, the time
limit, the countdown, the sudden death flag and the kill feed (the last 5
deaths, with names and seats copied so a line stays readable after its
players leave).

### Seats and clients (the seam for spectators)

A client is not a player. A **seat** is a player: an entry in
`state.players` plus its server-side bookkeeping, and the seat number is the
player's `slot` (its colour, 0-5, and its bullet ids). A seat is taken in
`onJoin`, kept through a dropped connection (`onDrop` / `onReconnect`, 20 s)
and freed in `onLeave`.

- The player cap is on seats, never on `maxClients`: `maxClients` is the
  seats plus `SPECTATOR_ROOM` (20), room left for future spectators.
- `GameRoom.hasReachedMaxClients()` counts seats taken plus seats promised
  to joins in flight, and Colyseus locks the room while it's full: quick
  match skips it (and two joins racing for the last seat are settled there),
  and a join by id says "This game is full". It unlocks when a seat frees.
  `onJoin` also refuses a seat past the cap.
- Every message handler (input, weapon pick, ping) and `onDrop`, `onReconnect`
  and `onLeave` do nothing for a client without a seat.

To add spectators later: a `spectate: true` join option makes `wantsSeat()`
return false, and `onJoin` then registers the client with no player (the
client draws the match from the state, with no prediction). The one piece to
build is a way in past the seat lock, since a locked room refuses
`joinById`: for example a small HTTP route that reserves a seat for a
spectator through a room method that skips the seat count.

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
| **Tab** (hold)     | Scoreboard                                                    |
| **M**              | Mute / unmute sound (remembered between visits)               |
| **Esc**            | Match menu: resume, settings, leave (the match keeps running) |

Keys are read by physical position, so on AZERTY it's ZQSD to move and the
key labelled **A** throws a grenade. In a duel, first to 5 kills wins; the
match restarts a few seconds later (free for all: see above).

A grenade lands, then explodes 0.6 s later: the red circle on the ground is
its blast radius, so get out of it. It hurts its thrower too, at half rate.
The dash has no invulnerability, you dodge by getting out of the bullet's path.

Sound starts after your first click or key press (browser autoplay rules):
any menu button counts. Settings (on the menu, or from Esc in a game) has the
master volume and mute; both are remembered.

### Scoreboard

Hold **Tab** in a match to see it; it's also on the match result. It shows
the map, the score (first to 5), the match time, and per player: kills,
deaths, damage dealt, accuracy (bullets that hit / bullets fired, each
shotgun pellet counts), the weapon in hand and the ping. The leader is
highlighted. Everything on it is counted by the server and synced in the room
state (`deaths`, `shots`, `hits`, `damage`, reset when a match starts). The
ping is measured by the server too: every 2 seconds it sends each client a
probe that the client echoes at once, and the round trip becomes the
player's `ping`.
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

## Maps

Each match is played on a random map, never the same one twice in a row. The
map changes only between matches (both players go to the new map's spawns),
and its name and a one-line blurb show at the top of the screen for a few
seconds when the match starts. A room's first match stays on the map the room
was created on, so a player waiting alone is already on it.

| Map (`id`)    | Size    | Plays like                                          | Favours          |
| ------------- | ------- | --------------------------------------------------- | ---------------- |
| Yard (`yard`) | 30 x 30 | The original: open, four pieces of cover            | rifle, SMG       |
| Runway (`runway`) | 40 x 28 | Big open airstrip, long lanes, few islands      | sniper, rifle    |
| Trenchworks (`trenchworks`) | 28 x 28 | Sandbag maze of 3 m trenches around a plaza | shotgun, SMG |
| Fort (`fort`) | 32 x 32 | A walled blockhouse around a crate keep             | rifle, SMG       |
| Dockside (`dockside`) | 36 x 28 | Three lanes split by container rows         | rifle, SMG       |
| Nest (`nest`) | 30 x 30 | King of the hill: one sandbag pit in an open field  | rifle, shotgun   |
| Scrapyard (`scrapyard`) | 34 x 30 | Junk piles that look random but mirror exactly | SMG, shotgun, rifle |

You respawn on a spawn the opponent can't see if there is one, else on the one
farthest from them. The maps are plain data in `packages/shared/src/maps/`;
[docs/maps.md](docs/maps.md) has the design notes, the format and the
validator.

In dev, add `?map=<id>` to the client URL to play a given map, for example
http://localhost:5173/?map=trenchworks. It holds for every match of that room
(if the other tab already made a room, its next match start switches to it).
The server ignores it when `NODE_ENV=production`. `createServer({ mapId })`
pins every room of a server to one map (the smoke test pins `yard`).

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
  client/             @bagarre/client: Vite + Three.js, React UI
    src/              engine.ts (scene, attract loop, the frame loop), scene, input, prediction,
                      predicted bullets, interpolation, animated characters (character.ts),
                      arena props (arenaView.ts), particles (vfx.ts), one game (match.ts),
                      the menu's background scene (attract.ts);
                      stores: app.ts (flow), lobby.ts, auth.ts (account), hud.ts, scoreboard.ts (model);
                      routes/ (TanStack Router pages), ui/ (React + Astryx views, theme/)
    public/           models (glTF, meshopt-compressed), particle atlas and sounds, see ASSETS.md
    scripts/          asset rebuild scripts (assets/, sfx/)
  server/             @bagarre/server: Colyseus on Bun
    src/              the Colyseus room for both modes (GameRoom: DuelRoom, FfaRoom), synced state schema, accounts, bootstrap
                      and the GET /games route (app.ts)
    smoke.ts          headless end-to-end test (smoke-accounts.ts: its account part, smoke-ffa.ts: the free for all)
packages/
  shared/             @bagarre/shared: TypeScript source, no build step
    src/              constants and balance tables, the maps (maps/) and the Arena shape,
                      message types, the pure step functions (physics.ts: movement/bullets,
                      combat.ts: the player step with dash, weapons, abilities),
                      line of sight and the respawn rule (sight.ts)
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

### Map changes

Every physics function takes the map as its first argument (there is no
"current map": one server runs several rooms). The server syncs `mapId` in the
room state and changes it only when a match starts, in the same tick as it puts
both players on the new spawns, so the client gets the new map and the new
positions in one snapshot. The client treats a new `mapId` as a hard boundary,
handled before that snapshot is buffered or reconciled: it empties the
interpolation buffer (so the opponent doesn't slide from an old-map position),
drops its predicted bullets and every drawn bullet and grenade, rebuilds the
arena, and resets the prediction to restart from the server's state on the new
map. The inputs still waiting for the server are replayed on the new map,
which is where the server will run them, so the prediction stays exact.

### Dropped connections, restarts and bad messages

A connection that drops (network loss, a closed laptop, a page reload) doesn't
throw you out. The server keeps your seat for 20 seconds (`RECONNECT_GRACE_S`,
Colyseus' `onDrop` and `allowReconnection`). Meanwhile your character stays
where it was, takes no input and can still be shot, and your opponent sees
"reconnecting…" on your name and a line saying you lost your connection.

- The client reconnects on its own with the Colyseus SDK's automatic
  reconnection (a retry every 2 s at most) and shows a "Reconnecting…" card.
  Back in, it treats the first snapshot like a map change: it empties the
  interpolation buffer, resets the prediction and forgets the inputs lost with
  the connection, and takes what happened meanwhile as known, so no sound or
  effect plays for it.
- A reload of the game's page takes the seat back too: the page keeps the
  reconnection token in `sessionStorage` (per tab) and opening `/game/<code>`
  within the grace period calls `client.reconnect()` before trying a normal
  join.
- After the grace period it's a normal leave: the opponent goes back to
  waiting. A match never starts against an empty seat: the rematch waits until
  both players are connected.
- Leaving on purpose (Leave match, Main menu, Back) is a consented leave: no
  seat is held and no reconnection is attempted.

On SIGTERM (Coolify redeploys by stopping the container) the server refuses
new joins, closes every match with close code 4001 and exits 0. Clients show
"The game server is restarting" instead of trying to reconnect to a server
that no longer has the room.

Every client message is checked before it touches the room
(`packages/shared/src/messages.ts`): shape, types, finite numbers, ranges. A
bad one is dropped whole, and message types the room doesn't know are dropped
too. A client sending more than 300 messages a second (ten times the normal
rate) is disconnected with no seat held; the input budget still paces the
game itself.

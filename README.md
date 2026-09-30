# bagarre

An isometric twin-stick shooter in the browser: 1v1 duels, and a free for
all for 3 to 6 players. Three.js on the client,
an authoritative Colyseus server, Bun everywhere.

## Run it

```sh
bun install
bun run dev      # server on ws://localhost:2567, client on http://localhost:5173
```

http://localhost:5173 opens the menu: the game's own scene slowly circling
two characters in random skins, with Play (quick match), Private game, the open games list, your
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
| `bun run dev`           | Client (Vite) and game server (watch mode) together, output prefixed per package |
| `bun run build`         | Type-checks every package, then builds the client into `apps/client/dist` |
| `bun run typecheck`     | Type-checks every package                                          |
| `bun run lint`          | oxlint on every package                                             |
| `bun run test`          | The unit tests (`bun:test`, the `*.test.ts` files next to the code) in every package; not the Playwright suite (see [Unit tests](#unit-tests)) |
| `bun run smoke`         | Boots a real server, connects headless clients, checks the game loop, accounts, reconnection and shutdown (port 2599, or `SMOKE_PORT`) |
| `bun run e2e`           | The Playwright suite: real browsers playing against a real server (see [End-to-end tests](#end-to-end-tests)) |
| `bun run bench`         | Times the shared physics per tick (movement, bullets, reconcile, line of sight) on Ironvale and Crossroads, with a checksum that must not change when optimizing (`--map`, `--ticks`, `--json`) |
| `bun run maps:validate` | Checks every map and prints its stats (see [docs/maps.md](docs/maps.md)) |
| `bun run start`         | Runs the server alone (no watch)                                    |

To run one package's task only: `bunx turbo run dev --filter=@bagarre/client`,
or `bun run <script>` inside the package's folder.

## Unit tests

The game rules, the tables and the maps' layout rules are tested with
`bun:test`, in `*.test.ts` files next to the code they test
(`packages/shared/src/modes.test.ts`, `src/maps/royale/royale-maps.test.ts`,
`apps/client/src/spectate/model.test.ts`...). `bun run test` runs them all;
CI runs it too.

```sh
bun run test                                 # every package's tests
cd packages/shared
bun test src/royale.test.ts                  # one file
bun test -t "the lot"                        # the tests whose name matches
bun test --watch src                         # re-run on save
```

Each package's `test` script is `bun test ./src`, so a bare `bun test` at
the repo root is not the way in: it would also pick up the Playwright
specs in `apps/e2e/tests/`. They are typed by each package's
`tsconfig.test.json` (with `@types/bun`), kept out of the main `tsconfig.json`
so Bun's globals never reach the shared or browser code.

## End-to-end tests

`apps/e2e` (`@bagarre/e2e`) is the Playwright suite: headless Chromium pages
playing against the real game server. Every new feature adds a spec there,
or extends one.

```sh
bun run e2e                                  # the whole suite, headless
cd apps/e2e
bunx playwright test duel                    # one spec file (or -g "<test name>")
bunx playwright test --headed --workers 1    # watch it play
bun run test:ui                              # Playwright's UI mode (in apps/e2e)
bun run report                               # the last HTML report
```

The first run may need the browser: `bunx playwright install chromium` in
`apps/e2e`.

- `playwright.config.ts` boots its own servers on their own ports, so it
  never meets `bun run dev`: the game server `server.ts` on 2610, and the
  client on 5610, built in development mode (the `__bagarre` dev handle stays
  in) and served by `vite preview`. No `.env.local`: the game server keeps
  its accounts in an in-memory database, fresh on every run.
- `server.ts` is the real `createServer()` with shorter rules (a duel is won
  at 2 kills, the FFA and team countdowns are 2 s, every warmup is 1 s) and a test-only control API on 2611:
  `POST /kill` kills a player through the room's own damage path, so a test
  reaches a match end without aiming. It is the real damage path, so it does
  nothing between teammates (the team spec checks that). `POST /place` puts
  a player on a given spot at once (the grenade spec sets its throws up with it).
  `POST /warmup` sets one room's warmup length, the one running included
  (the warmup spec plays the real 8 s, then holds it open for its checks).
  `POST /hp` sets a living player's HP outside the damage path (the heal
  tests hurt players with it).
  `POST /countdown` and `POST /respawn` do the same for the pre-match
  countdown and the respawn delay. A 0.5 s death or a 2 s countdown can fall
  between two frames of a starved CI page, so a spec that checks one holds it
  open, checks, then lets it go (`setCountdown()`, `setRespawn()`).
  The battle royale's rules are short too (a 2 s countdown, the zone
  waiting 60 s and closed at 90 s), and two more calls drive it:
  `POST /loot` makes a room's crates drop a given gun, or any floor item
  (healing items, shield charges), instead of a random item (`setLoot()`), `POST /zone` moves the running zone's shrink to start
  and end some seconds from now (`setZone()`).
- `tests/fixtures.ts` holds the fixtures. `players.open()` is a new player
  (its own browser context); `players.duel()`, `players.teams(n)` and `players.host()` /
  `players.join()` open a private game by its link, so tests running in
  parallel never meet. `Player.state()` reads the dev handle into one plain
  object (screen, card, phase, room, players, spectator...), and `kill()`,
  `bot()`, `sfxCount()` / `sfxSince()` drive and watch the game.
- Assertions go through `data-testid`s and `__bagarre`, never pixels. Wait
  with web-first assertions and `expect.poll` / `expectState()`, never a
  fixed sleep. Pages open with `?map=` (pinned map), `?fps=` (a dev-only
  cap on frames drawn, 10 with a GPU and 5 with SwiftShader: many pages
  drawing at 60 fps starve the machine; the HUD and minimap update with the
  drawn frames too) and `?lite` (dev-only: no antialiasing, no shadows, the
  bulk of a frame's cost on SwiftShader).
- WebGL: on a Mac the real GPU (Metal, one shared browser per test); on
  Linux (CI) SwiftShader, one browser per player. `E2E_GL=swiftshader` forces
  the software path locally.

To add a test: a `*.spec.ts` in `apps/e2e/tests/` importing `test` and
`expect` from `./fixtures.ts`; give any element you drive a `data-testid`
and extend `PlayerState` when a test needs a new piece of state.

CI (`.github/workflows/ci.yml`, on pull requests and before each release) runs
with no secrets, as parallel jobs: `check` (build, typecheck, lint, map and
shared checks), `smoke`, and the e2e suite split into 4 shards
(`playwright test --shard=N/4`). A failing shard uploads its Playwright report
as `playwright-report-N`.

## Accounts (optional)

You can always play right away as a guest (`Guest-4821`). An account keeps a
username, a skin and stats: sign up with an email and a password, or with Discord
when it's configured. The accounts live in the game server itself:
[`@colyseus/auth`](https://docs.colyseus.io/auth/module) for sign-up, sign-in
and session tokens, and [`@colyseus/database`](https://docs.colyseus.io/database)
(Drizzle) for the data. There is no other service to run.

- **Database.** `DATABASE_URL` picks it: set, a Postgres (production, see
  `docker-compose.yaml`); unset, PGlite, an embedded Postgres, in
  `apps/server/.data/pglite` for `bun run dev` (it survives restarts; delete
  the folder to start over) and in memory for the smoke and e2e servers. So
  dev, the tests and CI need no Docker and no secrets. Production refuses to
  start without `DATABASE_URL`.
- **Tables and migrations.** `@colyseus/auth`'s `colyseus_users`, extended
  with `username`, `username_key` (unique, lowercased) and the stats
  (`kills`, `deaths`, `wins`, `losses`, `matches`), and our own
  `bagarre_matches` (one row per recorded match: mode, time, each account
  player's place, kills, deaths and team). The binary creates and updates
  them itself at every boot, before it listens (`src/db.ts`):
  `@colyseus/database`'s `migrations: "auto"` creates missing tables,
  columns and indexes, and `BAGARRE_MIGRATIONS` holds our own idempotent
  statements. Nothing is ever dropped or retyped: a change like that needs a
  new statement there.
- **Session tokens.** A JWT signed with `JWT_SECRET` (a fixed dev-only
  secret outside production, which refuses to start without it), carrying
  only the account id and its token version, valid 30 days. The client sends
  it when joining (`client.auth.token`); `GameRoom.onAuth` checks it and
  reads the username from the database. No token, or a bad, expired or
  revoked one, joins as a guest: playing never needs an account. A guest
  keeps the `Guest-4821` name the menu shows (drawn once per browser; the
  server only accepts names in that exact format, and draws another if
  someone in the room has the same one). An account without a username yet
  plays under a guest name too, and its matches aren't counted.
- **Skins.** Every player wears one of the characters in `SKINS`
  (`packages/shared/src/skins.ts`). They only change the look: the hitbox
  and speed are the same for all. A guest, or an account that never picked
  one, gets a random skin at every match, one nobody else in the room wears
  if possible. An account picks its skin in the account panel; it is saved
  in `colyseus_users.skin` and used from the next match on.
- **Routes** (on the game server, so `/colyseus/...` in production):
  `@colyseus/auth`'s `POST /auth/register`, `POST /auth/login`,
  `GET /auth/userdata` and, with Discord, `GET /auth/provider/discord` (and
  its callback); ours: `GET /auth/providers`, `POST /auth/forgot-password`,
  `POST /auth/reset-password`, `GET /account`, `POST /account/username`,
  `POST /account/skin` and `GET /leaderboard` (top 10 by wins). The
  route names, the username rules and the answers' types are in
  `packages/shared/src/accounts.ts`.
- **Password reset.** The email links to the client's
  `/reset-password?token=...` page. It goes out through Resend (one `fetch`
  to its API) when `RESEND_API_KEY` and `MAIL_FROM` are set; otherwise the
  link is printed in the server's console, which is what you use in dev. The
  link works for 30 minutes and once, and a reset signs out every session.
- **Discord**, only when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are
  set (the button is hidden otherwise). Register this redirect in the
  Discord developer portal (your app, OAuth2, Redirects):
  `<PUBLIC_URL>/colyseus/auth/provider/discord/callback`, so
  `https://ghj9pktfasrpthjvvpg2gehp.big-server.basile.vernouillet.dev/colyseus/auth/provider/discord/callback`
  in production, and `http://localhost:2567/auth/provider/discord/callback`
  for a dev app. The server builds it from `PUBLIC_URL` (the site's public
  origin, required in production) plus `/colyseus`, or from
  `PUBLIC_SERVER_URL` when set. A new Discord account picks a username like
  any other.
- **Stats.** At the end of a match the server records each account player's
  kills, deaths and result, once per match id, in one transaction
  (`writeMatch` in `apps/server/src/accounts.ts`).

Every variable is listed in `.env.example` (dev, all optional: copy it to
`.env.local` at the repo root, which Vite and the server both read) and
`.env.production.example` (production).

On the client, `apps/client/src/auth.ts` is a plain store (`getState` /
`subscribe`) around one long-lived `@colyseus/sdk` Client, pointed at the
same game server as the rooms (`resolveServerUrl()` in `config.ts`).
`client.auth.*` signs up, in and out, runs the Discord popup and asks for
reset links, and keeps the session token in localStorage
(`colyseus-auth-token`); `client.http` calls the game's own routes with it.
Its `status` is `loading`, `signedIn`, `signedOut` or `error` (a session is
saved but the server can't be reached), and `account` is the fresh `Account`
from `GET /account` (a 401 there signs out, with a notice). It reads the
account again after signing in, when the account panel opens and back on the
menu after a game. Each join sends the saved token (`getJoinToken()`); if the
room says we're not an account while we're signed in with a username, a
notice says we're playing as a guest. The screens, all in the account panel
(the chip on the menu opens it): sign in, sign up, forgot password, choose a
username (it opens by itself for a signed-in account without one, a new
Discord account included), your stats, sign out. The emailed link opens
`/reset-password?token=` (`src/routes/reset-password.tsx`). The menu's
Leaderboard link opens the top 10 (`src/ui/menu/Leaderboard.tsx`).

Code: `apps/server/src/db.ts` (schema, driver, migrations), `accounts.ts`
(identity at join time, profiles, usernames, stats, leaderboard), `auth.ts`
(the auth routes and their settings), `apps/client/src/auth.ts` (the account
store) and `apps/client/src/ui/account/` (the chip, the panel, the auth
screens).

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
- **Open games** lists the public games with a free seat (**Join**: host
  name, map, age), then the ones under way or full (**Watch**, with how many
  are watching), refreshed every 3 seconds while the menu is up. It reads
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
must serve `index.html`, or the page's own copy of it (see
[Link previews and search](#link-previews-and-search)). Vite's dev server
and `vite preview` already do, and so does `apps/client/Caddyfile`.

The flow (screens, joining and leaving, the per-game flags) lives in
`apps/client/src/app.ts` and the open games data in `lobby.ts`, both plain
TypeScript stores with `getState()` / `subscribe()`. The pages are TanStack
Router routes (`src/routes/`): entering `/` or `/game/$code` calls the flow's
`routeMenu()` / `routeGame(code)` (the route's `onEnter` / `onStay`), so
Back, Forward and pasted links all go through the same join and leave;
`/game/$code/watch` calls `routeWatch(code)` (see [Spectating](#spectating)).
`/maps` (the menu's Maps button) lists every map with its plan, size, modes
and favoured weapons; `/maps/<id>` walks around one: the real arena with the
spectator's free camera (WASD, drag, wheel, 2 / 3), built in the browser
alone, with no server and no room (`src/walk.ts`, `src/ui/maps/`).
See [Client UI](#client-ui) below.

## Link previews and search

A link pasted in Discord, Slack or X shows a card with a title, a line of
text and an image. Their bots don't run JavaScript, so those tags have to be
in the HTML the server sends, not set by the app once it runs.

- `apps/client/seo/meta.ts` holds every page's text and the site's origin
  (`SITE_ORIGIN`, https://bagarre.basilevernouillet.com, the start of every
  absolute URL). `pageFor(pathname)` gives a page's title, description,
  share image and whether search engines should skip it: the home page and
  the Maps list, one page per map (its name, blurb, size, modes and weapons,
  and its own image), one generic invite for every `/game/<code>` and one
  "watch a live match" for every `/game/<code>/watch` (the code is never put
  in the page), and `/reset-password`. The game pages and the reset page
  are `noindex`. The indexable pages also carry the game as schema.org
  `VideoGame` data (JSON-LD).
- `apps/client/seo/plugin.ts` (a Vite plugin) puts those tags in place of
  the `<!-- seo -->` marker of `index.html`. `vite build` writes one copy of
  the built `index.html` per page, same hashed bundles:
  `dist/index.html`, `dist/maps.html`, `dist/maps/<id>.html`,
  `dist/game.html`, `dist/watch.html` and `dist/reset-password.html`, plus
  `robots.txt` (everything allowed but `/game/` and `/reset-password`) and
  `sitemap.xml` (`/`, `/maps` and every map), both built from the map list.
  `vite dev` fills the marker per request, and `vite preview` serves each
  path its copy, so dev, preview, the e2e suite and production send the same
  HTML. In production the Caddyfile does the same mapping
  (`/game/*/watch` to `watch.html`, `/game/*` to `game.html`, then
  `{path}.html`, then `index.html`).
- The share images are 1200 × 630 PNGs in `apps/client/public/og/`
  (`og.png`, and `maps/<id>.png` per map), drawn by the game itself:
  `bun run og:render` in `apps/client` boots the client in headless Chromium
  (Playwright), hides the UI, frames the menu's scene (or the map, whole, for
  a map image), lays the BAGARRE logo over it in Black Ops One and shrinks
  the screenshot to 256 colours (under 200 KB each). It needs ImageMagick
  (`magick`) on the PATH. `bun run og:render -- site yard` redraws only
  those. A map with no image yet falls back to `og.png`.

`apps/e2e/tests/seo.spec.ts` fetches the raw HTML (no JavaScript) of each
kind of page and checks the tags, the images and the two text files.

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
- `src/keys.ts` holds the app keys (Esc, Tab, M and the weapon number keys on cards) and the
  input isolation rules; `src/uiState.ts` says which panel is open, so the
  loop keeps the game's input off meanwhile.
- `src/ui/`: `Shell.tsx` (root layout: theme, cards, Tab scoreboard, panels),
  `menu/`, `maps/` (the Maps page, the map plans, the walk's bar), `game/`
  (HUD, cards, scoreboard, weapon picker), `account/`, `Panels.tsx` and
  `Settings.tsx`.
- Stable `data-testid`s mark the pieces tests drive: `play`, `private-game`,
  `open-games`, `open-game`, `invite-link`, `copy-invite`, `waiting-card`,
  `scoreboard`, `scoreboard-row`, `esc-menu`, `esc-resume`, `esc-settings`,
  `esc-leave`, `result-card`, `rematch`, `main-menu`, `notice`,
  `notice-retry`, `notice-back`, `account-chip`, `account-panel`, the
  account screens' `sign-in`, `sign-up`, `forgot-password`, `auth-email`,
  `auth-password`, `auth-submit`, `auth-error`, `auth-sent`,
  `auth-to-sign-up`, `auth-to-sign-in`, `auth-forgot`, `auth-discord`,
  `sign-out`, `account-email`, `account-retry`, `username-form`,
  `username-input`, `username-save`, `rename`, the skin picker's
  `skin-picker` (with `data-skin`, the saved one), `skin-option` (with
  `data-skin`), `skin-preview`, `skin-preview-name`, `skin-sign-in` and
  `skin-error`, the reset page's
  `reset-password`, `reset-password-form`, `reset-password-input`,
  `reset-password-confirm`, `reset-password-submit`, `reset-password-error`,
  `reset-password-done`, `reset-password-sign-in`, `reset-password-back`, the
  leaderboard's `open-leaderboard`, `panel-leaderboard`, `leaderboard` (with
  `data-state`) and `leaderboard-row` (with `data-username`, `data-you`),
  `settings-volume`, `settings-mute`, `settings-names`, the grenade picker's
  `grenade-picker` and `grenade-pick-{frag,smoke,stun,flash,heal}`, and the HUD's `hud-*`
  (`hud-grenade` with `data-type`, `hud-stunned`, `hud-flash` with
  `data-active`, `hud-picker-grenade`). The free for
  all adds `play-ffa`, `private-ffa`, `ffa-countdown`, `ffa-players`,
  `placement-row`, `result-winner`, `scoreboard-time`, `hud-ffa`,
  `hud-ffa-rank`, `hud-ffa-top`, `hud-ffa-time`, `hud-killfeed`,
  `hud-killfeed-row` and `hud-minimap`. The team deathmatch adds `play-tdm`,
  `private-tdm`, `team-seats` (with `data-team`), `switch-team`,
  `switch-team-hint`, `team-countdown`, `team-players`, `hud-team` (with
  `data-red`, `data-blue`, `data-you`), `hud-team-red`, `hud-team-blue`,
  `hud-team-you`, `hud-team-time`, `scoreboard-team` (with `data-team`,
  `data-score`, `data-you`, `data-won`), `scoreboard-team-heading` and
  `result-teams`. The battle royale adds `play-royale`, `private-royale`,
  `royale-countdown`, `royale-players`, `hud-royale` (with `data-alive`,
  `data-zone`), `hud-royale-alive`, `hud-zone-time`, `hud-zone-arrow`,
  `hud-slots`, `hud-slot-{1,2,3}` (with `data-weapon`, `data-active`,
  `data-ammo`), the grenade and shield slots' `data-count`, `hud-heals`,
  `hud-heal-{bandage,medkit}` (with `data-count`, `data-active`),
  `hud-heal-status` (with `data-state`: `healing`, or how it ended: `done`,
  `hurt`, `zone`, `fire`, `throw`, `switch`) and `result-stats`. Spectating adds `spectate-bar`,
  `spectate-watching`, `spectate-mode` (and `spectate-mode-{follow,overview,free}`),
  `spectate-hints`, `spectate-count`, `spectate-join`, `spectate-leave`,
  `spectate-players`, `spectate-player`, `spectate-status` and the players'
  `hud-spectators`. The Maps page adds `open-maps`, `maps`, `maps-back`,
  `map-card-<id>`, `map-size-<id>`, `map-plan-<id>`, `map-teams-<id>`,
  `walk-<id>`, and the walk's `walk` (with `data-mode`), `walk-map`,
  `walk-mode` (and `walk-mode-{overview,free}`) and `walk-back`. Open games
  rows carry `data-action="join"` or `"watch"`.

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
  If that takes more than 60 s (`SUDDEN_DEATH_MAX`, the rules'
  `suddenDeathMax`), it ends anyway and the tiebreaks below pick the winner.
  There are no draws: every match has exactly one winner.
- **Places**: most kills first. Players level on kills are split by, in
  turn: the most damage dealt in the match, then who reached that kill score
  first (the server tick of their latest kill), then a lot drawn from a hash
  (FNV-1a) of the match id and the player's id, so it is reproducible. Deaths
  don't count. Every player gets their own place, 1 to n. This is `rank` in
  `packages/shared/src/modes.ts`, run by the server when the match ends (a
  match that ends because too few players are left is ranked the same way);
  the places are synced (`Player.place`) along with why the winner won when
  it was level on kills (`tiebreak`: `damage`, `first` or `lot`, empty when
  it won outright). While the match runs, the HUD and Tab order players by
  kills, then damage. The result card says how a tie was broken ("Won on
  damage dealt", "Won by reaching 12 kills first", "Won on a coin flip").
  `packages/shared/src/modes.test.ts` tests `rank` (`bun run test`).
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
- **Stats**: FFA matches are recorded too. First place is a win,
  every other place a loss; each account player's place is
  kept on the match's `bagarre_matches` row, with the mode.

In a game: the HUD adds your rank ("2nd of 5 · 7 kills"), the top three, the
time left, a kill feed (killer, weapon, victim) and a minimap in the bottom
right corner (zones, cover, landmarks, you; enemies only show up when they
fire, as a dot fading over 1.5 s). Tab lists every player by place. The
waiting card lists who's in and says the match starts when 3 are in, then
counts down.

On the menu, **Free for all** quick-matches an FFA (joins an open one or
opens a new one), and **Private FFA** makes a private one. In dev,
`?play=ffa` skips the menu and quick-matches an FFA.

## Team deathmatch

Red against blue, up to 4v4 (8 players), on the three FFA maps, each split
into a red side and a blue side. The rules are `TEAM_RULES` in
`packages/shared/src/modes.ts` (constants `TEAM_*` in `constants.ts`).

- **Winning**: the first team to 25 kills (`TEAM_KILLS_TO_WIN`), or the team
  ahead after 8 minutes (`TEAM_TIME_LIMIT`). A tie at the limit goes to
  sudden death: the next team kill wins. It is capped like FFA's
  (`SUDDEN_DEATH_MAX`, 60 s); if nobody breaks the tie by then, the same
  tiebreaks as FFA decide on the team totals: the team's damage dealt (its
  players' damage, counted as it is dealt, so a player who left still counts
  for their team), then the team that reached the tied score first, then the
  lot. Never a draw. The result card says why ("Red won on damage dealt").
- **Start**: a 10 s countdown (`TEAM_COUNTDOWN`) once each team has 2
  connected players (2v2, `TEAM_MIN_PER_TEAM`). Players drop in mid-match up
  to 4v4; a 9th is refused like any full room.
- **Teams**: a joining player goes to the smaller team. On a tie, to the
  one with fewer players connected, then (mid-match) the one behind on kills,
  then red (`pickTeam`). While waiting, **Switch to Blue / Red** on the
  waiting card sends `MSG_TEAM` (`{ team }`, checked by `parseTeam`); the
  server allows it only if the sizes differ by at most one afterwards (so
  from the bigger team of an odd count: 3v2 becomes 2v3; never in a 2v2).
  Leaves that leave the teams lopsided (3v1) are evened out before the next
  match, moving the latest joiner. A reconnect keeps the team.
- **No friendly fire**: bullets fly through teammates, and grenades hurt
  neither teammates nor the thrower. One rule, `canDamage(attackerTeam,
  victimTeam, self)` in `packages/shared/src/combat.ts`, used by the server's
  bullets, blasts and `damage`, and by the client's predicted bullets (which
  only stop on players they can hurt), so a predicted bullet never "hits" a
  teammate. In a duel or FFA every player is `NO_TEAM`, for which it is
  always true (your own grenade included), so those modes play as before.
- **Kills** count for the killer and for their team (`redScore` /
  `blueScore` in the synced state); `winningTeam` is set at the end. If every
  player of a team leaves mid-match, the other team wins.
- **Spawns**: each team starts and respawns on its own side, out of every
  enemy's sight first (`ffaRespawnPoint` on the side's spawns, against the
  living enemies; `ffaStartSpawns` per side at the start). The sides are
  additive map data: `teams` on an `FfaMapDef`, two `{ name, spawns }` whose
  `spawns` are indices into the map's own 16 FFA spawns (Crossroads and
  Bastion: West / East, Freight: North Quay / Container Yard). `TEAM_MAPS` is the
  FFA maps that have them, `teamSpawns(map, team)` a side's spawns.
  `bun scripts/ffa/validate.ts` (in `packages/shared`) checks them next to
  the FFA checks: valid and disjoint indices, at least 6 spawns a side, the
  same mean and closest distance to the hub (within 1 m), and no spawn within
  10 m of an enemy one.
- **Stats**: the recorded match gets `mode: "tdm"` and each account player's
  `team`: a win for every player on the winning team, a loss for the others.
  Every player gets their own place: the winning team's players first, then
  the others, each team in `rank` order of its players' own kills,
  damage and so on (so 1st to 4th are the winners of a 4v4, 5th to 8th the
  losers).

In a game, the team colours (theme `--bagarre-p6` red and `--bagarre-p7`
blue, paint 6 and 7 in `apps/client/src/paint.ts`) replace the seat colours
everywhere: the wide ring under each character (the skins keep their own
colours), the HP bar, the kill feed, the scoreboard, the minimap. Names tell teammates
apart. The HUD shows the team score ("RED 12 – 9 BLUE", your team outlined,
"You're on Red"), the time left and the kill feed; the minimap always shows
your teammates, and enemies only when they fire, as in FFA. The waiting card
lists both teams side by side with the switch button, then counts down. Tab
and the result card group the players by team under each team's score, with
the team's deaths; the result reads "Your team wins!" or "Your team lost", plus how a tie was
broken if it was. Spectators get the team colours in the player list and the team score
in the phase line.

On the menu, **Team deathmatch** quick-matches one and **Private teams**
makes a private one. The open games list shows the mode and the team counts
("Team deathmatch · 3v2 (5/8)"). In dev, `?play=tdm` skips the menu.

The e2e spec is `apps/e2e/tests/teams.spec.ts`, the smoke checks
`apps/server/smoke-teams.ts`.

## Battle royale

Last one standing, 2 to 10 players, every one for themselves, one life
each. The rules are `ROYALE_RULES` in `packages/shared/src/modes.ts` (with
`royale: RoyaleRules`, the zone's timings), the numbers `ROYALE`, `ZONE` and
`LOOT`, and one definition per healing item (`HEAL_ITEMS`) in
`constants.ts`, and the pure rules (gun slots, grenade stacks, healing and
shield charges, the zone, the loot draw) in `packages/shared/src/royale.ts`.
`bun run test` runs their tests
(`src/royale.test.ts`: the ranking, the zone over time, the stacks, the
slots, the loot, the maps' crate spots; `src/heal.test.ts`: the heals,
what cancels them, the stacks and the shield charges; `src/maps/royale/royale-maps.test.ts`:
the royale map's layout, see [docs/royale-maps.md](docs/royale-maps.md)).

- **Start**: a 15 s countdown once 2 are in (more can join during it), then
  a 5 s pre-match (the warmup) with nothing to pick: everyone has the
  **Pistol** (a weak starting gun, `pickable: false`: it is in no loadout
  picker and can't be picked in the other modes) and no grenades. Nobody can
  join once it started (the room locks itself, `closedToJoins`); watching
  still works.
- **The map**: Ironvale, a 90 x 90 m mining town in the snow, the only map
  in the royale pool (`ROYALE_MAPS`, [docs/royale-maps.md](docs/royale-maps.md)).
- **Crates**: the map lists crate spots (`MapDef.royale.crates`, 23 on
  Ironvale). A crate stands on each at the start; walking into one
  breaks it and drops one item drawn from `LOOT` by weight: a gun with a
  full magazine, a stack of grenades, bandages (common), a medkit (rare) or
  a shield charge.
- **Items on the floor** (`state.items`: kind, which one, how many) are the
  server's (`apps/server/src/floor.ts`): each tick every item goes to the
  nearest living player who can take it, so two players on one item never
  both get it. At most `ROYALE.maxItems` (the oldest goes); cleared with the
  match. What a player just dropped can't be taken back before they step off it.
- **Three gun slots** (`Player.kit`, a child schema, KitSim in
  `protocol.ts`): 1-3 or the mouse wheel switch (the wheel skips empty
  slots), a switch waits 0.3 s before the gun fires and cancels a reload,
  and every gun keeps its own magazine. Walking over a gun fills a free slot
  (not one you carry already); with all three full, **F** swaps it with the
  gun in hand, which drops. A switch is an input (`InputMessage.slot` and
  the `switch` press counter) that the shared step applies, so the client
  predicts it and fires the new gun at once; a pickup or a swap reaches the
  prediction in the next snapshot's kit.
- **Grenades** are counted, one type at a time, up to the type's `stack`
  (frag 3, the others 2). The same type adds up, another type swaps in and
  the old stack drops. A throw uses one, with a 1 s gap between two.
- **Healing**: health never comes back on its own. **4** uses a bandage
  (+25 HP in 1.5 s, up to 5 carried), **5** a medkit (back to 100 in 4 s, up
  to 2); never past 100, and not at full health. Meanwhile you walk at half
  speed and can't dash, and a ring fills round you that everyone sees. A
  shot, a throw, a gun switch (or F swap), or damage to your HP (the zone's
  included; what the shield soaks doesn't count) cancels it: nothing healed,
  the item kept. The heal is an input (`InputMessage.heal` and the `use`
  press counter) the shared step runs, with the heal in progress in the kit
  (`kit.heal`, `kit.healTicks`) and health in `PlayerSim`, so the client
  predicts the slowdown and never jitters; the server cancels on damage.
  On the tick a heal completes it comes first: every input of a tick runs
  before bullets, blasts and the zone, so a heal is never applied twice
  and never used up without healing. The HUD says how each heal ended.
- **Shield charges**: the shield (E) uses a charge instead of its 10 s
  cooldown, up to 3 carried, none at the start. The next one can only go up
  1 s after the last bubble ended (`ROYALE.shieldGap`), so charges never
  chain into one long bubble. Raising it doesn't cancel a heal.
- **The zone** (`state.zone`: start and end centre and radius, start and end
  tick) covers the whole map, waits 30 s, then shrinks smoothly to nothing at
  4:30, round a centre drawn from the match id inside `MapDef.royale.zone`.
  Outside it you lose HP every tick (2 per second at first, 14 once closed:
  `zoneDamage`, whole HP from the integral of that rate). Server and client
  compute the circle with the same `zoneAt`. A zone death reads "Zone" in
  the kill feed, with no killer.
- **Knocked out** (killed, the zone, or leaving): no respawn, your guns (not
  the Pistol), grenades, healing items and shield charges drop where you fell, and you watch the rest from
  your seat: the camera on your killer (or the nearest player still in after
  a zone death), Q / E to cycle through the players still in, the
  spectator's other keys and the Esc menu to leave. A player who leaves, or
  whose connection grace runs out, is knocked out then; their seat stays
  until the result is over, so their place is shown and recorded.
- **The end**: when one player is left standing (checked at the end of the
  tick, so players out on the same tick are ranked together), or none.
  Places are the order of knock-out, the last one out 2nd (`rankRoyale`);
  players out on the same tick are split by kills, then damage, then the lot.
- **Stats**: like FFA, 1st place is a win and every other place a loss,
  kept on `bagarre_matches` with `mode: "royale"`. A royale that started
  with fewer than 3 players isn't recorded (`ROYALE_MIN_RECORDED`): with two,
  one kill would be a win. The result card says which.

In a game the HUD shows who is still in and the zone's timer (top right),
the three slots with their magazines in place of the weapon box, the
bandages and medkits, the grenade and shield charge counts, the heal in
progress (or how it ended), and an arrow back to the zone when you are outside; the ground shows
the zone's edge with a tint outside, the crates and the items. On the menu,
**Battle royale** quick-matches one and **Private royale** makes a private
one; in dev, `?play=royale`. The e2e spec is `apps/e2e/tests/royale.spec.ts`.

### Rooms and modes

One room class plays every mode: `GameRoom` (`apps/server/src/GameRoom.ts`),
driven by the mode's rules (`ModeRules` in `packages/shared/src/modes.ts`:
seats, start threshold, teams, kill target, time limit, countdown, warmup, respawn
delay, result delay, drop-in, map pool, royale). `DuelRoom`, `FfaRoom`,
`TeamRoom` and `RoyaleRoom` only pick the rules, and are registered as the
`duel`, `ffa`, `tdm` and `royale` room types. The simulation
(inputs, bullets, grenades, damage) is shared; the mode shows up in a few
places only: spawns, respawns, what a leave does, and the end conditions.
`GameRoom.pinnedTo(mapId)` pins a room class to one map of its own pool
(`createServer({ mapId, ffaMapId })`), `GameRoom.withRules({...})` tweaks the
rules (the smoke test's short countdown, time limit and warmup), and the dev
`?map=<id>` works in both modes, for that mode's maps only.

Map lookup: `findMap(id)` searches the duel and FFA maps and returns null for
an unknown id. The client resolves the synced `mapId` with it and logs an
error rather than silently drawing Yard; `mapById` (which falls back to Yard)
is only for display. A room only ever picks from its own pool.

Every match goes `waiting` -> `warmup` -> `playing` -> `ended`. The warmup
(`WARMUP_SECONDS`, 8 s, per mode in `ModeRules.warmup`; 0 skips it) puts
everyone on their start spot with the loadout picker open and a "Match
starts in N" timer: players move and dash, and a pick (weapon and grenade
type) is in hand at once with a full magazine, but nobody can shoot, throw
or raise the shield, and no damage is dealt (`playerCan` in combat.ts, the
same rule on the server and in the client's prediction). The match clock,
the time limit and the "first to the score" tiebreak start when it ends
(`startTick`). Its end is synced as a tick (`warmupEnd`), so every client,
a reconnected one included, shows the same timer. A player leaving during
warmup below `minToContinue` sends the room back to waiting, with no result.

The synced state (`GameState`) carries the mode, the kill target, the time
limit, the countdown, the warmup's end tick, the sudden death flag and the kill feed (the last 5
deaths, with names and seats copied so a line stays readable after its
players leave).

### Seats and clients

A client is not a player. A **seat** is a player: an entry in
`state.players` plus its server-side bookkeeping, and the seat number is the
player's `slot` (its colour outside a team mode, 0-5, and its bullet ids; 0-7
in a team deathmatch). A seat is taken in
`onJoin`, kept through a dropped connection (`onDrop` / `onReconnect`, 20 s)
and freed in `onLeave`.

- The player cap is on seats, never on `maxClients`: `maxClients` is the
  seats plus `SPECTATOR_ROOM` (20), the room left for spectators.
- `GameRoom.hasReachedMaxClients()` counts seats taken plus seats promised
  to joins in flight, which refuses a player's reservation past the cap (two
  joins racing for the last seat are settled there). The room locks itself
  by hand (`updateSeatLock`) while every seat is taken, so quick match skips
  it and a join by id says "This game is full", and unlocks when a seat
  frees. By hand, because Colyseus' own lock is lifted by any client
  leaving, a spectator included.
- A client that joins with `spectate: true` (`wantsSeat()` false) is a
  spectator: see [Spectating](#spectating).

## Spectating

Anyone can watch a game without playing in it: a friend's duel from its
link, or a free for all under way. Spectators see everything: the full
state, no delay, the whole map in every mode (decided: it's a game for
friends, so nothing stops a spectator from calling out positions).

- **Getting in.** The open games list shows **Watch** on full games and on
  duels under way, which opens `/game/<code>/watch` (the route file is
  `routes/game.$code_.watch.tsx`: the `_` keeps it from nesting under the
  player page, which would join as a player first). That page joins through
  `POST /games/<code>/watch` on the game server: it runs the room's `onAuth`
  like any join, then reserves a place with `spectate: true` (set by the
  server, never read from the request) through `matchMaker.reserveSeatFor`,
  which checks the client slots but not the lock. A spectator's reservation
  skips the seat count (`GameRoom.admitting`). The client consumes the
  reservation like a join.
- **In the room** a spectator is a session id in `spectators`, never an
  entry in `state.players`: nothing is spawned, and every handler (input,
  weapon pick, ping) drops their messages quietly, before parsing, without
  closing the connection (the flood limit still applies). They are not
  counted for the seat cap, the match start, the listing's `players` or the
  rematch. `state.spectators` (synced) and the metadata's `spectators` count
  them; players see the count small in the HUD's bottom-left corner
  ("👁 2") when anyone is watching.
- **Rematches and map changes** only touch players, so spectators stay.
- **Taking a seat.** "Join the game" shows while a seat is free and sends
  `MSG_TAKE_SEAT`; the room moves the session into a new player through the
  same code as a join (`seat()`), so the same connection becomes a player
  and the page is replaced with `/game/<code>`. A duel only has a free seat
  while waiting; a free for all takes them mid-match (drop-in). Refused
  silently for a player, with no free seat, or mid-duel. Two joins racing
  for the last seat are settled at the reservation (the second is told the
  game is full); should one still arrive with every seat taken, it is
  seated as a spectator, and its page moves to the watch page.
- **Reconnection** works as for players: `onDrop` gives spectators the same
  grace period, so the SDK's retry and a reload's resume (the
  sessionStorage token) both bring them back watching.
- **An empty room**: spectators alone keep a room alive, so after
  `SPECTATOR_IDLE_S` (60 s) with no player it closes with `CLOSE_NO_PLAYERS`
  (4012), which the client shows as "The game ended".

The client (`apps/client/src/spectate/`): a spectator's `Match` runs with
no local player: no prediction, nothing sent (`Net.sendInput` refuses too),
everyone interpolated like a remote player. The camera and the sound
listener come from the `Spectator` (`spectator.ts`, `camera.ts`,
`model.ts`), which has three modes: **Follow** (the default in a duel)
glides after a player and, when they die, moves on to their killer (read
from the synced kill feed) or the leader; **Overview** (the default in FFA)
fits the whole map; **Free** pans with WASD or a drag and zooms with the
wheel. The game's own input is off for the whole session, so Q / E and ← / →
switch players and 1 / 2 / 3 pick the camera mode (`controls.ts`) without
ever reaching the server. Tab still holds the scoreboard, Esc opens the
match menu ("Stop watching"), M mutes. The overlay is
`spectate/ui/` (top bar, player list, the phase line between matches).

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
| **1**-**7**        | Pick a weapon, while dead or between matches (see below). Battle royale: **1**-**3** and the wheel switch gun slots |
| **F**              | Battle royale: swap the gun in hand for the one on the floor  |
| **4** / **5**      | Battle royale: use a bandage / a medkit                       |
| **G**              | Next grenade type (frag, smoke, stun, flash, heal), same rules |
| **Tab** (hold)     | Scoreboard                                                    |
| **M**              | Mute / unmute sound (remembered between visits)               |
| **Esc**            | Match menu: resume, settings, leave (the match keeps running) |

Keys are read by physical position, so on AZERTY it's ZQSD to move and the
key labelled **A** throws a grenade. In a duel, first to 5 kills wins; the
match restarts a few seconds later (free for all: see above).

A grenade lands, then goes off 0.6 s later: the circle on the ground shows
where (red for a frag, grey smoke, blue stun, white flash, green heal), so get out of it.
A frag hurts its thrower too, at half rate. The dash has no invulnerability,
you dodge by getting out of the bullet's path.

### Grenade types

You carry one grenade, on Q, and pick its type next to your weapon: on the
waiting and result cards, or with **G** while dead. Like a weapon, the pick
goes in your hand on your next spawn (a grenade already in the air keeps its
type), and a reconnect keeps it. Each type has its own cooldown, shown on the
HUD's grenade slot with its icon. They all share the same throw; only what
happens when they go off differs.

| Type  | What it does | Cooldown |
| ----- | ------------ | -------- |
| Frag  | 3.5 m blast, 60 → 15 damage (half on yourself). The only one that hurts, and the only "Grenade" in the kill feed | 8 s |
| Smoke | A 4 m cloud for 8 s. Whoever is in it, or behind it, is hidden from their enemies: model, name plate and health bar, minimap dot, muzzle flash, and their bullets until they come out of it. Shots and steps are still heard; the kill feed still names them. You always see yourself and your teammates. The thrower and their team (only the thrower in a duel or free for all) see through their own cloud: enemies in or behind it are drawn faded, and their shots and bullets show; if any other cloud is in the way, they are hidden as usual. A spectator sees them faded | 12 s |
| Stun  | Everyone within 3.5 m walks at half speed and can't dash for 2 s (a spark effect on them, a badge on their HUD) | 10 s |
| Flash | A white screen, up to 2 s, for anyone with no cover in the way: shorter the farther away, and shorter the farther off their aim (with their back turned they still get 30% of it, so a far, turned-away player may get nothing). Behind cover is safe. A plain fade, never a strobe | 10 s |
| Heal  | +40 HP at once (never over 100, the shield untouched) for the thrower and their teammates within 3.5 m, with no cover in the way. Never an enemy, never a dead player; in a duel or a free for all it only heals you. A green glow on whoever it heals | 14 s |

Who a stun or a flash gets follows the friendly-fire rule (`canDamage`): in
a team deathmatch never a teammate nor the thrower; in a duel or a free for
all, your own gets you too. The heal is the other way round (`self ||
sameTeam`, its "allies"): you and your teammates only.

How it works:

- The table is `GRENADES` in `packages/shared/src/constants.ts` (with
  `SMOKE`, `STUN`, `FLASH` and `HEAL`; each type names its `effect`, which picks the
  server's handler), the looks are `GRENADE_VIEW` in
  `apps/client/src/items.ts` (see [Adding a gun or a grenade type](#adding-a-gun-or-a-grenade-type)), the rules in `grenades.ts` next to it:
  `flashTicks` (angle, distance, and `lineOfSight`, the new
  segment-against-cover test in `physics.ts`), `healAmount` (radius, cover,
  capped at `MAX_HP`, nobody dead), `smokeCover` (in a cloud, or
  the line to them crosses one: `segmentHitsCircle`; "own" when every cloud in the
  way is the viewer's side's, `ownsCloud`, else "foreign") and `smokeVeil` (who
  sees whom: none, faded or hidden). `bun run test` runs their tests
  (`packages/shared/src/grenades.test.ts`).
- The stun is `stunTicks`, part of the synced `PlayerSim`: the shared
  `stepPlayer` reads it (half speed, no dash) and counts it down once per
  input, so the stunned player's own prediction slows down exactly like the
  server and nothing rubber-bands.
- The flash is resolved by the server when it goes off, from each player's
  aim at that moment; `flashEnd` / `flashTicks` on `Player` are synced so the
  white screen matches.
- Smoke clouds are synced (`state.smokes`, with the thrower's `owner` and `team`), but the hiding is done by each
  client, and only there: the server sends every position to everyone. That
  is accepted (a game between friends, no anti-cheat), so smoke is not
  secure against a modified client.
- Picks go through `MSG_PICK` (`{ weapon?, grenade? }`): a field that is
  there must be valid or the whole message is dropped.

Sound starts after your first click or key press (browser autoplay rules):
any menu button counts. Settings (on the menu, or from Esc in a game) has the
master volume, the music volume and mute; all are remembered.

Music: one track on the menu and the Maps page, and a random one of four
(never the last game's) while a match is on, crossfading between them. It
fades out when a match ends, so the win or lose sting is heard. The songs
were made with Suno on its free plan, so unlike the CC0 sound effects they
are for non-commercial use only: see
[apps/client/public/music/CREDITS.md](apps/client/public/music/CREDITS.md)
(rebuilt with `bun run music:build <folder>` in `apps/client`).
`__bagarre.music` gives the tests the music's mood and track.

Every character carries a plate over its head: the other players' name (in
their seat or team colour) over a health bar, with the shield's remaining
absorb as a light blue strip under it; yours is the bar alone. A plate hides
while its player is dead and dims with a "…" while they reconnect; a
spectator sees everyone's. **Show names** in Settings turns the names off
(the bars stay), remembered like the sound settings. The plates are drawn in
the 3D scene over everything (`plates.ts`); `__bagarre.plates` exposes them
to the tests, and `__bagarre.skins()` gives each player's skin and whether
its model has loaded (`{ [sessionId]: { skin, loaded } }`, for the match
you play or watch). `__bagarre.veils()` says how smoke has each player drawn
for us (`none`, `hidden` or `faded`), and `__bagarre.minimapPings` who has a
dot on the minimap; `__bagarre.bot.target` is where the bot throws.

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
| 5   | Revolver | 34      | 0.45 s        | 70 m/s       | 20 m  | 0°     | 6        | 2.2 s  | Precise mid range, 3 hits (0.93 s) |
| 6   | Burst pistol | 3 × 12 | 0.45 s per burst, 0.06 s per round | 42 m/s | 15 m | 2.9° | 15 | 1.2 s | One click = 3 rounds, 3 bursts (1.07 s) |
| 7   | DMR     | 40       | 0.57 s        | 80 m/s       | 26 m  | 0.6°   | 8        | 2.0 s  | Semi-auto marksman, 3 hits (1.13 s) |

The burst pistol fires 3 rounds per click. A started burst finishes even if
you let go of the button, unless the magazine runs dry, a reload starts or
you die; holding the button fires a burst every 0.45 s. It lives in the
shared step (`stepPlayer`, the `burstLeft` sim field), so the client predicts
each round exactly; every round comes from its own input, so bullet ids
(`slot:seq:pellet`) stay unique.

| Ability | Numbers                                                                 |
| ------- | ----------------------------------------------------------------------- |
| Dash    | 5 m in 5 ticks (0.17 s), 3 s cooldown, stops at walls and cover          |
| Grenade | 10 m max range, 0.6 s fuse after landing; frag: 3.5 m radius, 60 → 15 damage (half on yourself), 8 s cooldown; other types: see [Grenade types](#grenade-types) |
| Shield  | 2.5 s, absorbs up to 40 damage, 10 s cooldown                             |

All of these live in `packages/shared/src/constants.ts`, one table per weapon and
ability, so balancing is a one-file change.

### Adding a gun or a grenade type

Each item is described once, in its shared definition, and once more for its
looks, in the client. Nothing is matched by position.

- **Gun:** append a line to `WEAPONS` (`packages/shared/src/constants.ts`)
  with a new `key`. Firing, spread, bursts and reloads are generic, so the
  server needs nothing. Then give that key an entry in `GUN_VIEW`
  (`apps/client/src/items.ts`: model, scale, muzzle flash, shot sound, How to
  play line), add its model under `public/models/guns/` and its sound to
  `audio.ts`. The number keys, the HUD and How to play follow `WEAPONS`
  (up to 9 guns, keys 1-9; a `pickable: false` gun, like the royale's
  Pistol, has no key and never shows in the picker, and goes after the
  others). To have crates drop it in the battle royale, give it a weight in
  `LOOT`.
- **Grenade:** append a line to `GRENADES` with a new `key`, its `effect`
  (`damage`, `cloud`, `stun`, `flash`, `heal`) and who it `affects`
  (`enemies` or `allies`). Then give it an
  entry in `GRENADE_VIEW` (`items.ts`: icon, telegraph colour, blast sound,
  blast drawing, How to play line). A new effect also needs its tuning
  block, a `GrenadeEffect` member and a handler in `blastEffects`
  (`apps/server/src/GameRoom.ts`). Its `stack` is how many one player
  carries in the battle royale; a weight in `LOOT` makes crates drop it.
- **Ids are append-only.** An item's index is its id on the wire (picks,
  `Player.weapon` / `Player.grenade`, `Grenade.kind`, the kill feed): never
  reorder, rename or remove one. Append the new key to `WEAPON_IDS` or
  `GRENADE_IDS` in `packages/shared/src/items.test.ts` (and a new
  effect or `affects` value to its `EFFECTS` / `AFFECTS` lists); `bun run test`
  fails if the order changes. A missing view entry or effect handler is a
  compile error (the tables are `Record`s keyed by item key or effect).

## Maps

Each match is played on a random map, never the same one twice in a row. The
map changes only between matches (both players go to the new map's spawns),
and its name and a one-line blurb show at the top of the screen for a few
seconds when the match starts. A room's first match stays on the map the room
was created on, so a player waiting alone is already on it.

| Map (`id`)    | Size    | Plays like                                          | Favours          |
| ------------- | ------- | --------------------------------------------------- | ---------------- |
| Yard (`yard`) | 30 x 30 | The original: open, a different bit of cover in each corner | rifle, SMG |
| Runway (`runway`) | 40 x 28 | A long airstrip: low cover at the terminal, hangars and a fuel depot at the far end | sniper, rifle |
| Trenchworks (`trenchworks`) | 28 x 28 | Sandbag trenches round a broken crater | shotgun, SMG |
| Fort (`fort`) | 32 x 32 | A brick blockhouse with a guardroom annex and four offset doors | rifle, SMG |
| Dockside (`dockside`) | 36 x 28 | Three lanes: tall container stacks on one side, crates and barrels on the other | rifle, SMG |
| Nest (`nest`) | 30 x 30 | King of the hill: a lopsided sandbag nest, a trench on one side, crate hops on the other | rifle, shotgun |
| Scrapyard (`scrapyard`) | 34 x 30 | A maze of low junk walls on one side, open ground and big wrecks on the other | SMG, shotgun, rifle |

You respawn on a spawn the opponent can't see if there is one, else on the one
farthest from them. No map is mirrored: each side is built its own way and
the validator measures that both get the same deal. The maps are plain data in `packages/shared/src/maps/`;
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
                      walking around a map without a server (walk.ts);
                      stores: app.ts (flow), lobby.ts, auth.ts (account), hud.ts, scoreboard.ts (model);
                      routes/ (TanStack Router pages), ui/ (React + Astryx views, theme/)
    public/           models (glTF, meshopt-compressed), particle atlas and sounds, see ASSETS.md;
                      music/ (Suno, non-commercial, see its CREDITS.md); og/ (link preview images)
    seo/              each page's title, description and link preview tags (meta.ts), and the
                      Vite plugin that writes them into the HTML, robots.txt and sitemap.xml (plugin.ts)
    scripts/          asset rebuild scripts (assets/, sfx/, music/, og/: the link preview images)
  server/             @bagarre/server: Colyseus on Bun
    src/              the Colyseus room for every mode (GameRoom: DuelRoom, FfaRoom, TeamRoom), synced state schema,
                      accounts (db.ts, accounts.ts, auth.ts), bootstrap and the GET /games route (app.ts)
    smoke.ts          headless end-to-end test (smoke-accounts.ts: its account part, smoke-ffa.ts: the free for all)
packages/
  shared/             @bagarre/shared: TypeScript source, no build step
    src/              constants and balance tables, the maps (maps/) and the Arena shape,
                      message types, the pure step functions (physics.ts: movement/bullets,
                      combat.ts: the player step with dash, weapons, abilities,
                      grenades.ts: what each grenade type does),
                      line of sight and the respawn rule (sight.ts)
    scripts/          map validator and preview renderer
docs/                 design notes (maps.md)
turbo.json            task graph and caching
```

`@bagarre/shared` is an "internal package": its
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

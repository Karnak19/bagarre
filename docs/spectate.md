# Spectator mode

> **Status: implemented** on `feat/ffa` (after the FFA work), and described
> for users in the README's "Spectating" section. The plan below is kept as
> it was written against `main`, before FFA; where the wiring went another
> way, it is listed here.
>
> **Deviations from the plan**
>
> - **The room** is `GameRoom.ts` (both modes), not `DuelRoom.ts`. Capacity
>   is the existing `SPECTATOR_ROOM` (20) on top of the seats, not a new
>   `MAX_SPECTATORS = 8`.
> - **The seat lock**: `hasReachedMaxClients()` still counts seats (so a
>   player's reservation is refused past the cap), but skips the seat count
>   while a spectator's reservation goes through (`admitting`, set by a
>   wrapper round Colyseus' private `_reserveSeat`, which is where both the
>   route's `reserveSeatFor` and `joinById` end up). The lock is also set by
>   hand (`updateSeatLock`, on every seat change and once a second), since
>   Colyseus lifts its own lock whenever any client leaves, a spectator
>   included. Held reconnections are no longer counted as promised seats.
> - **One way in**: the client always watches through
>   `POST /games/:roomId/watch`, whether the room is locked or not, instead
>   of trying `joinById` first. `joinById(id, { spectate: true })` still works
>   on an unlocked room. The route answers 404 for a missing room and 409 when
>   even the spectator places are taken.
> - **No `MSG_KILL`**: the camera's switch to the killer reads the kill feed
>   the FFA work already syncs (`state.feed`): the entries newer than the last
>   snapshot become `SpectateSnapshot.kills` (a self-kill names the victim, so
>   the model reads it as "no killer").
> - **One `Match` for both roles** rather than a spectator variant: with no
>   local player it predicts and sends nothing and interpolates everyone; the
>   `Spectator` is made on the first snapshot we aren't in (so the mode's
>   Follow zoom and default camera are known), and taking a seat flips back
>   to the player path on the same match (the frustum is reset once).
>   `Net.role` comes from each snapshot. The camera follows the followed
>   player's drawn mesh, so there is no `samplePlayerInto`.
> - **`scene.ts` is unchanged**: `sceneRig` still writes the frustum itself
>   (only when the view height or the window size changes), and a window
>   resize is picked up on the next frame.
> - **Open games**: `OpenGame` gained `spectators` and `joinable` (no
>   `watchable` field: every listed game can be watched). A row is either
>   **Join** (a free seat you can take now, including a free for all under
>   way) or **Watch** (full, or a duel under way); a running FFA with a free
>   seat is joined, not watched, from the list (its watch link still works).
> - **Not done** (see "Next steps" below): the lost-seat-race notice on the
>   client, the invite panel's "Copy watch link", the Playwright checks, and
>   smoke check 7 (the race itself).
>
> **Next steps**: a "Copy watch link" on the waiting card; the one-line
> notice when a player is seated as a spectator after a lost race; the kill
> feed in the spectator overlay; the Playwright checks listed at the end.

Watching a game without playing in it: a friend's duel from its link, or an
FFA already under way. This file is the contract the room has to honour and
the plan for wiring it in. The client pieces already exist in
`apps/client/src/spectate/`, written against nothing that is still moving;
the room, `net.ts`, `match.ts`, `engine.ts`, `app.ts`, the HUD and the routes
are wired once the FFA restructuring (modes and the seat model) has landed.

## What is already there

| File | What it is |
| --- | --- |
| `spectate/model.ts` | Pure view-model. Scoreboard order, the leader, who to follow, the switch when the followed player dies (to the killer, else the leader, after `AUTO_SWITCH_DELAY_MS`), cycling with Q / E, and the UI model (rows, "watching", seats, spectator count). Reads any `Map`-like of player fields, so a `Snapshot` from `net.ts` fits as it is. |
| `spectate/model.test.ts` | `bun test apps/client/src/spectate`: the model plus the camera maths. |
| `spectate/camera.ts` | `SpectatorCamera`, which has three modes: **Follow** (glides after a player), **Overview** (fits the whole map), and **Free** (WASD, drag and wheel, kept over the map). It goes through a two-method `SpectatorCameraRig` (`apply(x, z, viewHeight)` and `viewport()`); `sceneRig(scene)` adapts the `GameScene`. Glides are exponential smoothing; `prefers-reduced-motion` cuts instead. `update()` allocates nothing. |
| `spectate/controls.ts` | `installSpectatorControls({ canvas, actions, enabled })`: Q / E and ← / → cycle, 1 / 2 / 3 pick the mode, WASD pans (it switches to Free), drag pans, wheel zooms (Free only). Returns the uninstaller. |
| `spectate/spectator.ts` | `Spectator`: model state plus camera plus a `Store<SpectateUiModel>` for React. `onSnapshot(snap, now, reset?)` goes per snapshot, `frame(now, dt, position)` per frame, and the actions are `follow`, `cycle`, `setMode`, `pan`, `drag` and `zoom`. |
| `spectate/ui/SpectatorOverlay.tsx` | The top bar (`SpectatorBar.tsx`) and the clickable player list (`PlayerList.tsx`). Its props are `store` (the spectator's UI store) and `actions` (`follow`, `setMode`, `join`, `leave`). |
| `spectate/bun-test.d.ts` | The few `bun:test` types the test needs, since the client has no bun-types. |

Test ids: `spectate-bar` (with `data-mode`), `spectate-watching` (with
`data-name`), `spectate-mode` and `spectate-mode-{follow,overview,free}`,
`spectate-hints`, `spectate-count` (with `data-count`), `spectate-join`,
`spectate-leave`, `spectate-players`, `spectate-players-empty`, and
`spectate-player` (with `data-id`, `data-followed`, `data-alive`,
`data-connected` and `data-leader`).

## Server contract

Everything here goes in the room (`DuelRoom.ts`, or its FFA successor with
the seat model) and in `packages/shared`.

### Constants and messages (`packages/shared/src/protocol.ts`, `messages.ts`)

```ts
/** Watchers per room, on top of the seats. */
export const MAX_SPECTATORS = 8;
/** Spectator → room: take the free seat. Payload `{}`. */
export const MSG_TAKE_SEAT = "seat";
/** Room → everyone: a kill, for the kill feed and the spectator's "switch to the killer". */
export const MSG_KILL = "kill"; // { victim: sessionId, killer: sessionId }  (killer === victim: self-kill)
/** Close code: the room has had no players for SPECTATOR_IDLE_S. 4011–4999 are ours. */
export const CLOSE_NO_PLAYERS = 4012;

export interface JoinOptions {
  // ...existing fields
  /** Join as a spectator: no seat, no player, no inputs. */
  spectate?: boolean;
}

export interface RoomStateView {
  // ...existing fields
  /** Spectators connected right now (synced, uint8). */
  spectators: number;
}

export interface RoomMeta {
  // ...existing fields
  spectators: number;
  /** Seats in this room: 2 for a duel, the mode's cap in FFA. */
  maxPlayers: number;
}
```

`messages.ts` gets `parseTakeSeat(raw)`, which accepts only a plain object
and ignores its fields.

### Joining as a spectator

- **Two ways in.**
  - While a seat is free the room is unlocked, and `joinById(roomId, { spectate: true })` works as it does today.
  - When the seats are full the room is **locked** (see below), and `joinById` on a locked room fails: `MatchMaker.joinById` throws `room "…" is locked`. So spectators come in through an HTTP route, `POST /games/:roomId/watch`. It runs the room's `onAuth` on the `Authorization` header, then calls `matchMaker.reserveSeatFor(listing, { spectate: true }, authData)`, which is exported and checks only `hasReachedMaxClients()`, not the lock. It returns the reservation, and the client calls `client.consumeSeatReservation(reservation)`. The endpoint sets `spectate: true` itself, so a player can't reach a locked room this way.
- **Why the seat lock stays**: quick match is `joinOrCreate`, and `findOneRoomAvailable` only filters on `locked`, `private` and `filterBy` options. If rooms with every seat taken stayed unlocked for spectators, quick match would drop players into them. The lock keeps meaning "no free seat", so quick match and the open games list keep working unchanged.
- **Capacity**: `maxClients = seatCap + MAX_SPECTATORS`. The room calls `this.lock()` itself when the last seat is taken, and `this.unlock()` when a seat frees up (a player's `onLeave`). A lock set by hand stays until it is lifted by hand, and Colyseus still auto-locks at `maxClients`, which means the spectator slots are full too.
- **A lost seat race**: two players can both reserve the last seat before the lock lands. `onJoin` counts the players, and if a non-spectator arrives with every seat taken it seats them **as a spectator** instead of throwing. Their client sees that it isn't in `state.players` and shows the spectator view with a one-line notice: "The seat was just taken, you're watching."
- **Identity**: spectators pass through `onAuth` like everyone else, so a spectator who takes a seat has their account name.

### What a spectator is in the room

- A set of session ids, `spectators: Set<string>`, and **not** an entry in `state.players`. No `Player` is created and nothing is spawned. The client works out its role from `state.players.has(room.sessionId)`.
- `state.spectators` holds its size, updated in `onJoin`, `onLeave` and `MSG_TAKE_SEAT`. The metadata gets it too (`syncListing`).
- **No inputs**: `MSG_INPUT`, `MSG_PICK` and `MSG_PONG` return at once when `spectators.has(client.sessionId)`, before any parsing. That is already the effect today, because `internals.get()` is undefined, but make it explicit so the check doesn't hang on an accident. The message is dropped, the client is **not** disconnected, and the flood limit (`maxMessagesPerSecond`) still applies.
- **Latency probes**: `probeLatency` already skips clients without internals. Spectators don't get pings.
- **Not counted**:
  - match start (`bothConnected`, or the FFA mode's own start rule), the listing's `players`, `resetScoreboard` and `startMatch` all read `state.players`;
  - `openGames()` in `apps/server/src/app.ts` must stop using `r.clients >= MAX_PLAYERS` (spectators count in `clients`) and use `meta.players < meta.maxPlayers`.
- **Reconnection**: in `onDrop`, a spectator gets `allowReconnection(client, reconnectGrace)` too, so the SDK's automatic retry works. They hold no state. `onReconnect` needs nothing, and `onLeave` removes them from the set.
- **An empty room**: spectators keep `clients` above 0, so `autoDispose` never fires. When `state.players.size === 0` for `SPECTATOR_IDLE_S` (60 s), the room calls `this.disconnect(CLOSE_NO_PLAYERS)`. Any spectator can take a seat in the meantime.

### Full state, not a StateView

Spectators get the same full state as players. There are three reasons:

1. There are no `@view()` fields today. The skill's guidance is that a single `.view()` field anywhere in the tree switches the whole room from "encode once, send to all" to encoding per client, and the room already sends one hand-timed patch per tick (`patchRate = null`).
2. Players already receive every player's position. There is no fog of war (`sight.ts` is only for respawns and the map tools), so a spectator learns nothing a player's own client doesn't already have.
3. Overview mode needs everything anyway.

So there is no filtering, and `client.view` is never set. Ghost-calling is accepted on purpose (see "Settled: spectators see everything" at the end).

### Taking a free seat

- `MSG_TAKE_SEAT`, from a spectator, while a seat is free. In a duel it is accepted in any phase: a free seat means the room is `waiting`. In FFA, the mode's join-in-progress rule decides.
- The room moves the session from `spectators` into a new `Player`, through the same code as a player's `onJoin`. Pull that out into `seat(client, identity)`. Then `syncListing()`, lock if full, and start the match if the start conditions now hold.
- There is no rejoin: the client keeps the same `Room`, and its role flips when `state.players` gains its session id. Press counters are fine, because the server takes a new seat's first counters as its baseline (`baselined`).
- It is refused silently when the sender isn't a spectator, no seat is free, or the payload fails `parseTakeSeat`. The client keeps offering "Join the game" only while `players < maxPlayers`.

### Rematch and map change

Spectators stay. `startMatch`, `pickMap`, `switchMap` and `resetScoreboard`
only touch players. The client sees `mapId` change on the next snapshot and
calls `spectator.setMap(map)`. When a player leaves, the seat frees up, the
room unlocks, and spectators see "Join the game".

### Kill feed

`damage()` broadcasts `MSG_KILL { victim, killer }` when a kill is credited,
and `killer === victim` for a self-kill. `Spectator.onSnapshot` takes it
through `SpectateSnapshot.kills`. Without it the model guesses the killer
from whose `kills` went up in the same snapshot, which is right in a duel and
nearly always right in FFA; two kills landing in one tick fall back to the
leader.

## Client wiring

### Route: `/game/$code/watch`

This is the route file `apps/client/src/routes/game.$code_.watch.tsx`. The
`_` after `$code` stops it nesting under `game.$code.tsx`, whose `onEnter`
would otherwise join the room as a player first. Its `onEnter` / `onStay`
call `app.routeWatch(params.code)`.

Why a path and not `?spectate`:

- `/game/$code` and `/game/$code/watch` are two links with two meanings: the invite link to play, and a "watch this game" link to share. Neither needs search-param validation.
- Taking a seat becomes `navigate({ to: "/game/$code", replace: true })`. That route's `routeGame(code)` is already a no-op when we are in that room (`this.current?.net.roomId === code`), so nothing rejoins. With `?spectate`, dropping the param re-runs `onStay` on the same route, and every branch in `routeGame` would have to tell the two apart.
- Back from either page goes to the menu, as it does today.

### `apps/client/src/net.ts`

- `JoinRequest` gains `{ kind: "watch"; roomId: string }`. `joinGame` tries `joinById(roomId, { ...options, spectate: true })` first. If that fails with the locked message (`JoinError("full")` today), it calls the `/games/:roomId/watch` endpoint and `client.consumeSeatReservation()`, with the same token handling as a join.
- `capture()` copies `state.spectators` into `Snapshot.spectators`.
- `Net` records the `MSG_KILL` messages between two snapshots and hands them to the next snapshot (`Snapshot.kills`).
- `Net.role`: `"player" | "spectator"`, from `state.players.has(sessionId)` on each patch.
- `Net.takeSeat()` sends `MSG_TAKE_SEAT`.
- `sendInput` does nothing while the role is `spectator`. That is belt and braces: the match doesn't call it (below).
- The resume record (`bagarre:resume`) is written for spectators too, with `role: "spectator"`, so a reload of `/game/$code/watch` resumes watching.

### `apps/client/src/app.ts`

- `routeWatch(code)`: validate the code like `routeGame` does, return if we are already in that room, and otherwise run `join({ kind: "watch", roomId: code })`.
- `AppState.spectating: boolean` follows `net.role`. When it flips to `player` (a seat was taken), `nav.toGame(code)` with replace.
- `GameView` gains `spectating`. For a spectator, `card` is never `waiting` or `result`: the overlay shows the phase instead, and the scoreboard (Tab) stays available.
- `joinSeat()` calls `current.net.takeSeat()`. `leave()` stays as it is.
- Notices: add "Nothing to watch" (a room that is gone) and "The game ended" (`CLOSE_NO_PLAYERS`).

### `apps/client/src/match.ts`

A spectator `Match` (or a `role` flag on the match) runs **without a local
player**:

- There is no `Predictor`, no `LocalBullets` and no input accumulator: step 1 of `frame()` doesn't run at all, and `net.sendInput` is never called.
- Every player goes through the "remote" branch: `buffer.samplePlayer(id, now - INTERP_DELAY_MS)`, with bullets and grenades from `sampleBullets` / `sampleGrenades`, which is what the opponent already gets. No mesh is `isLocal`, so there is no white ring and `flash()` never shakes the camera.
- The camera comes from the spectator instead of `scene.follow(pos…)`:

  ```ts
  spectator.frame(now, dt, (id, out) => {
    const p = buffer.samplePlayer(id, renderTime);
    if (!p) return false;
    out.x = p.x; out.z = p.z;
    return true;
  });
  ```

  (`samplePlayer` allocates one object per call today. Either live with that, or add a `samplePlayerInto(id, t, out)` next to it when wiring.)
- Snapshots: in `onSnapshot`, call `spectator.onSnapshot(snap, now, epochChanged)`. The `reset` flag stops a reconnect's full resync from reading as deaths. On a `mapId` change (the existing hard boundary), call `spectator.setMap(map)`.
- **Sounds** are placed from the camera target: `setListener(spectator.listenerX, spectator.listenerZ)` each frame, where the local player's position used to go. There are no "own" sounds (no dash, reload or empty click cues), since those are the local predictor's. Remote shots, hits and blasts keep going through the existing remote-sfx path. In Overview the listener sits at the map centre, which is a fair mix.
- The HUD model: the spectator doesn't write the player HUD (no HP bars or cooldowns for "you"). `hud.clear()` once.

### `apps/client/src/scene.ts`

- Split `resize()` into `updateProjection()` (the frustum only) and the `renderer.setSize()` part. Then add `setViewHeight(h)`, which calls just the first, so a zoom animating every frame doesn't resize the canvas. After that, `sceneRig` in `camera.ts` can call `scene.setViewHeight(h)` instead of writing the frustum itself, and `scene.resize()` on a window resize will no longer fight it.
- FFA's slot palette: pass it as `new Spectator({ colorOf })`. The model's `FALLBACK_SLOT_COLORS` only covers the gap.

### `apps/client/src/engine.ts`

- `createMatch(net)` builds the spectator variant when `net.role === "spectator"`, with `new Spectator({ rig: sceneRig(scene), colorOf, followViewHeight })`. Use 22 for a duel and about 26 for the FFA maps.
- The game's `Input`: `input.enabled = false` for the whole spectating session. In the frame loop that is `v.card === "none" && !panel && !v.spectating`. The game's keys (Space, Q grenade, E shield, R, 1-4) can then never produce an `InputMessage`. That matters here: Q and E mean grenade and shield in play, but previous and next player when watching.
- `installSpectatorControls({ canvas, actions: spectator, enabled })` runs when the spectator match is made and is uninstalled in its `dispose()`, where `enabled = () => !ui.getState().panel && !app.getState().paused`.
- `window.__bagarre.spectator`: a getter returning `{ followId, mode, ui: spectator.ui.getState() }` for the tests.

### `apps/client/src/keys.ts` (input isolation)

- Esc still opens the Esc menu, where "Leave match" reads "Stop watching".
- M still mutes.
- Tab holds the scoreboard while spectating. Today it waits on `input.enabled`, so for a spectator that check becomes "the spectator controls are enabled".
- 1-4 on cards never reach a spectator, who has no waiting or result card. The spectator's 1 / 2 / 3 live in `controls.ts`, which skips text fields, modifier keys, and anything that happens while a panel is open.

### UI

- `ui/game/GameScreen.tsx`: `spectating ? <SpectatorOverlay store={spectator.ui} actions={…} /> : <Hud />`, with actions `{ follow, setMode } = spectator`, `join = () => app.joinSeat()` and `leave = () => app.leave()`.
- `Cards.tsx`: no waiting or result card while spectating. For the phase, add a small status line under the bar: "Waiting for players" or "{name} wins, next match in 5".
- `ui/menu/OpenGames.tsx` and `lobby.ts`:
  - `GET /games` returns games that are **in progress or full** too, as `OpenGame { …, phase, players, maxPlayers, spectators, watchable: true }`. `openGames()` queries `{ name, private: false }` without `locked: false` and sorts the joinable ones first.
  - A game with a free seat shows **Join**, as it does now.
  - A full or playing one shows **Watch**, which links to `/game/$code/watch` (`nav.toWatch(code)`), with "{n} watching" in its description.
  - The waiting card's invite panel can offer a second "Copy watch link".

## Checks to add

### Smoke (`apps/server/smoke.ts`)

`spectatorChecks()`, on the pinned `yard` map:

1. **Can't move or shoot.** Start a duel with two drivers, then a spectator joins with `{ spectate: true }` through the watch endpoint (the room is locked). The spectator sends 60 well-formed `MSG_INPUT`s (move right, fire, dash, grenade) and a `MSG_PICK`. Both players' positions, `shots`, the bullet and grenade counts, and `pick` are unchanged by it. The spectator is still connected afterwards (not closed with 4002).
2. **Isn't counted.** `state.players.size === 2`, `state.spectators === 1`, `metadata.players === 2`, `metadata.spectators === 1`. A second spectator makes it 2. The phase didn't restart when they came in. With one player and one spectator the match doesn't start, and `/games` lists the room as joinable.
3. **Sees state.** The spectator's `room.state` has both players with moving `x`, the bullets, and the `phase`. It gets `MSG_KILL` when a driver scores.
4. **Takes a free seat.** One player leaves. The room unlocks and `/games` shows it joinable. The spectator sends `MSG_TAKE_SEAT`, then shows up in `state.players` with a free slot, `spectators` drops to 0, and the match starts with the remaining player. A second `MSG_TAKE_SEAT` from a player is ignored. With every seat taken, a spectator's `MSG_TAKE_SEAT` is ignored.
5. **Survives a rematch and a map change.** Play a match to `ended` with the result delay shortened. The spectator stays connected through the rematch (unpinned, so `mapId` changes) and `spectators` stays at 1.
6. **Quick match avoids full rooms.** With a duel full and a spectator in it, `joinOrCreate` creates a new room instead of landing in the full one.
7. **Lost seat race.** Two players `joinById` the last seat at once. One is seated and the other becomes a spectator, and neither is kicked.
8. **Empty room closes.** Both players leave. After `SPECTATOR_IDLE_S`, shortened in the subclass like `reconnectGrace`, the spectator gets `CLOSE_NO_PLAYERS`.

### Playwright

- **Watch from the menu.** Two bot tabs play a duel. A third opens the menu, sees the game with **Watch**, and clicks it: the URL is `/game/<code>/watch`, `spectate-bar` is there, and `spectate-player` has 2 rows.
- **Follow and switch.** `spectate-watching[data-name]` is a player's name. Press E and it changes. Click the other `spectate-player` row and it gets `data-followed`.
- **Auto-switch on death.** Drive the bots until the followed one dies. Within about 1.5 s, `spectate-watching` names the killer.
- **Modes.** Click `spectate-mode-overview` and `__bagarre.spectator.mode === "overview"`. Pressing W switches to `free`. A wheel step changes the camera's view height (read through `__bagarre.scene.camera.top`).
- **Input isolation.** While spectating, press Space, Q, E, R, and click the canvas. The server's view of both players (their `shots`, dash cooldown and grenades) is unchanged, and no `MSG_INPUT` goes out: count `net.sendInput` calls through the dev handle.
- **Take a seat.** A bot leaves. `spectate-join` shows up, and clicking it makes the URL `/game/<code>` with the player HUD up.
- **Reduced motion.** `page.emulateMedia({ reducedMotion: "reduce" })`: after a switch, the camera's target equals the new player's position on the very next frame.
- **Rematch.** The spectator is still on `/game/<code>/watch` after the result delay, and the map name changed.
- **Reload.** Reloading `/game/<code>/watch` resumes watching without a new join (the same session id).

## Settled: spectators see everything

Decided with Basile: spectators can fly freely over the whole map in every
mode, duels included. There is no broadcast delay, no view restriction and
nothing against ghost-calling (a friend reading positions to a player): it's
a game for friends. Hence the full state with no `StateView`, and a Free
camera limited by nothing but the map bounds. The default camera is
**Follow** in a duel and **Overview** in FFA.

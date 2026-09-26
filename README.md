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

Controls: **WASD** (or arrows) moves relative to the screen, W is always "up".
The keys are read by physical position, so on AZERTY it's ZQSD. The mouse aims,
hold the **left button** to fire. First to 5 kills wins; the match restarts a
few seconds later.

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
prediction matched the server exactly). Each tab has its own setting, so you can
give only one player the lag.

`?server=http://host:2567` points the client at another server
(or set `VITE_SERVER_URL` at build time).

## Layout

```
shared/src/     constants, arena layout, the pure step functions, message types
server/src/     Colyseus room (DuelRoom), synced state schema, bootstrap
server/smoke.ts headless end-to-end test
client/src/     Three.js scene, input, prediction, interpolation, HUD
```

## How the netcode works

The server is the only source of truth. It runs a fixed 30 Hz loop, and the
client sends it exactly one input per tick: a sequence number, a move direction,
an aim angle and a "firing" flag. It never sends a position. The movement and
collision code lives in `shared/` as a pure function, `stepPlayer`, which the
server calls once per input it receives. The client calls the very same function
the moment it sends an input, so your player moves right away instead of waiting
a round trip (prediction). Every server snapshot carries, for each player, the
last input sequence number the server has applied. When one arrives, the client
drops the inputs the server already applied, starts again from the server's
position, and re-applies the ones still in flight (reconciliation). Since both
sides run the same code on the same inputs, this is usually a no-op; when they
disagree, the server wins and the gap is smoothed out over a few frames. The
opponent and the bullets aren't predicted: the client keeps a short buffer of
snapshots and draws them 100 ms in the past, blended between the two snapshots
on either side of that moment (interpolation), so they move smoothly at 30
updates per second.

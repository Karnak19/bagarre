// Headless smoke test: boots the real server, connects two SDK clients and
// checks the core loop end to end. Run with `bun run smoke` (from the repo root).

import { Client, type Room } from "@colyseus/sdk";
import {
  MAX_HP,
  MSG_INPUT,
  ROOM_NAME,
  TICK_MS,
  TICK_RATE,
  stepPlayer,
  type InputMessage,
  type PlayerView,
  type RoomStateView,
} from "@bagarre/shared";
import { createServer } from "./src/app.ts";

const PORT = 2599;
const failures: string[] = [];

function check(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures.push(label);
}

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return cond();
}

/**
 * Sends one input per tick, like the real client does, and predicts its own
 * position with the shared step function so we can compare with the server.
 */
function driver(room: Room) {
  let seq = 0;
  let current: Omit<InputMessage, "seq"> = { mx: 0, mz: 0, aim: 0, fire: false };
  const start = me(room)!;
  let predicted = { x: start.x, z: start.z };
  const history = new Map<number, { x: number; z: number }>();
  const timer = setInterval(() => {
    seq++;
    const input: InputMessage = { seq, ...current };
    predicted = stepPlayer(predicted, input);
    history.set(seq, predicted);
    room.send(MSG_INPUT, input);
  }, TICK_MS);
  return {
    history,
    set(next: Partial<Omit<InputMessage, "seq">>) {
      current = { ...current, ...next };
    },
    stop() {
      clearInterval(timer);
    },
  };
}

const state = (room: Room) => room.state as unknown as RoomStateView;
const me = (room: Room): PlayerView | undefined => state(room).players.get(room.sessionId);

const server = createServer({ gracefullyShutdown: false });
await server.listen(PORT);

let exitCode = 0;
try {
  const c1 = new Client(`http://localhost:${PORT}`);
  const c2 = new Client(`http://localhost:${PORT}`);
  const r1 = await c1.joinOrCreate(ROOM_NAME);
  const r2 = await c2.joinOrCreate(ROOM_NAME);
  check(r1.roomId === r2.roomId, `both clients joined the same room (${r1.roomId})`);

  const started = await waitFor(() => state(r1).phase === "playing" && !!me(r1) && !!me(r2), 3000);
  check(started, "match switches to 'playing' with two players");

  // The loop must really run at TICK_RATE, or inputs pile up server-side.
  const tick0 = state(r1).tick;
  const wall0 = performance.now();
  await new Promise((r) => setTimeout(r, 1000));
  const rate = (state(r1).tick - tick0) / ((performance.now() - wall0) / 1000);
  check(Math.abs(rate - TICK_RATE) < 2, `server ticks at ~${TICK_RATE} Hz (measured ${rate.toFixed(1)})`);

  const d1 = driver(r1);
  const d2 = driver(r2);

  // Player 1 walks right for one second.
  const start1 = { x: me(r1)!.x, z: me(r1)!.z };
  d1.set({ mx: 1, mz: 0 });
  // Player 2 walks from (12, 12) down to the z = -12 row, a clear firing lane.
  d2.set({ mx: 0, mz: -1 });
  await new Promise((r) => setTimeout(r, 1000));
  d1.set({ mx: 0 });
  const moved = await waitFor(() => Math.abs(me(r1)!.x - start1.x) > 3, 1000);
  const p1 = me(r1)!;
  check(moved, `player 1 moved after input (x ${start1.x.toFixed(2)} -> ${p1.x.toFixed(2)})`);
  check(p1.lastSeq > 0, `server acknowledges inputs (lastSeq=${p1.lastSeq})`);
  const predictedAtAck = d1.history.get(p1.lastSeq);
  check(
    !!predictedAtAck && predictedAtAck.x === p1.x && predictedAtAck.z === p1.z,
    `client-side prediction matches the server exactly at seq ${p1.lastSeq}`,
  );

  await waitFor(() => me(r2)!.z < -11.9, 5000);
  d2.set({ mz: 0 });
  await new Promise((r) => setTimeout(r, 200));

  // Player 1 aims at player 2 and holds fire.
  const target = state(r1).players.get(r2.sessionId)!;
  const hpBefore = target.hp;
  check(hpBefore === MAX_HP, `player 2 starts at full HP (${hpBefore})`);
  const shooter = me(r1)!;
  const aim = Math.atan2(target.z - shooter.z, target.x - shooter.x);
  d1.set({ aim, fire: true });
  const sawBullet = await waitFor(() => {
    let n = 0;
    state(r2).bullets.forEach(() => n++);
    return n > 0;
  }, 1000);
  check(sawBullet, "bullets are replicated to the other client");
  const hurt = await waitFor(() => (state(r2).players.get(r2.sessionId)?.hp ?? MAX_HP) < hpBefore, 3000);
  check(hurt, `player 2 HP dropped after being shot (hp=${me(r2)?.hp})`);

  const killed = await waitFor(() => me(r1)!.kills >= 1, 4000);
  check(killed, `player 1 scores a kill (kills=${me(r1)!.kills})`);

  d1.stop();
  d2.stop();

  // Leaving puts the remaining player back into waiting.
  await r2.leave();
  const waiting = await waitFor(() => state(r1).phase === "waiting", 2000);
  check(waiting, "remaining player goes back to 'waiting' when the opponent leaves");

  // The freed seat can be taken again, and the match restarts.
  const c3 = new Client(`http://localhost:${PORT}`);
  const r3 = await c3.joinOrCreate(ROOM_NAME);
  check(r3.roomId === r1.roomId, "a new client fills the freed seat in the same room");
  const restarted = await waitFor(() => state(r1).phase === "playing", 2000);
  check(restarted && me(r1)!.kills === 0, "match restarts with scores reset");
  await r3.leave();
  await r1.leave();
} catch (err) {
  console.error(err);
  failures.push("uncaught error");
} finally {
  exitCode = failures.length === 0 ? 0 : 1;
  console.log(failures.length === 0 ? "\nsmoke: all checks passed" : `\nsmoke: ${failures.length} failure(s)`);
  await server.gracefullyShutdown(false);
  process.exit(exitCode);
}

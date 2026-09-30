// Run with `bun run test` (or `bun test src/spectate` in apps/client).

import { describe, expect, test } from "bun:test";
import { SpectatorCamera, overviewViewHeight, screenToGround, type SpectatorCameraRig } from "./camera.ts";
import {
  AUTO_SWITCH_DELAY_MS,
  cycleTarget,
  findKiller,
  follow,
  initialSpectateState,
  leaderId,
  orderPlayers,
  rememberPlayers,
  scoreLeader,
  spectateUiModel,
  stepSpectate,
  type SpectatePlayer,
  type SpectateSnapshot,
  type SpectateState,
} from "./model.ts";

type P = SpectatePlayer;
const player = (slot: number, over: Partial<P> = {}): P => ({
  name: `P${slot}`,
  slot,
  kills: 0,
  deaths: 0,
  alive: true,
  connected: true,
  ...over,
});

const snap = (players: Record<string, P>, extra: Partial<SpectateSnapshot> = {}): SpectateSnapshot => ({
  players: new Map(Object.entries(players)),
  maxPlayers: 4,
  ...extra,
});

/** Runs a sequence of snapshots through stepSpectate like spectator.ts does. */
function run(states: SpectateSnapshot[], start: SpectateState = initialSpectateState, t0 = 0, dt = 33) {
  const prev = new Map<string, { alive: boolean; kills: number }>();
  let has = false;
  let s = start;
  states.forEach((sn, i) => {
    s = stepSpectate(s, has ? prev : null, sn, t0 + i * dt);
    rememberPlayers(sn.players, prev);
    has = true;
  });
  return { state: s, prev };
}

describe("ordering and leader", () => {
  test("most kills, then fewest deaths, then seat", () => {
    const s = snap({
      a: player(0, { kills: 3, deaths: 2 }),
      b: player(1, { kills: 5 }),
      c: player(2, { kills: 3, deaths: 1 }),
      d: player(3, { kills: 3, deaths: 1 }),
    });
    expect(orderPlayers(s.players)).toEqual(["b", "c", "d", "a"]);
  });

  test("leader prefers someone alive and connected, and skips `except`", () => {
    const s = snap({
      a: player(0, { kills: 9, alive: false }),
      b: player(1, { kills: 5, connected: false }),
      c: player(2, { kills: 1 }),
    });
    expect(leaderId(s.players)).toBe("c");
    expect(leaderId(snap({ a: player(0, { alive: false }) }).players)).toBe("a");
    expect(leaderId(snap({ a: player(0), b: player(1) }).players, "a")).toBe("b");
  });

  test("score leader is strict", () => {
    expect(scoreLeader(snap({ a: player(0), b: player(1) }).players)).toBeNull();
    expect(scoreLeader(snap({ a: player(0, { kills: 2 }), b: player(1, { kills: 2 }) }).players)).toBeNull();
    expect(scoreLeader(snap({ a: player(0, { kills: 2 }), b: player(1, { kills: 3 }) }).players)).toBe("b");
  });

  test("cycling wraps both ways", () => {
    const s = snap({ a: player(0, { kills: 2 }), b: player(1, { kills: 1 }), c: player(2) });
    expect(cycleTarget(s.players, "a", 1)).toBe("b");
    expect(cycleTarget(s.players, "c", 1)).toBe("a");
    expect(cycleTarget(s.players, "a", -1)).toBe("c");
    expect(cycleTarget(s.players, null, 1)).toBe("a");
    expect(cycleTarget(s.players, "gone", -1)).toBe("c");
    expect(cycleTarget(snap({}).players, null, 1)).toBeNull();
  });
});

describe("follow target", () => {
  test("starts on the leader, and moves on when the followed player leaves", () => {
    const first = run([snap({ a: player(0, { kills: 1 }), b: player(1, { kills: 4 }) })]).state;
    expect(first.followId).toBe("b");
    const after = run([snap({ a: player(0, { kills: 1 }) })], first).state;
    expect(after.followId).toBe("a");
  });

  test("an empty game follows nobody", () => {
    expect(run([snap({})], { followId: "a", pending: null }).state).toEqual(initialSpectateState);
  });

  test("unchanged snapshots keep the same state object", () => {
    const s0 = snap({ a: player(0), b: player(1) });
    const { state, prev } = run([s0]);
    expect(stepSpectate(state, prev, s0, 100)).toBe(state);
  });

  test("death switches to the killer after the delay", () => {
    const alive = snap({ a: player(0), b: player(1), c: player(2, { kills: 2 }) });
    const killed = snap({ a: player(0, { alive: false, deaths: 1 }), b: player(1, { kills: 1 }), c: player(2, { kills: 2 }) });
    const start: SpectateState = { followId: "a", pending: null };
    const { state, prev } = run([alive, killed], start, 1000);
    expect(state.followId).toBe("a");
    expect(state.pending?.to).toBe("b");
    // Still on the body before the delay...
    expect(stepSpectate(state, prev, killed, 1033 + AUTO_SWITCH_DELAY_MS - 1).followId).toBe("a");
    // ...then on the killer.
    expect(stepSpectate(state, prev, killed, 1033 + AUTO_SWITCH_DELAY_MS).followId).toBe("b");
  });

  test("the server's kill feed wins over inference", () => {
    const alive = snap({ a: player(0), b: player(1), c: player(2) });
    // b's kills went up, but the server says c did it (both scored this tick).
    const killed = snap(
      { a: player(0, { alive: false }), b: player(1, { kills: 1 }), c: player(2, { kills: 1 }) },
      { kills: [{ victim: "a", killer: "c" }] },
    );
    const { state } = run([alive, killed], { followId: "a", pending: null });
    expect(state.pending?.to).toBe("c");
  });

  test("no killer (suicide, ambiguous): the leader, never the dead player", () => {
    const alive = snap({ a: player(0, { kills: 5 }), b: player(1, { kills: 1 }), c: player(2, { kills: 3 }) });
    const selfKill = snap({ a: player(0, { kills: 5, alive: false }), b: player(1, { kills: 1 }), c: player(2, { kills: 3 }) });
    const { state, prev } = run([alive, selfKill], { followId: "a", pending: null });
    expect(state.pending?.to).toBeNull();
    expect(stepSpectate(state, prev, selfKill, 1e9).followId).toBe("c");
  });

  test("respawning before the switch cancels it", () => {
    const alive = snap({ a: player(0), b: player(1) });
    const killed = snap({ a: player(0, { alive: false }), b: player(1, { kills: 1 }) });
    const back = snap({ a: player(0), b: player(1, { kills: 1 }) });
    const { state } = run([alive, killed, back], { followId: "a", pending: null });
    expect(state).toEqual({ followId: "a", pending: null });
  });

  test("a manual pick cancels a pending switch", () => {
    const pendingState: SpectateState = { followId: "a", pending: { to: "b", at: 5 } };
    expect(follow(pendingState, "c")).toEqual({ followId: "c", pending: null });
    const settled: SpectateState = { followId: "c", pending: null };
    expect(follow(settled, "c")).toBe(settled);
  });

  test("the killer who left by switch time falls back to the leader", () => {
    const pendingState: SpectateState = { followId: "a", pending: { to: "b", at: 0 } };
    const s = snap({ a: player(0, { alive: false }), c: player(2, { kills: 1 }) });
    expect(stepSpectate(pendingState, null, s, 10).followId).toBe("c");
  });

  test("a first snapshot (no previous) never reads as a death", () => {
    const s = snap({ a: player(0, { alive: false }), b: player(1) });
    expect(stepSpectate({ followId: "a", pending: null }, null, s, 0).pending).toBeNull();
  });

  test("findKiller: ambiguous inference gives null", () => {
    const prev = snap({ a: player(0), b: player(1), c: player(2) }).players;
    const next = snap({ a: player(0, { alive: false }), b: player(1, { kills: 1 }), c: player(2, { kills: 1 }) });
    expect(findKiller("a", prev, next)).toBeNull();
  });
});

describe("UI model", () => {
  test("rows, watching, seats and spectators", () => {
    const s = snap(
      { a: player(0, { name: "Ann", kills: 2 }), b: player(1, { name: "Bob", alive: false, connected: false }) },
      { spectators: 3, maxPlayers: 2 },
    );
    const m = spectateUiModel(s, { followId: "a", pending: null }, "follow", (slot) => `c${slot}`);
    expect(m.watching).toEqual({ id: "a", name: "Ann", color: "c0" });
    expect(m.rows.map((r) => [r.id, r.followed, r.leader, r.alive, r.connected])).toEqual([
      ["a", true, true, true, true],
      ["b", false, false, false, false],
    ]);
    expect(m.spectators).toBe(3);
    expect(m.canJoin).toBe(false);
    expect(spectateUiModel(s, { followId: "a", pending: null }, "overview").watching).toBeNull();
    expect(spectateUiModel(snap({ a: player(0) }, { maxPlayers: 2 }), initialSpectateState, "follow").canJoin).toBe(true);
  });
});

describe("camera", () => {
  const fakeRig = (width = 1600, height = 900) => {
    const last = { x: 0, z: 0, h: 0 };
    const rig: SpectatorCameraRig = {
      apply(x, z, h) {
        last.x = x;
        last.z = z;
        last.h = h;
      },
      viewport: () => ({ width, height }),
    };
    return { rig, last };
  };

  test("screen axes map onto the iso ground diagonals", () => {
    const o = { x: 0, z: 0 };
    screenToGround(1, 0, o);
    expect(o.x).toBeCloseTo(Math.SQRT1_2);
    expect(o.z).toBeCloseTo(-Math.SQRT1_2);
    screenToGround(0, 1, o);
    // Up the screen is into the scene, (-1, -1), foreshortened by sin(pitch) = 1/√3.
    expect(o.x).toBeCloseTo(-Math.SQRT1_2 * Math.sqrt(3));
    expect(o.z).toBeCloseTo(-Math.SQRT1_2 * Math.sqrt(3));
  });

  test("the overview fits a 60 m map on a wide and a tall screen", () => {
    const b = { halfX: 30, halfZ: 30 };
    const wide = overviewViewHeight(b, 1600, 900);
    const tall = overviewViewHeight(b, 400, 900);
    // Across: √2·60 ≈ 84.9 m must fit the width.
    expect(wide * (1600 / 900)).toBeGreaterThan(Math.SQRT2 * 60);
    expect(tall * (400 / 900)).toBeGreaterThan(Math.SQRT2 * 60);
    expect(tall).toBeGreaterThan(wide);
  });

  test("follow glides towards the target, reduced motion cuts", () => {
    const { rig, last } = fakeRig();
    const cam = new SpectatorCamera(rig, { reducedMotion: false });
    cam.update(1 / 60, true, 0, 0); // first frame snaps
    cam.retarget();
    cam.update(1 / 60, true, 10, 0);
    expect(last.x).toBeGreaterThan(0);
    expect(last.x).toBeLessThan(10);
    for (let i = 0; i < 240; i++) cam.update(1 / 60, true, 10, 0);
    expect(last.x).toBeCloseTo(10, 2);

    const still = fakeRig();
    const cut = new SpectatorCamera(still.rig, { reducedMotion: true });
    cut.update(1 / 60, true, 0, 0);
    cut.update(1 / 60, true, 10, 5);
    expect(still.last.x).toBe(10);
    expect(still.last.z).toBe(5);
  });

  test("overview centres and zooms out; free stays in bounds", () => {
    const { rig, last } = fakeRig();
    const cam = new SpectatorCamera(rig, { reducedMotion: true });
    cam.setBounds({ halfX: 30, halfZ: 30 });
    cam.update(1 / 60, true, 12, 12);
    cam.setMode("overview");
    cam.update(1 / 60, true, 12, 12);
    expect(last.x).toBe(0);
    expect(last.z).toBe(0);
    expect(last.h).toBeCloseTo(overviewViewHeight({ halfX: 30, halfZ: 30 }, 1600, 900));

    cam.setMode("free");
    cam.setPan(1, 0);
    for (let i = 0; i < 600; i++) cam.update(1 / 30, false, 0, 0);
    expect(Math.abs(last.x)).toBeLessThanOrEqual(30);
    expect(Math.abs(last.z)).toBeLessThanOrEqual(30);
    cam.setPan(0, 0);
    for (let i = 0; i < 50; i++) cam.zoomBy(-500);
    cam.update(1 / 60, false, 0, 0);
    expect(last.h).toBe(10);
    for (let i = 0; i < 50; i++) cam.zoomBy(500);
    cam.update(1 / 60, false, 0, 0);
    expect(last.h).toBeCloseTo(overviewViewHeight({ halfX: 30, halfZ: 30 }, 1600, 900));
  });

  test("drag moves the world with the pointer, only in free mode", () => {
    const { rig, last } = fakeRig();
    const cam = new SpectatorCamera(rig, { reducedMotion: true });
    cam.setBounds({ halfX: 30, halfZ: 30 });
    cam.update(1 / 60, true, 0, 0);
    cam.dragBy(100, 0);
    cam.update(1 / 60, true, 0, 0);
    expect(last.x).toBe(0);
    cam.setMode("free");
    cam.dragBy(100, 0);
    cam.update(1 / 60, false, 0, 0);
    // Dragging right pulls the camera to screen-left: ground (-1, +1).
    expect(last.x).toBeLessThan(0);
    expect(last.z).toBeGreaterThan(0);
  });
});

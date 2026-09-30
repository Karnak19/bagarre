// Hit registration on a strafing target. A shooter sees the other player
// INTERP_DELAY_MS in the past; the server rewinds its bullet hit tests by the
// same delay (HIT_REWIND_TICKS), so a shot at the body the shooter sees lands.
// Before that rewind, a target strafing at full speed was 0.6 m ahead of its
// drawn self, more than its radius, and these shots missed.
//
// The target plays at `?lag=200`: its own latency must not move the body the
// server judges. The shooter, with no added latency, aims straight at the body
// it draws (`opponentsDrawn`), with no lead: 2.5 m away, a revolver round
// reaches it within the tick it is fired, on the client and on the server.
// (A shooter's own latency is not compensated yet: at `?lag=200` a shooter
// still misses a strafing target.)

import { MAX_HP, WEAPONS } from "@bagarre/shared";
import { expect, place, setHp, test, type Player } from "./fixtures.ts";

// oxlint-disable typescript/no-explicit-any

const REVOLVER = WEAPONS.findIndex((w) => w.key === "revolver"); // no spread
const SHOTS = 8;
/** Yard's z = -12 row is clear from wall to wall: the target strafes along it, the shooter stands 2.5 m off it. */
const LANE_Z = -12;
const LANE_HALF = 6;
const SHOOTER = { x: 0, z: -9.5 };

/** The target walks the lane end to end at full speed, turning at each end (on its own predicted position). */
async function strafe(p: Player) {
  await p.page.evaluate(
    ({ half }) => {
      const b = (window as any).__bagarre;
      Object.assign(b.bot, { on: true, mx: 1, mz: 0, fire: false });
      const turn = () => {
        const x = b.predictor?.sim?.x;
        if (typeof x === "number") {
          if (x > half) b.bot.mx = -1;
          else if (x < -half) b.bot.mx = 1;
        }
        requestAnimationFrame(turn);
      };
      turn();
    },
    { half: LANE_HALF },
  );
}

/** The shooter keeps its aim on the drawn opponent, every frame. */
async function track(p: Player) {
  await p.page.evaluate(() => {
    const b = (window as any).__bagarre;
    Object.assign(b.bot, { on: true, mx: 0, mz: 0, fire: false });
    let prev: { x: number; t: number } | null = null;
    const aim = (now: number) => {
      const m = b.match;
      const d = m?.opponentsDrawn?.[0];
      const me = m?.latest?.players.get(m.net.sessionId);
      if (d && me) {
        b.bot.aim = Math.atan2(d.z - me.z, d.x - me.x);
        // Where the target is drawn and how fast it goes, for the trigger (fireOnce).
        const vx = prev && now > prev.t ? ((d.x - prev.x) * 1000) / (now - prev.t) : 0;
        b.hitregTarget = { x: d.x, vx };
        prev = { x: d.x, t: now };
      }
      requestAnimationFrame(aim);
    };
    requestAnimationFrame(aim);
  });
}

/** A round left the magazine: one fewer in it, or, if it was empty, the first round after the reload. */
const fired = (before: number, now: number, magazine: number) => now < before || (before === 0 && now === magazine - 1);

/** Fires one round as the drawn target crosses the middle of the lane at full speed. */
async function fireOnce(p: Player) {
  const before = await p.page.evaluate(() => (window as any).__bagarre.predictor.sim.ammo as number);
  // Pull the trigger in the same frame the target is drawn in the middle.
  await p.page.waitForFunction(
    () => {
      const b = (window as any).__bagarre;
      const t = b.hitregTarget;
      if (!t || Math.abs(t.x) > 1.5 || Math.abs(t.vx) < 4) return false;
      b.bot.fire = true;
      return true;
    },
    undefined,
    { timeout: 15_000 },
  );
  // Let go once the round is out (after the reload, if the magazine was empty).
  await p.page.waitForFunction(
    ({ before, magazine }) => {
      const b = (window as any).__bagarre;
      const now = b.predictor.sim.ammo as number;
      // `fired`, in the page.
      if (!(now < before || (before === 0 && now === magazine - 1))) return false;
      b.bot.fire = false;
      return true;
    },
    { before, magazine: WEAPONS[REVOLVER].magazine },
    { timeout: 15_000 },
  );
}

test("a strafing target is hit where the shooter sees it (the server rewinds bullet hits)", async ({ players }) => {
  // A shoots with no added latency; B, the target, plays at 200 ms of extra round trip.
  const { host: a, invite, code } = await players.host("duel", "A");
  await a.page.keyboard.press(`Digit${REVOLVER + 1}`);
  await expect.poll(async () => a.me(await a.state())?.pick).toBe(REVOLVER);
  const b = await players.open("B");
  await b.goto(`${new URL(invite).pathname}?lag=200`);
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
  await Promise.all([a.expectState("card", "none"), b.expectState("card", "none")]);
  const [ida, idb] = [(await a.state()).you, (await b.state()).you];
  expect(a.me(await a.state())?.weapon).toBe(REVOLVER);

  await place(code, ida, SHOOTER.x, SHOOTER.z);
  await place(code, idb, -LANE_HALF, LANE_Z);
  await track(a);
  await strafe(b);

  const hpOfB = async () => (await a.state()).players.find((p) => p.id === idb)!;
  let hits = 0;
  for (let i = 0; i < SHOTS; i++) {
    const before = a.me(await a.state())!.ammo;
    await fireOnce(a);
    // The server fired it too, then the round is gone (a hit, or a wall).
    await expect.poll(async () => fired(before, a.me(await a.state())!.ammo, WEAPONS[REVOLVER].magazine)).toBe(true);
    await expect
      .poll(async () => {
        const s = await a.state();
        return s.bullets === 0 && s.localBullets === 0;
      })
      .toBe(true);
    const target = await hpOfB();
    if (target.hp < MAX_HP || !target.alive) hits++;
    // Back to full health for the next shot, so the target never dies off its lane.
    if (target.hp < MAX_HP) {
      await setHp(code, idb, MAX_HP);
      await expect.poll(async () => (await hpOfB()).hp).toBe(MAX_HP);
    }
  }
  test.info().annotations.push({ type: "hits", description: `${hits} of ${SHOTS}` });
  // Coarse on purpose: a page starved of frames aims late now and then.
  expect(hits, `${hits} of ${SHOTS} shots hit the strafing target`).toBeGreaterThanOrEqual(3);
});

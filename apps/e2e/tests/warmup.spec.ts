// The warmup at the start of a match: everyone on the map, the loadout
// picker open with a timer, picks in hand at once, and no shooting until the
// match starts. The e2e server shortens every warmup to 1 s (server.ts);
// this spec gives its own room the real WARMUP_SECONDS (POST /warmup) and
// checks its length, then holds it open for the rest of its checks (a slow
// machine gets the time it needs) and ends it when they are done.

import { GRENADES, TICK_RATE, WARMUP_SECONDS, WEAPONS } from "@bagarre/shared";
import { expect, setWarmup, test } from "./fixtures.ts";

const SNIPER = 2;
const SMOKE = GRENADES.findIndex((g) => g.key === "smoke");

test("a duel starts with a warmup: pick a loadout in hand at once, no bullet, then the match and the shots", async ({ players }) => {
  expect(WARMUP_SECONDS).toBe(8);
  const { host: a, invite, code } = await players.host("duel", "A");
  await setWarmup(code, WARMUP_SECONDS);

  // Someone watches from the start: they get the timer too.
  const c = await players.open("C");
  await c.goto(`/game/${code}/watch`);
  await c.expectState("role", "spectator");

  // The host is in the game already: it sees the warmup start, WARMUP_SECONDS
  // long, with the match clock not started and no card over the map. Caught
  // on the first frame that has it (a poll could come seconds late on a busy machine).
  const firstWarmup = a.page.waitForFunction(
    () => {
      // oxlint-disable-next-line typescript/no-explicit-any
      const s = (window as any).__bagarre.match?.latest;
      return s?.phase === "warmup" ? { tick: s.tick as number, warmupEnd: s.warmupEnd as number, startTick: s.startTick as number } : null;
    },
    undefined,
    { polling: "raf", timeout: 30_000 },
  );
  const b = await players.join(invite, "B");
  const first = (await (await firstWarmup).jsonValue())!;
  // From here, time for the checks: the warmup ends when they are done.
  await setWarmup(code, 120);
  expect(first.startTick).toBe(0);
  const left = (first.warmupEnd - first.tick) / TICK_RATE;
  expect(left).toBeLessThanOrEqual(WARMUP_SECONDS);
  expect(left).toBeGreaterThan(WARMUP_SECONDS - 4);
  await a.expectState("card", "none");
  await Promise.all([a, b, c].map((p) => p.expectState("phase", "warmup")));
  // Every client counts down to the same end tick.
  await expect.poll(async () => (await a.state()).warmupEnd).toBeGreaterThan(first.warmupEnd);
  const sa = await a.state();
  await expect.poll(async () => (await b.state()).warmupEnd).toBe(sa.warmupEnd);
  await expect.poll(async () => (await c.state()).warmupEnd).toBe(sa.warmupEnd);
  for (const p of [a, b]) {
    await expect(p.testId("warmup")).toBeVisible();
    await expect(p.testId("warmup-timer")).toContainText("Match starts in");
    await expect(p.testId("weapon-picker")).toBeVisible();
  }
  // Whole seconds to the (moved) end tick.
  const shown = Number(await a.testId("warmup-timer").getAttribute("data-seconds"));
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThanOrEqual(120);
  await expect(c.testId("spectate-status")).toContainText("Match starts in");
  await expect(c.testId("spectate-status")).not.toContainText("playing");

  // A pick is in hand at once, full magazine: key 3 (the game has the keys)
  // for the weapon, a click on the panel for the grenade.
  await a.focusGame();
  await a.page.keyboard.press("Digit3");
  await expect
    .poll(async () => {
      const s = await a.state();
      const me = a.me(s);
      return me && [me.pick, me.weapon, me.ammo, me.reloadTicks, s.drawnWeapon];
    })
    .toEqual([SNIPER, SNIPER, WEAPONS[SNIPER].magazine, 0, SNIPER]);
  await a.testId(`grenade-pick-${GRENADES[SMOKE].key}`).click();
  await expect.poll(async () => a.me(await a.state())?.grenade).toBe(SMOKE);
  // Still warming up: all of that happened before the match.
  expect((await a.state()).phase).toBe("warmup");

  // Fire (the autopilot holds the trigger) and throw: nothing leaves, not
  // even a predicted bullet, and nothing is heard.
  const sounds = await a.sfxCount();
  const seq0 = a.me(await a.state())!.lastSeq;
  await a.bot({ on: true, mx: 0, mz: 0, aim: 0, fire: true });
  await a.page.keyboard.press("KeyQ");
  const samples: { bullets: number; local: number; grenades: number; ammo: number }[] = [];
  await expect
    .poll(async () => {
      const s = await a.state();
      const me = a.me(s)!;
      samples.push({ bullets: s.bullets, local: s.localBullets, grenades: s.grenades, ammo: me.ammo });
      return me.lastSeq - seq0;
    })
    .toBeGreaterThan(TICK_RATE);
  const s = await a.state();
  expect(s.phase).toBe("warmup");
  expect(samples.every((x) => x.bullets === 0 && x.local === 0 && x.grenades === 0 && x.ammo === WEAPONS[SNIPER].magazine)).toBe(true);
  expect(await a.sfxSince(sounds)).not.toContain("sniper");
  expect(a.me(s)?.hp).toBe(100);

  // The match starts when the warmup ends: the clock from there, and the
  // trigger still held now fires.
  await setWarmup(code, 0);
  await Promise.all([a, b].map((p) => p.expectState("phase", "playing")));
  const started = await a.state();
  expect(started.startTick).toBeGreaterThan(sa.tick);
  expect(started.warmupEnd).toBe(0);
  await expect(a.testId("warmup")).toBeHidden();
  await expect.poll(async () => a.me(await a.state())!.ammo).toBeLessThan(WEAPONS[SNIPER].magazine);
  await expect.poll(() => a.sfxSince(sounds)).toContain("sniper");
  await a.bot({ on: false, fire: false });

  // Playing and alive: a pick no longer goes through.
  await a.focusGame();
  await a.page.keyboard.press("Digit1");
  await expect(a.testId("hud-picker")).toBeVisible();
  const after = a.me(await a.state())!;
  expect([after.pick, after.weapon]).toEqual([SNIPER, SNIPER]);
});

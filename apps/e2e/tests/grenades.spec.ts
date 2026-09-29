// Smoke, stun and flash grenades (and the frag): each is picked, thrown by
// the dev bot (`__bagarre.bot.target` + a Q press), and its effect is read on
// the other clients through the dev handle, never through pixels. Players are
// put where a throw needs them with the e2e server's /place.

import { FFA_MAPS, FLASH, GRENADES, MSG_PICK, PLAYER_SPEED, SMOKE, STUN, TICK_DT, lineOfSight, segmentHitsBox, ticks, type Arena, type Vec2 } from "@bagarre/shared";
import { FFA_MAP, expect, kill, place, setSmoke, test, type Player } from "./fixtures.ts";

// oxlint-disable typescript/no-explicit-any

/** Throws the grenade in hand at (x, z), aiming at `aim` meanwhile (the bot drives the input). */
async function throwAt(p: Player, x: number, z: number, aim = 0) {
  await p.page.evaluate(
    ({ x, z, aim }) => {
      const b = (window as any).__bagarre;
      Object.assign(b.bot, { on: true, mx: 0, mz: 0, fire: false, aim, target: { x, z } });
      b.input.presses.grenade++;
    },
    { x, z, aim },
  );
}

/** Our predicted player (stun, cooldowns, dash) and the last reconciliation error. */
function predicted(p: Player): Promise<{ stunTicks: number; grenadeCd: number; dashCd: number; dashTicks: number; error: number }> {
  return p.page.evaluate(() => {
    const pr = (window as any).__bagarre.predictor;
    const s = pr?.sim ?? {};
    return { stunTicks: s.stunTicks ?? 0, grenadeCd: s.grenadeCd ?? 0, dashCd: s.dashCd ?? 0, dashTicks: s.dashTicks ?? 0, error: pr?.lastError ?? 0 };
  });
}

function veilOf(p: Player, id: string): Promise<string | undefined> {
  return p.page.evaluate((id) => (window as any).__bagarre.veils()[id], id);
}

function plateOf(p: Player, id: string): Promise<{ visible: boolean; hidden: boolean; faded: boolean } | undefined> {
  return p.page.evaluate((id) => (window as any).__bagarre.plates.find((x: { id: string }) => x.id === id), id);
}

function pings(p: Player): Promise<string[]> {
  return p.page.evaluate(() => (window as any).__bagarre.minimapPings);
}

/** Waits until `name` has been heard since sound number `from` (a blast is played when it is drawn). */
async function heard(p: Player, from: number, name: string) {
  await expect.poll(() => p.sfxSince(from), { message: `${p.name} hears ${name}` }).toContain(name);
}

const idOf = async (p: Player) => (await p.state()).you;
const playerIn = async (p: Player, id: string) => (await p.state()).players.find((x) => x.id === id)!;

test("the grenade picker: every type, G cycles, bad picks refused, kept over a reload, in hand on the next spawn with its own cooldown", async ({ players }) => {
  const { host: a, invite } = await players.host("duel", "A");
  await a.expectState("phase", "waiting");

  for (const [i, g] of GRENADES.entries()) {
    await a.testId(`grenade-pick-${g.key}`).click();
    await expect(a.testId(`grenade-pick-${g.key}`)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => a.me(await a.state())?.grenadePick).toBe(i);
  }
  // G cycles: flash, then frag, then smoke.
  await a.page.keyboard.press("KeyG");
  await expect.poll(async () => a.me(await a.state())?.grenadePick).toBe(0);
  await a.page.keyboard.press("KeyG");
  await expect.poll(async () => a.me(await a.state())?.grenadePick).toBe(1);

  // Bad payloads are dropped whole (a bad grenade drops the weapon sent with it),
  // then a good one: messages arrive in order, so once it lands the bad ones were seen.
  await a.page.evaluate(({ type, count }) => {
    const room = (window as any).__bagarre.net.room;
    for (const bad of [{ grenade: count + 5 }, { grenade: "2" }, { grenade: -1 }, { grenade: 1.5 }, { weapon: 3, grenade: count }, {}]) room.send(type, bad);
    room.send(type, { grenade: 2 });
  }, { type: MSG_PICK, count: GRENADES.length });
  await expect.poll(async () => a.me(await a.state())?.grenadePick).toBe(2);
  expect(a.me(await a.state())?.pick).toBe(0);

  // A reload resumes the seat: the pick is still there.
  await a.page.reload();
  await a.page.waitForFunction(() => "__bagarre" in window);
  await a.expectState("phase", "waiting");
  await expect.poll(async () => a.me(await a.state())?.grenadePick).toBe(2);
  await expect(a.testId("grenade-pick-stun")).toHaveAttribute("aria-pressed", "true");

  // The match starts: the stun goes in hand, and the HUD shows it.
  const b = await players.join(invite, "B");
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
  await a.expectState("card", "none");
  expect(a.me(await a.state())?.grenade).toBe(2);
  await expect(a.testId("hud-grenade")).toHaveAttribute("data-type", "stun");
  await expect(a.testId("hud-grenade")).toHaveAttribute("data-ready", "");

  // Its own cooldown: the stun's 10 s, longer than the frag's 8 s.
  const me = a.me(await a.state())!;
  await throwAt(a, me.x + 3, me.z);
  await expect.poll(async () => (await predicted(a)).grenadeCd).toBeGreaterThan(ticks(GRENADES[0].cooldown));
  expect((await predicted(a)).grenadeCd).toBeLessThanOrEqual(ticks(GRENADES[2].cooldown));
  await expect(a.testId("hud-grenade")).not.toHaveAttribute("data-ready", "");
});

/** A row on the map with 16 m of open ground, well clear of cover: where the smoke test plays. */
function openRow(map: Arena): Vec2 {
  const len = 16;
  for (let z = -map.halfZ + 3; z <= map.halfZ - 3; z += 0.5)
    for (let x = -map.halfX + 3; x + len <= map.halfX - 3; x += 0.5) {
      const a = { x, z };
      const b = { x: x + len, z };
      if (map.obstacles.every((o) => !segmentHitsBox(a, b, o, 1.5)) && lineOfSight(map, a, b)) return a;
    }
  throw new Error("no open row on the map");
}

test("smoke hides a player in it from enemies (model, plate, minimap), a spectator sees them faded, and it clears", async ({ players }) => {
  const { host: a, invite, code } = await players.host("ffa", "A");
  await a.testId("grenade-pick-smoke").click();
  await expect.poll(async () => a.me(await a.state())?.grenadePick).toBe(1);
  const b = await players.join(invite, "B", FFA_MAP);
  const c = await players.join(invite, "C", FFA_MAP);
  await Promise.all([a, b, c].map((p) => p.expectState("phase", "playing")));
  const d = await players.open("D");
  await d.goto(`/game/${code}/watch`, FFA_MAP);
  await expect(d.testId("spectate-bar")).toBeVisible();

  const [ida, idb] = [await idOf(a), await idOf(b)];
  const map = FFA_MAPS.find((m) => m.id === FFA_MAP)!;
  const row = openRow(map);
  const inCloud = { x: row.x + 2, z: row.z };
  const out = { x: row.x + 11, z: row.z };
  await place(code, ida, inCloud.x, inCloud.z);
  await place(code, idb, row.x + 15, row.z);
  await expect.poll(async () => (await playerIn(b, ida)).x).toBeCloseTo(inCloud.x, 1);
  await expect.poll(() => veilOf(b, ida)).toBe("none");

  // A throws the smoke at their own feet.
  const heardFrom = await b.sfxCount();
  await throwAt(a, inCloud.x, inCloud.z, Math.PI);
  await heard(b, heardFrom, "smoke_pop");
  // The cloud lasts SMOKE.duration; hold it open while we check (a slow CI
  // machine takes longer than that to get through them), then let it clear.
  const [left] = await setSmoke(code, 60);
  expect(left).toBeGreaterThan(0);
  expect(left).toBeLessThanOrEqual(ticks(SMOKE.duration));
  await expect.poll(() => veilOf(b, ida), { message: "B no longer sees A" }).toBe("hidden");
  await expect.poll(() => plateOf(b, ida)).toMatchObject({ visible: false, hidden: true });
  // A sees themselves; the spectator sees A faded.
  await expect.poll(() => plateOf(a, ida)).toMatchObject({ visible: true, hidden: false });
  await expect.poll(() => veilOf(d, ida)).toBe("faded");
  await expect.poll(() => plateOf(d, ida)).toMatchObject({ visible: true, faded: true });

  // A fires from inside (away from everyone): heard, but no dot on B's minimap.
  const shotsFrom = await b.sfxCount();
  await a.bot({ fire: true, aim: Math.PI });
  await expect.poll(async () => (await b.sfxSince(shotsFrom)).filter((n) => n === "rifle").length).toBeGreaterThanOrEqual(3);
  expect(await pings(b)).not.toContain(ida);
  await a.bot({ fire: false });

  // A steps out: seen again, and a shot puts them on the minimap.
  await place(code, ida, out.x, out.z);
  await expect.poll(() => veilOf(b, ida)).toBe("none");
  await expect.poll(() => plateOf(b, ida)).toMatchObject({ visible: true, hidden: false });
  await a.bot({ fire: true, aim: Math.PI / 2 });
  await expect.poll(() => pings(b)).toContain(ida);
  await a.bot({ fire: false });

  // Back in: hidden again, until the cloud clears by itself.
  await place(code, ida, inCloud.x, inCloud.z);
  await expect.poll(() => veilOf(b, ida)).toBe("hidden");
  await expect.poll(async () => (await b.state()).players.length).toBe(3);
  await setSmoke(code, 1);
  await expect.poll(() => veilOf(b, ida), { message: "the cloud clears" }).toBe("none");
  await expect.poll(() => plateOf(b, ida)).toMatchObject({ visible: true });
  // No damage from the smoke.
  expect((await playerIn(b, ida)).hp).toBe(100);
});

test("stun slows the players in it and blocks their dash, with no rubber-banding; a frag still hurts", async ({ players }) => {
  const { host: a, invite, code } = await players.host("duel", "A");
  await a.testId("grenade-pick-stun").click();
  await expect.poll(async () => a.me(await a.state())?.grenadePick).toBe(2);
  const b = await players.join(invite, "B");
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
  const [ida, idb] = [await idOf(a), await idOf(b)];

  // On Yard's clear z = -12 row, 6 m apart.
  await place(code, ida, -8, -12);
  await place(code, idb, -2, -12);
  await b.bot({ on: true, mx: 0, mz: 0 });
  await expect.poll(async () => (await playerIn(b, idb)).x).toBeCloseTo(-2, 1);

  await throwAt(a, -2, -12);
  // The other client sees B stunned; B's own prediction has it too, with the HUD badge.
  await expect.poll(async () => (await playerIn(a, idb)).stunTicks, { message: "A sees B stunned" }).toBeGreaterThan(0);
  await expect.poll(async () => (await predicted(b)).stunTicks).toBeGreaterThan(0);
  await expect(b.testId("hud-stunned")).toBeVisible();
  // A, 6 m away, is not stunned.
  expect((await playerIn(a, ida)).stunTicks).toBe(0);

  // B tries to dash: nothing. Then walks east: half speed, and the prediction agrees with the server.
  await b.page.evaluate(() => (window as any).__bagarre.input.presses.dash++);
  // Speed is measured per input the server applied (a slow page sends fewer
  // inputs per second, but each one is one fixed step), once B is under way.
  const perInput = async (minInputs: number, track?: (err: number) => void) => {
    const start = b.me(await b.state())!.x;
    await expect.poll(async () => b.me(await b.state())!.x).toBeGreaterThan(start + 0.05);
    const s0 = b.me(await b.state())!;
    await expect
      .poll(async () => {
        track?.((await predicted(b)).error);
        return b.me(await b.state())!.lastSeq - s0.lastSeq;
      })
      .toBeGreaterThanOrEqual(minInputs);
    const s1 = b.me(await b.state())!;
    return { step: (s1.x - s0.x) / (s1.lastSeq - s0.lastSeq), end: s1 };
  };
  await b.bot({ mx: 1 });
  let worst = 0;
  const slow = await perInput(10, (e) => (worst = Math.max(worst, e)));
  expect(slow.end.stunTicks, "still stunned while measuring").toBeGreaterThan(0);
  expect(slow.step, `stunned: ${slow.step.toFixed(4)} m per input`).toBeCloseTo(PLAYER_SPEED * STUN.speedScale * TICK_DT, 3);
  expect((await predicted(b)).dashCd, "the dash was blocked").toBe(0);
  expect(worst, `largest correction while stunned: ${worst.toFixed(3)} m`).toBeLessThan(0.05);

  // Once it wears off: full speed.
  await expect.poll(async () => b.me(await b.state())!.stunTicks, { timeout: 10_000 }).toBe(0);
  await expect(b.testId("hud-stunned")).toBeHidden();
  const fast = await perInput(5);
  expect(fast.step, `after the stun: ${fast.step.toFixed(4)} m per input`).toBeCloseTo(PLAYER_SPEED * TICK_DT, 3);
  await b.bot({ mx: 0 });
  // No damage from the stun.
  expect(fast.end.hp).toBe(100);

  // Now a frag: pick it while dead (your own shot), respawn with it, and it hurts.
  await kill(code, ida, ida);
  await expect.poll(async () => a.me(await a.state())?.alive).toBe(false);
  await a.page.evaluate(() => (window as any).__bagarre.app.pickGrenade(0));
  await expect.poll(async () => {
    const me = a.me(await a.state());
    return me?.alive ? me.grenade : null;
  }).toBe(0);
  const bNow = (await playerIn(a, idb));
  await place(code, ida, bNow.x - 4, bNow.z);
  await expect.poll(async () => (await playerIn(a, ida)).x).toBeCloseTo(bNow.x - 4, 1);
  await throwAt(a, bNow.x, bNow.z);
  await expect.poll(async () => (await playerIn(a, idb)).hp, { message: "the frag hurts B" }).toBeLessThan(100);
});

test("flash: a player aiming at it gets the white screen; aiming away, or behind cover, gets nothing", async ({ players }) => {
  const { host: a, invite, code } = await players.host("duel", "A");
  await a.testId("grenade-pick-flash").click();
  await expect.poll(async () => a.me(await a.state())?.grenadePick).toBe(3);
  const b = await players.join(invite, "B");
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
  const [ida, idb] = [await idOf(a), await idOf(b)];

  /**
   * Puts A and B in place, B aiming at `aim`, throws a fresh flash at `at`
   * and waits for it to go off: B's flash end tick changes (flashed), or B
   * hears the blast (a slow page may draw it late, so the flash could be
   * over by then: the end tick is what says whether it happened). Returns
   * whether B got flashed, and for how many ticks.
   */
  async function flashOnce(pa: Vec2, pb: Vec2, aim: number, at: Vec2): Promise<{ flashed: boolean; ticks: number }> {
    await place(code, ida, pa.x, pa.z);
    await place(code, idb, pb.x, pb.z);
    await b.bot({ on: true, mx: 0, mz: 0, aim });
    // Both in place, and the server has B's new aim (the flash reads it at the blast).
    await expect.poll(async () => {
      const s = await a.state();
      const [ma, mb] = [s.players.find((p) => p.id === ida)!, s.players.find((p) => p.id === idb)!];
      const off = Math.abs(Math.atan2(Math.sin(mb.aim - aim), Math.cos(mb.aim - aim)));
      return Math.hypot(ma.x - pa.x, ma.z - pa.z) + Math.hypot(mb.x - pb.x, mb.z - pb.z) < 0.2 && off < 0.01;
    }).toBe(true);
    const before = (await playerIn(b, idb)).flashEnd;
    const from = await b.sfxCount();
    await throwAt(a, at.x, at.z, Math.atan2(at.z - pa.z, at.x - pa.x));
    await expect
      .poll(async () => (await playerIn(b, idb)).flashEnd !== before || (await b.sfxSince(from)).includes("flashbang"), { message: "the flash goes off" })
      .toBe(true);
    const mine = await playerIn(b, idb);
    return { flashed: mine.flashEnd !== before, ticks: mine.flashTicks };
  }

  // 1. B looks straight at it from 4 m, in the open (Yard's clear z = -12 row): the full white screen.
  const first = await flashOnce({ x: -10, z: -12 }, { x: 0, z: -12 }, Math.PI, { x: -4, z: -12 });
  expect(first).toEqual({ flashed: true, ticks: ticks(FLASH.maxDuration) });
  await expect(b.testId("hud-flash")).toHaveAttribute("data-active", "");
  // The other client sees it on B too, and it wears off.
  expect((await playerIn(a, idb)).flashTicks).toBe(ticks(FLASH.maxDuration));
  await expect(b.testId("hud-flash")).not.toHaveAttribute("data-active", "", { timeout: 8000 });
  expect((await playerIn(b, idb)).hp).toBe(100);

  // Each new flash needs the cooldown back: a respawn gives it (your own shot, no score).
  async function rearm() {
    await kill(code, ida, ida);
    await expect.poll(async () => a.me(await a.state())?.alive).toBe(false);
    await expect.poll(async () => a.me(await a.state())?.alive).toBe(true);
  }

  // 2. Same place, B aiming away: nothing.
  await rearm();
  expect((await flashOnce({ x: -10, z: -12 }, { x: 0, z: -12 }, 0, { x: -4, z: -12 })).flashed).toBe(false);
  await expect(b.testId("hud-flash")).not.toHaveAttribute("data-active", "");

  // 3. B looks at it, but the crate stack north of the centre is in the way: nothing.
  await rearm();
  expect((await flashOnce({ x: -2.75, z: -12 }, { x: -2.75, z: 0.5 }, -Math.PI / 2, { x: -2.75, z: -6.5 })).flashed).toBe(false);
  await expect(b.testId("hud-flash")).not.toHaveAttribute("data-active", "");
});

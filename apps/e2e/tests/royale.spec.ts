import { HEAL_BANDAGE, HEAL_MEDKIT, HEAL_STOP, ITEM_HEAL, ITEM_SHIELD, NO_HEAL, PISTOL, ROYALE_RULES, SHIELD } from "@bagarre/shared";
import { ROYALE_MAP, expect, kill, place, setHp, setLoot, setZone, test, type Player } from "./fixtures.ts";

const RIFLE = 0;
const NO_GUN = 255;

/** Counts the loadout picks the page sends from now on (none should go out in a royale). */
async function spyPicks(p: Player) {
  await p.page.evaluate(() => {
    // oxlint-disable-next-line typescript/no-explicit-any
    const net = (window as any).__bagarre.net;
    const send = net.sendPick.bind(net);
    Object.assign(window, { __picks: 0 });
    net.sendPick = (m: unknown) => {
      // oxlint-disable-next-line typescript/no-explicit-any
      (window as any).__picks++;
      send(m);
    };
  });
}

// oxlint-disable-next-line typescript/no-explicit-any
const picksSent = (p: Player) => p.page.evaluate(() => (window as any).__picks as number);

test("a short battle royale: the Pistol, a crate, a gun, a switch, a knock-out spent watching, and the last one standing wins", async ({ players }) => {
  const { players: all, code, invite } = await players.royale(3);
  const [a, b, c] = all;
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  const [ida, idb, idc] = await Promise.all(all.map(async (p) => (await p.state()).you));

  // Everyone starts with the Pistol in slot 1, the other slots empty, no grenades.
  for (const p of all) {
    await p.expectState("card", "none");
    const me = p.me(await p.state())!;
    expect(me.weapon).toBe(PISTOL);
    expect(me.guns).toEqual([PISTOL, NO_GUN, NO_GUN]);
    expect(me.grenades).toBe(0);
    await expect(p.testId("hud-slot-1")).toHaveAttribute("data-weapon", "pistol");
    await expect(p.testId("hud-slot-1")).toHaveAttribute("data-active", "");
    await expect(p.testId("hud-grenade")).toHaveAttribute("data-count", "0");
    await expect(p.testId("hud-royale-alive")).toContainText("3 of 3");
    await expect(p.testId("hud-zone-time")).toContainText("Zone shrinks in");
  }
  // Ironvale is the royale pool, so every match plays on it (the spec pins it too).
  expect(ROYALE_RULES.maps.map((m) => m.id)).toEqual([ROYALE_MAP]);
  const s0 = await a.state();
  expect(s0.mapId).toBe(ROYALE_MAP);
  expect(s0.crates.length).toBe(ROYALE_RULES.maps[0].royale!.crates.length);
  expect(s0.zoneEnd).toBeGreaterThan(0);

  // Once it started, nobody can take a seat (the invite says so), but anyone can watch.
  const d = await players.join(invite, "D", ROYALE_MAP);
  await expect(d.testId("notice")).toContainText("already started");
  await d.goto(`/game/${code}/watch`, ROYALE_MAP);
  await d.expectState("role", "spectator");
  await expect(d.testId("spectate-bar")).toBeVisible();

  // A walks into a crate: it breaks open, drops a gun (the e2e server makes it a rifle), A picks it up in slot 2.
  await setLoot(code, RIFLE);
  const [crate, crate2] = s0.crates;
  await place(code, ida, crate.x + 0.3, crate.z);
  await expect.poll(async () => a.me(await a.state())?.guns[1], { message: "A picked up the rifle" }).toBe(RIFLE);
  expect((await a.state()).crates.some((x) => x.id === crate.id)).toBe(false);
  expect(a.me(await a.state())!.weapon).toBe(PISTOL);
  await expect(a.testId("hud-slot-2")).toHaveAttribute("data-weapon", "rifle");

  // 2 switches to it (predicted at once, then the server's); the Pistol keeps its magazine. No loadout pick goes out.
  await spyPicks(a);
  await a.focusGame();
  await a.page.keyboard.press("Digit2");
  await a.expectState("predictedWeapon", RIFLE);
  await expect.poll(async () => a.me(await a.state())?.weapon, { message: "A's server-side gun" }).toBe(RIFLE);
  const armed = a.me(await a.state())!;
  expect(armed.hand).toBe(1);
  expect(armed.mags[0]).toBe(10);
  await expect(a.testId("hud-slot-2")).toHaveAttribute("data-active", "");
  await a.expectState("drawnWeapon", RIFLE);
  // The wheel cycles through the guns carried (skipping the empty slot 3), and back with 2.
  await a.page.mouse.move(400, 250);
  await a.page.mouse.wheel(0, 120);
  await a.expectState("predictedWeapon", PISTOL);
  await a.page.keyboard.press("Digit3"); // an empty slot: nothing happens
  await a.page.keyboard.press("Digit2");
  await a.expectState("predictedWeapon", RIFLE);
  await expect.poll(async () => a.me(await a.state())?.hand).toBe(1);
  expect(await picksSent(a)).toBe(0);

  // B picks up a rifle too, then A knocks B out: B's rifle drops where B fell, and B watches, on A first.
  await place(code, idb, crate2.x + 0.3, crate2.z);
  await expect.poll(async () => b.me(await b.state())?.guns[1], { message: "B picked up a rifle" }).toBe(RIFLE);
  const itemsBefore = (await a.state()).items.length;
  await kill(code, ida, idb);
  await b.expectState("knockedOut", true);
  await expect(b.testId("spectate-bar")).toBeVisible();
  await expect.poll(async () => (await b.state()).spectator?.followId, { message: "B follows the killer" }).toBe(ida);
  const dropped = (await a.state()).items;
  expect(dropped.length).toBe(itemsBefore + 1);
  expect(dropped.some((it) => it.kind === 0 && it.item === RIFLE)).toBe(true);
  // B doesn't respawn, and cycles through the players still in (A and C, never B).
  await b.page.keyboard.press("KeyE");
  await expect.poll(async () => (await b.state()).spectator?.followId).toBe(idc);
  await b.page.keyboard.press("KeyE");
  await expect.poll(async () => (await b.state()).spectator?.followId).toBe(ida);
  expect(b.me(await b.state())!.alive).toBe(false);
  await expect(a.testId("hud-royale-alive")).toContainText("2 of 3");

  // A knocks C out: A is the last one standing and wins; places follow the order of knock-out.
  await kill(code, ida, idc);
  for (const p of [a, b, c]) await p.expectState("phase", "ended");
  await expect(a.testId("result-card")).toBeVisible();
  await expect(a.testId("result-card")).toContainText("You won!");
  await expect(c.testId("result-card")).toContainText("You placed 2nd");
  await expect(b.testId("result-card")).toContainText("You placed 3rd");
  await expect(a.testId("placement-row")).toHaveCount(3);
  const places = Object.fromEntries((await a.state()).players.map((p) => [p.id, p.place]));
  expect(places).toEqual({ [ida]: 1, [idc]: 2, [idb]: 3 });
  // The floor is cleared with the match.
  expect((await a.state()).items.length).toBe(0);
});

test("battle royale: a bandage heals a hurt player, firing cancels a medkit and keeps it, a shield charge raises the shield", async ({ players }) => {
  const { players: all, code } = await players.royale(2);
  const [a] = all;
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  const ida = (await a.state()).you;
  const meA = async () => a.me(await a.state())!;
  const [c1, c2, c3] = (await a.state()).crates;

  // Nothing to start with: no healing item, no shield charge (E does nothing).
  await expect(a.testId("hud-heal-bandage")).toHaveAttribute("data-count", "0");
  await expect(a.testId("hud-heal-medkit")).toHaveAttribute("data-count", "0");
  await expect(a.testId("hud-shield")).toHaveAttribute("data-count", "0");

  // A crate drops two bandages: walking over them fills the stack.
  await setLoot(code, { kind: ITEM_HEAL, item: HEAL_BANDAGE, amount: 2 });
  await place(code, ida, c1.x + 0.3, c1.z);
  await expect.poll(async () => (await meA()).bandages, { message: "A picked up the bandages" }).toBe(2);
  await expect(a.testId("hud-heal-bandage")).toHaveAttribute("data-count", "2");

  // Hurt, A uses one (4): it heals 25 once it completes, and only then is it used up.
  await setHp(code, ida, 50);
  await expect.poll(async () => (await meA()).hp).toBe(50);
  await a.focusGame();
  await a.page.keyboard.press("Digit4");
  await expect.poll(async () => (await meA()).hp, { message: "the bandage healed A", timeout: 8000 }).toBe(75);
  const healed = await meA();
  expect(healed.bandages).toBe(1);
  expect(healed.healStop).toBe(HEAL_STOP.done);
  await expect(a.testId("hud-heal-bandage")).toHaveAttribute("data-count", "1");

  // A medkit (4 s), then a shot mid-heal: cancelled, nothing healed, the medkit kept.
  await setLoot(code, { kind: ITEM_HEAL, item: HEAL_MEDKIT, amount: 1 });
  await place(code, ida, c2.x + 0.3, c2.z);
  await expect.poll(async () => (await meA()).medkits, { message: "A picked up a medkit" }).toBe(1);
  await a.focusGame();
  await a.page.keyboard.press("Digit5");
  await expect.poll(async () => (await meA()).heal, { message: "A is using the medkit" }).toBe(HEAL_MEDKIT);
  await expect(a.testId("hud-heal-status")).toHaveAttribute("data-state", "healing");
  await expect(a.testId("hud-heal-medkit")).toHaveAttribute("data-active", "");
  await a.bot({ on: true, fire: true, mx: 0, mz: 0 });
  await expect.poll(async () => (await meA()).healStop, { message: "the shot cancelled the heal" }).toBe(HEAL_STOP.fire);
  await a.bot({ on: false, fire: false });
  const cancelled = await meA();
  expect(cancelled.heal).toBe(NO_HEAL);
  expect(cancelled.medkits).toBe(1);
  expect(cancelled.hp).toBe(75);
  await expect(a.testId("hud-heal-status")).toHaveAttribute("data-state", "fire");

  // A shield charge: E uses it and the bubble goes up.
  await setLoot(code, { kind: ITEM_SHIELD, item: 0, amount: 1 });
  await place(code, ida, c3.x + 0.3, c3.z);
  await expect.poll(async () => (await meA()).shields, { message: "A picked up a shield charge" }).toBe(1);
  await expect(a.testId("hud-shield")).toHaveAttribute("data-count", "1");
  await a.focusGame();
  await a.page.keyboard.press("KeyE");
  await expect.poll(async () => (await meA()).shieldHp, { message: "A's shield is up" }).toBe(SHIELD.absorb);
  expect((await meA()).shields).toBe(0);
  await expect(a.testId("hud-shield")).toHaveAttribute("data-count", "0");
});

test("battle royale: a leaver is knocked out and placed, the zone closes and hurts whoever is outside", async ({ players }) => {
  const { players: all, code } = await players.royale(3);
  const [a, b, c] = all;
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  const [ida, idb, idc] = await Promise.all(all.map(async (p) => (await p.state()).you));

  // C leaves mid-match: knocked out at once, their seat kept (not connected) for the result.
  await c.page.keyboard.press("Escape");
  await c.testId("esc-leave").click();
  await expect.poll(async () => (await a.state()).players.find((p) => p.id === idc)?.outTick ?? 0, { message: "C is out" }).toBeGreaterThan(0);
  const left = (await a.state()).players.find((p) => p.id === idc)!;
  expect(left.connected).toBe(false);
  expect(left.alive).toBe(false);
  await expect(a.testId("hud-royale-alive")).toContainText("2 of 3");

  // A takes a medkit from a crate first, and is hurt.
  await setLoot(code, { kind: ITEM_HEAL, item: HEAL_MEDKIT, amount: 1 });
  const crate = (await a.state()).crates[0];
  await place(code, ida, crate.x + 0.3, crate.z);
  await expect.poll(async () => a.me(await a.state())?.medkits, { message: "A picked up a medkit" }).toBe(1);
  await setHp(code, ida, 60);

  // Stand A and B far apart on open floor (Ironvale's north-west and
  // south-east ring road), A starts the medkit, and the zone closes now: both
  // end up outside, and the zone's damage cancels A's heal (the HUD says it
  // was the zone), the medkit kept.
  await place(code, ida, -24, -26);
  await place(code, idb, 24, 26);
  await a.focusGame();
  await a.page.keyboard.press("Digit5");
  await expect.poll(async () => a.me(await a.state())?.heal, { message: "A is using the medkit" }).toBe(HEAL_MEDKIT);
  await setZone(code, 0, 2);
  await expect.poll(async () => a.me(await a.state())?.healStop, { message: "the zone cancelled A's heal" }).toBe(HEAL_STOP.zone);
  await expect(a.testId("hud-heal-status")).toHaveAttribute("data-state", "zone");
  expect(a.me(await a.state())?.medkits).toBe(1);
  await expect(a.testId("hud-zone-arrow")).toBeVisible();
  await expect.poll(async () => a.me(await a.state())?.hp ?? 100, { message: "the zone hurts A" }).toBeLessThan(100);
  // Nobody can stay in a closed zone: the match ends on the zone, a zone death has no killer.
  for (const p of [a, b]) await p.expectState("phase", "ended", 30_000);
  const end = await a.state();
  const byId = Object.fromEntries(end.players.map((p) => [p.id, p.place]));
  expect(byId[idc]).toBe(3);
  expect([byId[ida], byId[idb]].sort()).toEqual([1, 2]);
  await expect(a.testId("placement-row")).toHaveCount(3);
});

import { HEAL_BANDAGE, HEAL_MEDKIT, HEAL_STOP, ITEM_GUN, ITEM_HEAL, ITEM_SHIELD, NO_HEAL, PISTOL, ROYALE_RULES, SHIELD, WEAPONS } from "@bagarre/shared";
import { ROYALE_MAP, expect, kill, openChest, place, setHp, setLoot, setZone, test, type Player } from "./fixtures.ts";

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

test("a short battle royale: the Pistol, a chest, a gun, a switch, a knock-out spent watching, and the last one standing wins", async ({ players }) => {
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
  // The 150 m map: everyone starts on one of its start spots, well apart (nobody meets anyone in the first seconds).
  const map = ROYALE_RULES.maps[0];
  expect([2 * map.halfX, 2 * map.halfZ]).toEqual([150, 150]);
  const at = s0.players.map((p) => ({ x: p.x, z: p.z }));
  for (const p of at) expect(map.spawns.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 0.5), `(${p.x}, ${p.z}) is a start spot`).toBe(true);
  for (let i = 0; i < at.length; i++)
    for (let j = i + 1; j < at.length; j++) expect(Math.hypot(at[i].x - at[j].x, at[i].z - at[j].z), `starts ${i} and ${j} apart`).toBeGreaterThan(30);

  // Once it started, nobody can take a seat (the invite says so), but anyone can watch.
  const d = await players.join(invite, "D", ROYALE_MAP);
  await expect(d.testId("notice")).toContainText("already started");
  await d.goto(`/game/${code}/watch`, ROYALE_MAP);
  await d.expectState("role", "spectator");
  await expect(d.testId("spectate-bar")).toBeVisible();

  // A opens a chest with F: it drops a gun (the e2e server makes it a rifle), A picks it up in slot 2 once it lands.
  await setLoot(code, RIFLE);
  const [crate, crate2] = s0.crates;
  await openChest(a, code, ida, crate);
  await expect.poll(async () => a.me(await a.state())?.guns[1], { message: "A picked up the rifle" }).toBe(RIFLE);
  expect((await a.state()).crates.find((x) => x.id === crate.id)?.open).toBe(true);
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
  await openChest(b, code, idb, crate2);
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

  // A chest drops two bandages: walking over them fills the stack.
  await setLoot(code, { kind: ITEM_HEAL, item: HEAL_BANDAGE, amount: 2 });
  await openChest(a, code, ida, c1);
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
  await openChest(a, code, ida, c2);
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
  await openChest(a, code, ida, c3);
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

  // A takes a medkit from a chest first, and is hurt.
  await setLoot(code, { kind: ITEM_HEAL, item: HEAL_MEDKIT, amount: 1 });
  const crate = (await a.state()).crates[0];
  await openChest(a, code, ida, crate);
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

test("battle royale: with all three slots full, standing by a gun shows the F swap prompt, F swaps, and the dropped gun isn't offered back until stepped off", async ({ players }) => {
  const { players: all, code } = await players.royale(2);
  const [a, b] = all;
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  const [ida, idb] = await Promise.all(all.map(async (p) => (await p.state()).you));
  const SMG = WEAPONS.findIndex((w) => w.key === "smg");
  const SNIPER = WEAPONS.findIndex((w) => w.key === "sniper");
  const DMR = WEAPONS.findIndex((w) => w.key === "dmr");
  const [c1, c2, c3, c4, c5] = (await a.state()).crates;
  const prompt = a.testId("hud-swap");
  const gunsOf = async (p: Player) => p.me(await p.state())?.guns;
  /** A gun lying on the floor near (x, z) (within 2 m: a chest's loot lands about 1 m from it), as A's page sees it. */
  const floorGun = async (weapon: number, x: number, z: number) =>
    (await a.state()).items.find((it) => it.kind === ITEM_GUN && it.item === weapon && Math.hypot(it.x - x, it.z - z) < 2);
  await expect(prompt).toHaveAttribute("data-state", "off");

  // A rifle in slot 2: one slot still free.
  await setLoot(code, RIFLE);
  await openChest(a, code, ida, c1);
  await expect.poll(() => gunsOf(a), { message: "A picked up the rifle" }).toEqual([PISTOL, RIFLE, NO_GUN]);

  // With a free slot, F has nothing to do: standing on a second rifle (carried already, so it stays on the floor), no prompt.
  const rifle2 = await openChest(a, code, ida, c2);
  await expect.poll(() => floorGun(RIFLE, c2.x, c2.z), { message: "the second rifle lies on the floor" }).toBeTruthy();
  await expect.poll(async () => a.me(await a.state())!.x, { message: "A stands by it" }).toBeCloseTo(rifle2.x, 1);
  await expect.poll(async () => (await a.state()).tick, { message: "the rifle has landed" }).toBeGreaterThanOrEqual(rifle2.readyTick);
  await expect(prompt).toHaveAttribute("data-state", "off");
  // And B, with two slots free, walks over a DMR: it goes straight into a slot, never a prompt.
  await setLoot(code, DMR);
  await openChest(b, code, idb, c5);
  await expect.poll(() => gunsOf(b), { message: "B picked up the DMR" }).toEqual([PISTOL, DMR, NO_GUN]);
  await expect(b.testId("hud-swap")).toHaveAttribute("data-state", "off");

  // An SMG fills slot 3.
  await setLoot(code, SMG);
  const smg = await openChest(a, code, ida, c3);
  await expect.poll(() => gunsOf(a), { message: "A picked up the SMG" }).toEqual([PISTOL, RIFLE, SMG]);
  await expect(prompt).toHaveAttribute("data-state", "off");

  // Full, by a sniper: it stays on the floor, and the prompt names the gun in hand and the one F takes.
  await setLoot(code, SNIPER);
  const sniper = await openChest(a, code, ida, c4);
  await expect.poll(() => floorGun(SNIPER, c4.x, c4.z), { message: "the sniper lies on the floor" }).toBeTruthy();
  await expect(prompt).toHaveAttribute("data-state", "on");
  await expect(prompt).toHaveAttribute("data-kind", "gun");
  await expect(prompt).toHaveAttribute("data-from", "pistol");
  await expect(prompt).toHaveAttribute("data-to", "sniper");
  await expect(prompt).toContainText("Swap Pistol → Sniper");

  // Walking away hides it; coming back shows it again.
  await place(code, ida, smg.x, smg.z);
  await expect(prompt).toHaveAttribute("data-state", "off");
  await place(code, ida, sniper.x, sniper.z);
  await expect(prompt).toHaveAttribute("data-state", "on");
  await expect(prompt).toHaveAttribute("data-to", "sniper");

  // F: the sniper comes into the hand, the Pistol drops under A's feet. A can't take that one back
  // before stepping off it (the server's rule), so the prompt hides instead of offering it.
  await a.focusGame();
  await a.page.keyboard.press("KeyF");
  await expect.poll(() => gunsOf(a), { message: "A swapped the Pistol for the sniper" }).toEqual([SNIPER, RIFLE, SMG]);
  await expect(a.testId("hud-slot-1")).toHaveAttribute("data-weapon", "sniper");
  // The loot feed names the swap.
  await expect(a.page.locator('[data-testid="hud-loot-row"][data-key="sniper"]')).toHaveText("Pistol→Sniper");
  const pistol = await floorGun(PISTOL, c4.x, c4.z);
  expect(pistol?.blockedFor).toBe(ida);
  await expect(prompt).toHaveAttribute("data-state", "off");
  // F again does nothing: the Pistol is still blocked for A. (Wait for the server to see the
  // press, or a starved page could send it only once A is back on the Pistol below.)
  const presses = a.me(await a.state())!.swapSeen;
  await a.page.keyboard.press("KeyF");
  await expect.poll(async () => a.me(await a.state())?.swapSeen, { message: "the server saw the second F" }).toBe(presses + 1);
  expect(await gunsOf(a)).toEqual([SNIPER, RIFLE, SMG]);
  await expect(prompt).toHaveAttribute("data-state", "off");

  // Stepped off and back: now F would take the Pistol back, and the prompt says so.
  await place(code, ida, smg.x, smg.z);
  await expect.poll(async () => (await floorGun(PISTOL, c4.x, c4.z))?.blockedFor, { message: "the Pistol is A's to take again" }).toBe("");
  await place(code, ida, pistol!.x, pistol!.z);
  await expect(prompt).toHaveAttribute("data-state", "on");
  await expect(prompt).toHaveAttribute("data-from", "sniper");
  await expect(prompt).toHaveAttribute("data-to", "pistol");
  await expect(prompt).toContainText("Swap Sniper → Pistol");
});

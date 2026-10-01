import { GRENADE_FRAG, GRENADE_SMOKE, ITEM_GRENADE, PISTOL, ROYALE, TICK_RATE, WEAPONS, ticks } from "@bagarre/shared";
import { expect, openChest, place, setLoot, setLootDrop, test } from "./fixtures.ts";

const RIFLE = 0;
const NO_GUN = 255;
const SMG = WEAPONS.findIndex((w) => w.key === "smg");

test("battle royale: F opens a chest, its loot falls out next to it, and nobody can take it until it has landed", async ({ players }) => {
  const { players: all, code } = await players.royale(2);
  const [a] = all;
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  const ida = (await a.state()).you;
  const [c1, c2] = (await a.state()).crates;
  const prompt = a.testId("hud-swap");
  const gunsOf = async () => a.me(await a.state())?.guns;

  // Every chest starts closed, and walking up to one doesn't open it: the prompt says F does.
  expect((await a.state()).crates.every((c) => !c.open)).toBe(true);
  await expect(prompt).toHaveAttribute("data-state", "off");
  await place(code, ida, c1.x + 0.3, c1.z);
  await expect(prompt).toHaveAttribute("data-state", "on");
  await expect(prompt).toHaveAttribute("data-kind", "chest");
  await expect(prompt).toContainText("Open chest");
  // (Standing right on it for a while: still closed, nothing on the floor.)
  const t0 = (await a.state()).tick;
  await expect.poll(async () => (await a.state()).tick).toBeGreaterThan(t0 + TICK_RATE / 2);
  expect((await a.state()).crates.find((c) => c.id === c1.id)?.open).toBe(false);
  expect((await a.state()).items).toEqual([]);

  // A slow fall (3 s, so a slow page still sees it): F opens the chest, a rifle pops out and lands
  // next to it, toward A, on open floor. A stands right where it lands, with a free slot, and still
  // doesn't get it while it falls: the server won't hand it over before its readyTick.
  await setLoot(code, RIFLE);
  await setLootDrop(code, 3);
  const loot = await openChest(a, code, ida, c1);
  expect(loot.item).toBe(RIFLE);
  expect(loot.readyTick - loot.dropTick).toBe(ticks(3));
  expect(Math.hypot(loot.x - c1.x, loot.z - c1.z)).toBeCloseTo(ROYALE.lootSpread, 1);
  await expect(prompt).toHaveAttribute("data-state", "off"); // the chest is open now, the rifle still falling
  let seenFalling = 0;
  for (;;) {
    const s = await a.state();
    if (s.tick >= loot.readyTick) break;
    // Still falling: on the floor, not in A's slots (A stands on it).
    expect(s.items.some((it) => it.id === loot.id)).toBe(true);
    expect(a.me(s)!.guns).toEqual([PISTOL, NO_GUN, NO_GUN]);
    seenFalling++;
    await a.page.waitForTimeout(100);
  }
  expect(seenFalling).toBeGreaterThan(0);
  // Landed: A has it, as soon as the server lets go.
  await expect.poll(gunsOf, { message: "A picked up the rifle once it landed" }).toEqual([PISTOL, RIFLE, NO_GUN]);
  expect((await a.state()).items.some((it) => it.id === loot.id)).toBe(false);

  // An open chest stays (open), and F on it does nothing more: no second drop.
  await place(code, ida, c1.x + 1, c1.z);
  const presses = a.me(await a.state())!.swapSeen;
  await a.focusGame();
  await a.page.keyboard.press("KeyF");
  await expect.poll(async () => a.me(await a.state())?.swapSeen, { message: "the server saw the F" }).toBe(presses + 1);
  expect((await a.state()).crates.find((c) => c.id === c1.id)?.open).toBe(true);
  expect((await a.state()).items).toEqual([]);

  // The real fall is short (ROYALE.lootDrop), and the loot is A's right after.
  await setLootDrop(code, ROYALE.lootDrop);
  await setLoot(code, SMG);
  const smg = await openChest(a, code, ida, c2);
  expect(smg.readyTick - smg.dropTick).toBe(ticks(ROYALE.lootDrop));
  await expect.poll(gunsOf, { message: "A picked up the SMG" }).toEqual([PISTOL, RIFLE, SMG]);
});

test("battle royale: walking over a grenade stack of another type leaves it on the floor, F swaps it in", async ({ players }) => {
  const { players: all, code } = await players.royale(2);
  const [a] = all;
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  const ida = (await a.state()).you;
  const [c1, c2] = (await a.state()).crates;
  const prompt = a.testId("hud-swap");
  const meA = async () => a.me(await a.state())!;

  // No grenades yet: like a gun into a free slot, walking over a stack takes it.
  await setLoot(code, { kind: ITEM_GRENADE, item: GRENADE_FRAG, amount: 2 });
  await openChest(a, code, ida, c1);
  await expect.poll(async () => (await meA()).grenades, { message: "A picked up the frags" }).toBe(2);
  expect((await meA()).grenade).toBe(GRENADE_FRAG);
  await expect(a.testId("hud-grenade")).toHaveAttribute("data-count", "2");

  // Holding frags, standing on a smoke stack: it stays on the floor, well after it landed.
  await setLoot(code, { kind: ITEM_GRENADE, item: GRENADE_SMOKE, amount: 1 });
  const smoke = await openChest(a, code, ida, c2);
  await expect.poll(async () => (await a.state()).tick, { message: "the smoke has landed, a second ago" }).toBeGreaterThan(smoke.readyTick + TICK_RATE);
  expect((await a.state()).items.some((it) => it.id === smoke.id)).toBe(true);
  expect((await meA()).grenade).toBe(GRENADE_FRAG);
  expect((await meA()).grenades).toBe(2);
  // The prompt offers the swap.
  await expect(prompt).toHaveAttribute("data-state", "on");
  await expect(prompt).toHaveAttribute("data-kind", "grenade");
  await expect(prompt).toHaveAttribute("data-from", "frag");
  await expect(prompt).toHaveAttribute("data-to", "smoke");
  await expect(prompt).toContainText("Swap Frag → Smoke");

  // F: the smoke in hand, the frags dropped under A's feet (not offered back until A steps off).
  await a.focusGame();
  await a.page.keyboard.press("KeyF");
  await expect.poll(async () => (await meA()).grenade, { message: "A swapped in the smoke" }).toBe(GRENADE_SMOKE);
  expect((await meA()).grenades).toBe(1);
  const frags = (await a.state()).items.find((it) => it.kind === ITEM_GRENADE && it.item === GRENADE_FRAG);
  expect(frags?.amount).toBe(2);
  expect(frags?.blockedFor).toBe(ida);
  await expect(prompt).toHaveAttribute("data-state", "off");
});

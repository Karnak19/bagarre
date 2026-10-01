// Perks: one passive bonus per player. In a duel it is picked on the
// waiting card and held from the match start: our HUD shows it, the
// opponent sees it next to our name (their HUD bar and our name plate), and
// Double dash really dashes twice (read off the server's dash counter and
// cooldown). In a battle royale perks are chest loot: walked over with none
// held, swapped with F otherwise, the old one left on the floor.

import { ITEM_PERK, PERKS, dashCooldownTicks } from "@bagarre/shared";
import { expect, openChest, setLoot, test, type Player } from "./fixtures.ts";

const DOUBLE = PERKS.findIndex((p) => p.key === "double-dash");
const BIG_MAG = PERKS.findIndex((p) => p.key === "big-mag");
const NO_PERK = 255;

/** The loot feed's line for what we got (its stable key). */
const lootRow = (p: Player, key: string) => p.page.locator(`[data-testid="hud-loot-row"][data-key="${key}"]`);

/** The name plate `p` draws for player `id` (the dev handle's `plates`). */
async function badgeOf(p: Player, id: string): Promise<string | undefined> {
  // oxlint-disable-next-line typescript/no-explicit-any
  return p.page.evaluate((id) => (window as any).__bagarre.plates.find((x: { id: string }) => x.id === id)?.badge, id);
}

/** `p` presses Space once and waits until the server took the press and the dash is over. */
async function dash(p: Player) {
  const seen = p.me(await p.state())!.dashSeen;
  await p.focusGame();
  await p.page.keyboard.press("Space");
  await expect
    .poll(async () => {
      const me = p.me(await p.state())!;
      return me.dashSeen === seen + 1 && me.dashTicks === 0;
    }, { message: `${p.name}: the server took the dash` })
    .toBe(true);
}

test("a duel: the perk picked on the waiting card is held from the start, shown to both, and Double dash dashes twice", async ({ players }) => {
  const { host: a, invite } = await players.host("duel", "A");

  // The picker on the waiting card: none by default, Double dash once clicked.
  await expect(a.testId("perk-picker")).toBeVisible();
  await expect(a.testId("perk-pick-none")).toHaveAttribute("aria-pressed", "true");
  await a.testId("perk-pick-double-dash").click();
  await expect.poll(async () => a.me(await a.state())?.perkPick).toBe(DOUBLE);

  const b = await players.join(invite, "B");
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
  const ida = (await a.state()).you;
  await expect.poll(async () => a.me(await a.state())?.perk).toBe(DOUBLE);
  expect(b.me(await b.state())?.perk).toBe(NO_PERK);

  // A's HUD: the perk box and the glyph by A's name. B's: by A's bar, and over A's head.
  await expect(a.testId("hud-perk")).toHaveAttribute("data-perk", "double-dash");
  await expect(a.testId("hud-perk")).toContainText("Double dash");
  await expect(a.testId("hud-me-perk")).toHaveText("⏩");
  await expect(b.testId("hud-opponent-perk")).toHaveText("⏩");
  await expect(b.testId("hud-perk")).toHaveCount(0);
  await expect(b.testId("hud-me-perk")).toHaveCount(0);
  await expect.poll(() => badgeOf(b, ida)).toBe("⏩");

  // Two dash charges on A's dash box, none counted on B's (one charge, the plain cooldown).
  await expect(a.testId("hud-dash")).toHaveAttribute("data-count", "2");
  await expect(b.testId("hud-dash")).not.toHaveAttribute("data-count");

  // Two dashes in a row: the second goes while the first's cooldown still
  // runs (one cooldown per charge spent is on the clock), and none is left.
  await dash(a);
  const afterOne = a.me(await a.state())!.dashCd;
  expect(afterOne).toBeGreaterThan(0);
  expect(afterOne).toBeLessThanOrEqual(dashCooldownTicks(DOUBLE));
  await dash(a);
  expect(a.me(await a.state())!.dashCd).toBeGreaterThan(dashCooldownTicks(DOUBLE));
  await expect(a.testId("hud-dash")).toHaveAttribute("data-count", "0");
  await expect(a.testId("hud-dash")).not.toHaveAttribute("data-ready");
  // The charges come back one at a time.
  await expect(a.testId("hud-dash")).toHaveAttribute("data-count", "1", { timeout: 10_000 });
  await expect(a.testId("hud-dash")).toHaveAttribute("data-ready");
});

test("battle royale: a chest's perk is taken by walking over it, a second one only with F, which leaves the first behind", async ({ players }) => {
  const { players: all, code } = await players.royale(2);
  const [a] = all;
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  const ida = (await a.state()).you;
  const [c1, c2] = (await a.state()).crates;
  const prompt = a.testId("hud-swap");
  const meA = async () => a.me(await a.state())!;

  // No picker in a royale, and no perk to start with.
  expect((await meA()).perk).toBe(NO_PERK);
  await expect(a.testId("hud-perk")).toHaveCount(0);

  // None held: walking over it takes it, with a loot feed line.
  await setLoot(code, { kind: ITEM_PERK, item: DOUBLE, amount: 1 });
  await openChest(a, code, ida, c1);
  await expect.poll(async () => (await meA()).perk, { message: "A picked up Double dash" }).toBe(DOUBLE);
  await expect(a.testId("hud-perk")).toHaveAttribute("data-perk", "double-dash");
  await expect(lootRow(a, "double-dash")).toHaveText("+⏩ Double dash");

  // Holding one, standing on another: it stays on the floor, and F offers the swap.
  await setLoot(code, { kind: ITEM_PERK, item: BIG_MAG, amount: 1 });
  const big = await openChest(a, code, ida, c2);
  await expect(prompt).toHaveAttribute("data-kind", "perk");
  await expect(prompt).toHaveAttribute("data-from", "double-dash");
  await expect(prompt).toHaveAttribute("data-to", "big-mag");
  expect((await a.state()).items.some((it) => it.id === big.id)).toBe(true);
  expect((await meA()).perk).toBe(DOUBLE);

  // F: Bigger mag held, Double dash left where A stands (not A's to take back until A steps off).
  await a.focusGame();
  await a.page.keyboard.press("KeyF");
  await expect.poll(async () => (await meA()).perk, { message: "A swapped in Bigger mag" }).toBe(BIG_MAG);
  const left = (await a.state()).items.find((it) => it.kind === ITEM_PERK && it.item === DOUBLE);
  expect(left?.blockedFor).toBe(ida);
  expect((await a.state()).items.some((it) => it.id === big.id)).toBe(false);
  await expect(a.testId("hud-perk")).toHaveAttribute("data-perk", "big-mag");
  await expect(lootRow(a, "big-mag")).toHaveText("⏩ Double dash→🔋 Bigger mag");
  await expect(prompt).toHaveAttribute("data-state", "off");
});

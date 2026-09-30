import { WEAPONS } from "@bagarre/shared";
import { expect, kill, test } from "./fixtures.ts";

test("the number keys while waiting pick each weapon, shown in the picker and put in hand on the next spawn", async ({ players }) => {
  const { host: a, code } = await players.host("duel", "A");
  await a.expectState("phase", "waiting");
  const id = (await a.state()).you;

  // Every gun the picker offers: all but the battle royale's starting Pistol, which comes last.
  const pickable = WEAPONS.filter((w) => w.pickable !== false).length;
  for (let i = 1; i <= pickable; i++) {
    await a.page.keyboard.press(`Digit${i}`);
    await expect(a.testId(`pick-${i}`)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => a.me(await a.state())?.pick).toBe(i - 1);
    // A pick goes in hand on the next spawn: die (your own shot) and respawn.
    await kill(code, id, id);
    await expect
      .poll(async () => {
        const s = await a.state();
        const me = a.me(s);
        return me?.alive ? [me.weapon, s.drawnWeapon] : null;
      })
      .toEqual([i - 1, i - 1]);
  }

  // The Pistol has no key and no button: the next number key picks nothing.
  await expect(a.testId(`pick-${pickable + 1}`)).toHaveCount(0);
  await a.page.keyboard.press(`Digit${pickable + 1}`);
  await expect(a.testId(`pick-${pickable}`)).toHaveAttribute("aria-pressed", "true");
  expect(a.me(await a.state())?.pick).toBe(pickable - 1);
});

import { expect, kill, test } from "./fixtures.ts";

test("keys 1-7 while waiting pick each weapon, shown in the picker and put in hand on the next spawn", async ({ players }) => {
  const { host: a, code } = await players.host("duel", "A");
  await a.expectState("phase", "waiting");
  const id = (await a.state()).you;

  for (let i = 1; i <= 7; i++) {
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
});

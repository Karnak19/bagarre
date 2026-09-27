import { expect, test } from "./fixtures.ts";

test("typing in the username field never moves, fires, mutes or picks a weapon", async ({ players }) => {
  const { a, b } = await players.duel();
  const before = await a.state();
  const me = a.me(before)!;
  const sfxBefore = await a.sfxCount();

  // Dev hook: the username form, whatever the account state (guests have none).
  await a.page.evaluate(() => (window as unknown as { __bagarre: { accountUi: { forceUsernameForm(): void } } }).__bagarre.accountUi.forceUsernameForm());
  const field = a.testId("username-input");
  await expect(field).toBeVisible();
  await field.click();
  await field.pressSequentially("wasd dqer m 1234567 ", { delay: 15 });
  await a.page.keyboard.down("KeyW");
  await a.page.keyboard.down("Space");
  await a.page.mouse.down();
  await a.page.waitForTimeout(400); // held keys: give a would-be move time to show
  await a.page.mouse.up();
  await a.page.keyboard.up("Space");
  await a.page.keyboard.up("KeyW");
  await expect(field).toHaveValue(/wasd dqer m 1234567/);

  const after = await a.state();
  const meAfter = a.me(after)!;
  expect([meAfter.x, meAfter.z]).toEqual([me.x, me.z]);
  expect(meAfter.pick).toBe(me.pick);
  expect(await a.page.evaluate(() => localStorage.getItem("bagarre.sfx.muted"))).not.toBe("1");
  expect(await a.sfxSince(sfxBefore)).toEqual([]);
  // Nor did the opponent see A move.
  const fromB = (await b.state()).players.find((p) => p.id === me.id)!;
  expect([fromB.x, fromB.z]).toEqual([me.x, me.z]);
});

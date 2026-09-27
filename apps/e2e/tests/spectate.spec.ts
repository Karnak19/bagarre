import { expect, test } from "./fixtures.ts";

test("watching a duel: no seat, camera modes, follow the other player, the count, then take a free seat", async ({ players }) => {
  const { a, b, code } = await players.duel();
  const names = (await a.state()).players.map((p) => p.name);

  const c = await players.open("C");
  await c.goto(`/game/${code}/watch`);
  await expect(c.testId("spectate-bar")).toBeVisible();
  await c.expectState("role", "spectator");
  const watching = c.testId("spectate-watching");
  await expect(watching).toContainText("Watching");
  const first = await watching.getAttribute("data-name");
  expect(names).toContain(first);
  await expect(c.testId("spectate-player")).toHaveCount(2);
  expect((await c.state()).players).toHaveLength(2);
  expect((await a.state()).players).toHaveLength(2);

  // Players see their audience.
  for (const p of [a, b]) await expect(p.testId("hud-spectators")).toHaveAttribute("data-count", "1");

  // 1 / 2 / 3: camera modes.
  await c.page.keyboard.press("Digit2");
  await expect.poll(async () => (await c.state()).spectator?.mode).toBe("overview");
  await c.page.keyboard.press("Digit3");
  await expect.poll(async () => (await c.state()).spectator?.mode).toBe("free");
  await c.page.keyboard.press("Digit1");
  await expect.poll(async () => (await c.state()).spectator?.mode).toBe("follow");

  // E: the next player.
  const followed = (await c.state()).spectator!.followId;
  await c.page.keyboard.press("KeyE");
  await expect.poll(async () => (await c.state()).spectator?.followId).not.toBe(followed);
  await expect(watching).not.toHaveAttribute("data-name", first!);

  // A leaves: the duel waits for a second player, and the spectator can take the seat.
  await a.page.keyboard.press("Escape");
  await a.testId("esc-leave").click();
  await expect(c.testId("spectate-join")).toBeVisible();
  await c.testId("spectate-join").click();
  await expect(c.page).toHaveURL(new RegExp(`/game/${code}(\\?|$)`));
  await c.expectState("role", "player");
  await Promise.all([b.expectState("phase", "playing"), c.expectState("phase", "playing")]);
  await expect(c.testId("hud")).toBeVisible();
  await expect(c.testId("spectate-bar")).toBeHidden();
});

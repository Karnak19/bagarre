import { expect, kill, test } from "./fixtures.ts";

test("a dropped connection: Reconnecting card, input off, then the same seat, score and weapon, and no burst of sounds", async ({ players }) => {
  const { host: a, invite, code } = await players.host("duel", "A");
  await a.page.keyboard.press("Digit3"); // sniper, from the waiting card's picker
  await expect.poll(async () => a.me(await a.state())?.pick).toBe(2);
  const b = await players.join(invite, "B");
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
  await a.expectState("card", "none");

  const before = await a.state();
  const me = a.me(before)!;
  expect(me.weapon).toBe(2);
  const idb = (await b.state()).you;
  await kill(code, me.id, idb);
  await expect.poll(async () => a.me(await a.state())?.kills).toBe(1);

  await a.waitReconnectable();
  await a.context.setOffline(true);
  await a.expectState("card", "reconnecting");
  await expect(a.testId("reconnecting-card")).toContainText("Reconnecting…");
  expect((await a.state()).inputEnabled).toBe(false);
  await expect(b.testId("hud-opponent")).toContainText("reconnecting…");

  // Meanwhile the opponent keeps shooting: none of it may play on A's return.
  await b.bot({ on: true, fire: true, aim: 0 });
  await b.page.waitForTimeout(3000); // the outage itself: nothing to poll for
  await b.bot({ on: false, fire: false });
  const sfxBefore = await a.sfxCount();

  await a.context.setOffline(false);
  await a.expectState("card", "none", 20_000);
  await expect(a.testId("reconnecting-card")).toBeHidden();
  const after = await a.state();
  expect(after.you).toBe(me.id);
  expect(after.roomId).toBe(code);
  expect(a.me(after)?.kills).toBe(1);
  expect(a.me(after)?.weapon).toBe(2);
  await expect(b.testId("hud-opponent")).not.toContainText("reconnecting…");

  await a.page.waitForTimeout(500); // let a would-be burst of sounds happen
  const played = await a.sfxSince(sfxBefore);
  expect(played.length, `sounds after the reconnection: ${played.join(", ")}`).toBeLessThanOrEqual(1);
});

test("a reload mid-match takes the same seat back", async ({ players }) => {
  const { a, b, code } = await players.duel();
  const id = (await a.state()).you;
  await a.page.reload();
  await a.page.waitForFunction(() => "__bagarre" in window);
  await a.expectState("phase", "playing");
  const s = await a.state();
  expect(s.you).toBe(id);
  expect(s.roomId).toBe(code);
  expect(s.players).toHaveLength(2);
  await b.expectState("phase", "playing");
});

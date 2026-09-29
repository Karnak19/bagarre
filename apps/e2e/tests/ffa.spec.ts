import { FFA_MAP, expect, kill, setCountdown, test } from "./fixtures.ts";

test("a private free for all: 3 players, countdown, HUD, kill feed, and a 4th player dropping in", async ({ players }) => {
  const { host: a, invite, code } = await players.host("ffa", "A");
  const b = await players.join(invite, "B", FFA_MAP);
  await expect(a.testId("ffa-players")).toContainText("2/6");
  // The countdown starts once the third player is in. The e2e one is 2 s,
  // which a starved CI page can miss between two frames: it is held open
  // until A has seen it, then let go.
  await setCountdown(code, 60);
  const c = await players.join(invite, "C", FFA_MAP);
  await expect(a.testId("ffa-countdown")).toBeVisible();
  await setCountdown(code, 0.5);
  await Promise.all([a, b, c].map((p) => p.expectState("phase", "playing")));
  for (const p of [a, b, c]) {
    await p.expectState("card", "none");
    await expect(p.testId("hud-ffa-rank")).toBeVisible();
    await expect(p.testId("hud-ffa-top")).toBeVisible();
    await expect(p.testId("hud-minimap")).toBeVisible();
  }
  expect((await a.state()).mapId).toBe(FFA_MAP);

  const [ida, idb] = [(await a.state()).you, (await b.state()).you];
  await kill(code, ida, idb);
  for (const p of [a, b, c]) await expect(p.testId("hud-killfeed-row")).toHaveCount(1);
  await expect(a.testId("hud-ffa-rank")).toContainText("1st");

  // Drop-in: a 4th player joins the match under way.
  const d = await players.join(invite, "D", FFA_MAP);
  await d.expectState("phase", "playing");
  await d.expectState("card", "none");
  await expect.poll(async () => (await a.state()).players.length).toBe(4);
  expect(d.me(await d.state())?.kills).toBe(0);
});

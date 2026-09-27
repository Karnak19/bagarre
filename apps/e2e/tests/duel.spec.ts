import { expect, kill, test } from "./fixtures.ts";

test("a private duel by link: both players reach the match on the same page", async ({ players }) => {
  const { a, b, code } = await players.duel();
  await expect(a.page).toHaveURL(new RegExp(`/game/${code}`));
  await expect(b.page).toHaveURL(new RegExp(`/game/${code}`));
  for (const p of [a, b]) {
    const s = await p.state();
    expect(s.roomId).toBe(code);
    expect(s.players).toHaveLength(2);
    await expect(p.testId("hud")).toBeVisible();
  }
});

test("Tab holds the scoreboard in a match, and Tab still moves focus on the menu", async ({ players }) => {
  const { a } = await players.duel();
  const board = a.testId("scoreboard-layer").getByTestId("scoreboard");

  await a.page.keyboard.down("Tab");
  await expect(board).toBeVisible();
  await expect(board.getByTestId("scoreboard-row")).toHaveCount(2);
  await a.page.keyboard.up("Tab");
  await expect(board).toBeHidden();

  // Tab held while the window loses focus (Alt-Tab): no keyup ever comes.
  await a.page.keyboard.down("Tab");
  await expect(board).toBeVisible();
  await a.page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(board).toBeHidden();
  await a.page.keyboard.up("Tab");

  // On the menu, Tab is the browser's again.
  const m = await players.open("M");
  await m.goto("/");
  await expect(m.testId("play")).toBeVisible();
  const before = await m.page.evaluate(() => document.activeElement?.outerHTML ?? "");
  await m.page.keyboard.press("Tab");
  await m.page.keyboard.press("Tab");
  const after = await m.page.evaluate(() => document.activeElement?.outerHTML ?? "");
  expect(after).not.toBe(before);
  expect(await m.page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
});

test("leave and come back: Esc > Leave, opponent left, Back and Forward, play again", async ({ players }) => {
  const { a, b, code } = await players.duel();

  await a.page.keyboard.press("Escape");
  await expect(a.testId("esc-menu")).toBeVisible();
  await a.testId("esc-leave").click();
  await expect(a.page).toHaveURL(/\/(\?.*)?$/);
  await expect(a.testId("menu")).toBeVisible();
  await a.expectState("roomId", "");

  // The one left behind goes back to waiting.
  await expect(b.testId("waiting-card")).toContainText("Your opponent left");
  await b.expectState("phase", "waiting");

  // Forward: the game's page again, and its seat.
  await a.page.goForward();
  await expect(a.page).toHaveURL(new RegExp(`/game/${code}`));
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
  await a.expectState("roomId", code);

  // Back: a real leave.
  await a.page.goBack();
  await expect(a.testId("menu")).toBeVisible();
  await a.expectState("roomId", "");
  await b.expectState("phase", "waiting");

  // And a new game from the menu still works.
  await a.testId("private-game").click();
  await expect(a.testId("waiting-card")).toBeVisible();
  await expect(a.page).toHaveURL(/\/game\/[A-Za-z0-9_-]+/);
  expect((await a.state()).roomId).not.toBe(code);
});

test("bad links: a full game, a stale code and a malformed one", async ({ players }) => {
  const { invite } = await players.duel();

  const c = await players.join(invite, "C");
  await expect(c.testId("notice-card")).toContainText("This game is full");
  await c.expectState("roomId", "");

  const d = await players.open("D");
  await d.goto("/game/Zz9Zz9Zz9");
  await expect(d.testId("notice-card")).toContainText("doesn't exist anymore");

  await d.goto("/game/not%20a%20code!");
  await expect(d.testId("notice-card")).toContainText("doesn't exist anymore");
  await d.testId("notice-back").click();
  await expect(d.testId("menu")).toBeVisible();
});

test("a match played to the end: result card and scoreboard on both, then a rematch in the same room", async ({ players }) => {
  const { a, b, code } = await players.duel();
  const [sa, sb] = [await a.state(), await b.state()];
  const [ida, idb] = [sa.you, sb.you];

  // The e2e server wins a duel at 2 kills.
  await kill(code, ida, idb);
  await expect.poll(async () => (await a.state()).players.find((p) => p.id === ida)?.kills).toBe(1);
  await expect.poll(async () => (await b.state()).players.find((p) => p.id === idb)?.alive).toBe(true);
  await kill(code, ida, idb);

  for (const [p, headline] of [
    [a, "You win!"],
    [b, "You lose"],
  ] as const) {
    const card = p.testId("result-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText(headline);
    await expect(card.getByTestId("scoreboard-row")).toHaveCount(2);
    // Won outright on kills: no tiebreak line (a duel can't end level).
    await expect(card.getByTestId("result-tiebreak")).toHaveCount(0);
  }

  await a.testId("rematch").click();
  await expect(a.testId("rematch")).toBeDisabled();
  // The server restarts the match on its own, in the same room.
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
  for (const p of [a, b]) {
    const s = await p.state();
    expect(s.roomId).toBe(code);
    expect(s.players.map((x) => x.kills)).toEqual([0, 0]);
    await expect(p.page).toHaveURL(new RegExp(`/game/${code}`));
  }
});

test("quick match pairs two players in a public game", async ({ players }) => {
  const a = await players.open("A");
  await a.goto("/");
  await a.testId("play").click();
  await expect(a.testId("waiting-card")).toBeVisible();
  const code = (await a.state()).roomId;

  const b = await players.open("B");
  await b.goto("/");
  await b.testId("play").click();
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
  expect((await b.state()).roomId).toBe(code);
});

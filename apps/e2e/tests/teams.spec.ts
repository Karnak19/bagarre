import { FFA_MAP, expect, kill, setCountdown, test, type Player } from "./fixtures.ts";

const RED = 0;
const BLUE = 1;

/** Our own team, from the dev handle. */
async function teamOf(p: Player): Promise<number | undefined> {
  const s = await p.state();
  return p.me(s)?.team;
}

// Four players (five pages in the second): each step waits on every page, so
// a loaded machine needs more than the default 45 s.
test.slow();

test("a private team deathmatch: balancing, a switch while waiting, the 2v2 countdown, the team score, no friendly fire", async ({ players }) => {
  const { host: a, invite, code } = await players.host("tdm", "A");
  await expect(a.testId("team-seats")).toHaveCount(2);
  const b = await players.join(invite, "B", FFA_MAP);
  const c = await players.join(invite, "C", FFA_MAP);
  for (const p of [a, b, c]) await expect.poll(async () => (await p.state()).players.length).toBe(3);

  // Joins fill the smaller team: red, blue, red. 2v1 waits.
  expect([await teamOf(a), await teamOf(b), await teamOf(c)]).toEqual([RED, BLUE, RED]);
  await expect(a.testId("team-players")).toContainText("2v1");
  await expect(a.testId("team-countdown")).toBeHidden();

  // B alone on blue can't switch (it would be 3v0); A can (1v2).
  await expect(b.testId("switch-team")).toBeDisabled();
  await expect(a.testId("switch-team")).toBeEnabled();
  await a.testId("switch-team").click();
  await expect.poll(() => teamOf(a)).toBe(BLUE);
  await expect(a.testId("team-players")).toContainText("1v2");
  await expect(a.testId("team-seats").and(a.page.locator(`[data-team="${BLUE}"]`)).getByTestId("seat")).toHaveCount(2);

  // A 4th joins the smaller team (red): 2v2, the countdown, the match. The
  // countdown is held open until A has seen it (a starved CI page can miss
  // the e2e 2 s between two frames), then let go.
  await setCountdown(code, 60);
  const d = await players.join(invite, "D", FFA_MAP);
  await expect(a.testId("team-countdown")).toBeVisible();
  await setCountdown(code, 0.5);
  expect(await teamOf(d)).toBe(RED);
  const all = [a, b, c, d];
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  await Promise.all(
    all.map(async (p) => {
      await p.expectState("card", "none");
      const hud = p.testId("hud-team");
      await expect(hud).toBeVisible();
      await expect(hud).toHaveAttribute("data-red", "0");
      await expect(hud).toHaveAttribute("data-blue", "0");
      await expect(hud).toHaveAttribute("data-you", String(await teamOf(p)));
      await expect(p.testId("hud-minimap")).toBeVisible();
    }),
  );
  expect((await a.state()).mapId).toBe(FFA_MAP);

  // A kill counts for the killer's team, on everyone's HUD and in the feed.
  const id = async (p: Player) => (await p.state()).you;
  const [ida, idb, idc, idd] = await Promise.all(all.map(id));
  await kill(code, idc, ida); // red C kills blue A
  await Promise.all(
    all.map(async (p) => {
      await expect(p.testId("hud-team")).toHaveAttribute("data-red", "1");
      await expect(p.testId("hud-team")).toHaveAttribute("data-blue", "0");
      await expect(p.testId("hud-killfeed-row")).toHaveCount(1);
    }),
  );

  // No friendly fire: the same kill between teammates does nothing.
  await kill(code, idc, idd); // red C on red D
  await kill(code, idb, idb); // blue B on itself
  await expect.poll(async () => (await c.state()).players.find((p) => p.id === idd)?.alive).toBe(true);
  const after = await c.state();
  expect(after.players.find((p) => p.id === idd)?.hp).toBe(100);
  expect(after.players.find((p) => p.id === idb)?.alive).toBe(true);
  expect([after.redScore, after.blueScore]).toEqual([1, 0]);
  await expect(c.testId("hud-killfeed-row")).toHaveCount(1);

  // Tab: the scoreboard grouped by team, with the team totals.
  await c.focusGame();
  await c.page.keyboard.down("Tab");
  const board = c.testId("scoreboard-layer").getByTestId("scoreboard");
  await expect(board.getByTestId("scoreboard-team")).toHaveCount(2);
  await expect(board.locator(`[data-testid="scoreboard-team"][data-team="${RED}"]`)).toHaveAttribute("data-score", "1");
  await expect(board.locator(`[data-testid="scoreboard-team"][data-team="${RED}"]`).getByTestId("scoreboard-row")).toHaveCount(2);
  await expect(board.locator(`[data-testid="scoreboard-team"][data-you]`)).toHaveAttribute("data-team", String(RED));
  await c.page.keyboard.up("Tab");
});

test("a spectator watches a team deathmatch in team colours, with the team score", async ({ players }) => {
  const { players: [a, b, c, d], code } = await players.teams(4);
  await Promise.all([a, b, c, d].map((p) => p.expectState("phase", "playing")));

  const w = await players.open("W");
  await w.goto(`/game/${code}/watch`, FFA_MAP);
  await expect(w.testId("spectate-bar")).toBeVisible();
  await w.expectState("role", "spectator");
  await expect(w.testId("spectate-player")).toHaveCount(4);
  // The whole map by default, and the team score in the phase line.
  await expect.poll(async () => (await w.state()).spectator?.mode).toBe("overview");
  await expect(w.testId("spectate-status")).toContainText("Red 0 – 0 Blue");
  await Promise.all([a, b, c, d].map((p) => expect(p.testId("hud-spectators")).toHaveAttribute("data-count", "1")));

  // Every player's dot is their team's colour (the theme's --bagarre-p6 / p7).
  const s = await w.state();
  const colours = await w.page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="spectate-player"]')].map((row) => {
      const dot = row.querySelector<HTMLElement>('[aria-hidden="true"]');
      return { id: row.dataset.id ?? "", colour: dot ? getComputedStyle(dot).backgroundColor : "" };
    }),
  );
  const TEAM_COLOURS = ["rgb(255, 74, 74)", "rgb(63, 140, 255)"];
  for (const { id, colour } of colours) {
    const team = s.players.find((p) => p.id === id)?.team ?? -1;
    expect(colour, `dot of ${id} (team ${team})`).toBe(TEAM_COLOURS[team]);
  }

  // A kill updates the spectator's score line.
  const blue = s.players.find((p) => p.team === BLUE)!;
  const red = s.players.find((p) => p.team === RED)!;
  await kill(code, blue.id, red.id);
  await expect(w.testId("spectate-status")).toContainText("Red 0 – 1 Blue");
});

test("the menu's team deathmatch: quick match opens a public game, listed with its mode and team counts", async ({ players }) => {
  const x = await players.open("X");
  await x.goto("/", FFA_MAP);
  await x.testId("play-tdm").click();
  await expect(x.testId("waiting-card")).toBeVisible();
  await x.expectState("mode", "tdm");
  const roomId = (await x.state()).roomId;

  const y = await players.open("Y");
  await y.goto("/", FFA_MAP);
  const row = y.page.locator(`[data-testid="open-game"][data-room="${roomId}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-mode", "tdm");
  await expect(row).toHaveAttribute("data-action", "join");
  await expect(row).toContainText("Team deathmatch");
  await expect(row).toContainText("1v0");
});

// The music follows the game through `__bagarre.music` (audio.ts'
// musicDebug): what it asks for is checked everywhere; what is actually heard
// only where the browser runs audio (headless Chromium on a Mac does, a CI
// runner may have no audio device), and never by listening.

import { expect, kill, test, type Player } from "./fixtures.ts";

const MATCH_TRACK = /^match_[1-4]$/;

/** Where audio runs, the wanted track ends up decoded and playing; never more than two tracks held. */
async function heard(p: Player, track: string | null) {
  const m = await p.music();
  expect(m.held).toBeLessThanOrEqual(2);
  if (!m.running) return;
  await expect.poll(async () => (await p.music()).playing, { timeout: 15_000, message: `${p.name}: music heard` }).toBe(track);
  await expect.poll(async () => (await p.music()).held).toBeLessThanOrEqual(track ? 1 : 0);
}

test("music: the menu's track, a match track while it's on, silence at its end, another track on the rematch, the menu's again after", async ({
  players,
}) => {
  const { a, b, code } = await players.duel();
  const [ida, idb] = [(await a.state()).you, (await b.state()).you];

  // In the match: a match track on both.
  for (const p of [a, b]) {
    await expect.poll(async () => (await p.music()).mood).toBe("match");
    const m = await p.music();
    expect(m.wanted).toMatch(MATCH_TRACK);
    await heard(p, m.wanted);
  }
  const first = (await a.music()).wanted;

  // The match ends (the e2e server wins a duel at 2 kills): silence, for the sting.
  await kill(code, ida, idb);
  await expect.poll(async () => (await a.state()).players.find((p) => p.id === ida)?.kills).toBe(1);
  await expect.poll(async () => (await b.state()).players.find((p) => p.id === idb)?.alive).toBe(true);
  await kill(code, ida, idb);
  await expect(a.testId("result-card")).toBeVisible();
  await expect.poll(async () => (await a.music()).mood).toBe("off");
  expect((await a.music()).wanted).toBeNull();
  await heard(a, null);

  // The rematch: a match track again, never the one just heard.
  await a.testId("rematch").click();
  await a.expectState("phase", "playing");
  await expect.poll(async () => (await a.music()).mood).toBe("match");
  const second = (await a.music()).wanted;
  expect(second).toMatch(MATCH_TRACK);
  expect(second).not.toBe(first);
  await heard(a, second);

  // Back on the menu: its track again.
  await a.page.keyboard.press("Escape");
  await a.testId("esc-leave").click();
  await expect(a.testId("menu")).toBeVisible();
  await expect.poll(async () => (await a.music()).wanted).toBe("menu");
  await heard(a, "menu");
  expect(a.errors).toEqual([]);
});

test("music: none while its volume is 0, and the menu's track on the Maps page", async ({ players }) => {
  const a = await players.open("A");
  await a.goto("/");
  await a.testId("open-settings").click();
  const music = a.testId("settings-music").getByRole("slider");
  await expect.poll(async () => (await a.music()).wanted).toBe("menu");
  await heard(a, "menu");
  // Down to 0: the track fades out and is let go.
  await music.focus();
  await a.page.keyboard.press("Home");
  await expect(music).toHaveAttribute("aria-valuenow", "0");
  await heard(a, null);
  await a.page.keyboard.press("End");
  await expect(music).toHaveAttribute("aria-valuenow", "100");
  await heard(a, "menu");
  await a.page.keyboard.press("Escape");

  // The Maps page's walk (loaded directly) is on the menu screen: same
  // track, once a click lets sound start.
  await a.goto("/maps/yard");
  await expect(a.testId("walk")).toBeVisible();
  expect((await a.music()).wanted).toBe("menu");
  await a.page.locator("#game").click();
  await heard(a, "menu");
  expect(a.errors).toEqual([]);
});

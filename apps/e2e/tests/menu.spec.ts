import { SERVER_PORT } from "../playwright.config.ts";
import { expect, test } from "./fixtures.ts";

test("the menu loads clean and opens no game connection until a game is picked", async ({ players }) => {
  const a = await players.open("A");
  const sockets: string[] = [];
  a.page.on("websocket", (ws) => {
    if (ws.url().includes(`:${SERVER_PORT}`)) sockets.push(ws.url());
  });
  await a.goto("/");
  await expect(a.testId("menu")).toBeVisible();
  await expect(a.testId("play")).toBeVisible();
  await expect(a.testId("open-games")).toBeVisible();
  // The open games list polls GET /games; that's HTTP, not a game connection.
  await expect.poll(() => a.state().then((s) => s.screen)).toBe("menu");
  await a.page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
  expect(sockets).toEqual([]);
  expect((await a.state()).roomId).toBe("");
  expect(a.errors).toEqual([]);
});

for (const [open, panel] of [
  ["open-howto", "panel-howto"],
  ["open-settings", "panel-settings"],
  ["account-chip", "panel-account"],
  ["open-leaderboard", "panel-leaderboard"],
] as const) {
  test(`${panel} opens, closes with Esc and with the close button, and gives focus back`, async ({ players }) => {
    const a = await players.open("A");
    await a.goto("/");
    const opener = a.testId(open);
    const dialog = a.testId(panel);

    await opener.click();
    await expect(dialog).toBeVisible();
    await a.page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    await opener.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(a.errors).toEqual([]);
  });
}

test("volume, music volume and mute are remembered after a reload", async ({ players }) => {
  const a = await players.open("A");
  await a.goto("/");
  await a.testId("open-settings").click();
  const slider = a.testId("settings-volume").getByRole("slider");
  const music = a.testId("settings-music").getByRole("slider");
  const mute = a.testId("settings-mute").getByRole("switch");
  const before = Number(await slider.getAttribute("aria-valuenow"));
  await slider.focus();
  await a.page.keyboard.press("ArrowLeft");
  await a.page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", String(before - 10));
  // The music has its own volume, 50 % by default.
  await expect(music).toHaveAttribute("aria-valuenow", "50");
  await music.focus();
  await a.page.keyboard.press("ArrowRight");
  await expect(music).toHaveAttribute("aria-valuenow", "55");
  await expect(slider).toHaveAttribute("aria-valuenow", String(before - 10));
  await expect(mute).not.toBeChecked();
  await mute.click();
  await expect(mute).toBeChecked();

  await a.page.reload();
  await a.testId("open-settings").click();
  await expect(a.testId("settings-volume").getByRole("slider")).toHaveAttribute("aria-valuenow", String(before - 10));
  await expect(a.testId("settings-music").getByRole("slider")).toHaveAttribute("aria-valuenow", "55");
  await expect(a.testId("settings-mute").getByRole("switch")).toBeChecked();
});

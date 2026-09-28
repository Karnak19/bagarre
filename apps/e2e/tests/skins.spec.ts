// Skins: a signed-in player picks one in the account panel and everyone in
// the match sees it on them; guests get a random one rolled by the server.
//
// Read through the dev handle (`__bagarre.skins()`: the skin each character
// wears, by session id), never through pixels. Only the `skin` field is
// checked, never whether the model finished loading: with software WebGL a
// model can take a long time, and nothing here depends on it.

import { isSkinId } from "@bagarre/shared";
import { expect, signUp, test, unique, type Player } from "./fixtures.ts";

type Skins = Record<string, { skin: string; loaded: boolean }>;

function skins(p: Player): Promise<Skins> {
  // oxlint-disable-next-line typescript/no-explicit-any
  return p.page.evaluate(() => (window as any).__bagarre.skins());
}

/** Waits, in the page, until the character of `id` wears a skin (a given one, or any). */
async function waitSkin(p: Player, id: string, skin?: string): Promise<string> {
  const handle = await p.page.waitForFunction(
    ({ id, skin }) => {
      // oxlint-disable-next-line typescript/no-explicit-any
      const got = (window as any).__bagarre.skins?.()?.[id]?.skin;
      if (typeof got !== "string" || !got) return false;
      return skin === undefined || got === skin ? got : false;
    },
    { id, skin },
    { timeout: 30_000, polling: 100 },
  );
  return (await handle.jsonValue()) as string;
}

const option = (p: Player, skin: string) => p.testId("panel-account").locator(`[data-testid="skin-option"][data-skin="${skin}"]`);

test("a signed-in player picks a skin in the account panel, and the opponent sees it on them", async ({ players }) => {
  const a = await players.open("A");
  await a.goto("/");
  await signUp(a, unique());
  const panel = a.testId("panel-account");
  const picker = panel.getByTestId("skin-picker");

  // A new account has no saved skin: Random.
  await expect(picker).toHaveAttribute("data-skin", "random");
  await expect(panel.getByRole("radio", { name: "Random" })).toBeChecked();

  // Pick one: it's saved on the account (the picker shows the server's answer) and previewed.
  await option(a, "knight-golden-male").click();
  await expect(picker).toHaveAttribute("data-skin", "knight-golden-male");
  await expect(panel.getByRole("radio", { name: "Golden knight" })).toBeChecked();
  await expect(panel.getByTestId("skin-preview")).toHaveAttribute("data-skin", "knight-golden-male");
  await expect(panel.getByTestId("skin-error")).toBeHidden();

  // Saved on the account: still there after a reload.
  await a.page.reload();
  await a.page.waitForFunction(() => "__bagarre" in window);
  await a.testId("account-chip").click();
  await expect(picker).toHaveAttribute("data-skin", "knight-golden-male");
  await expect(panel.getByRole("radio", { name: "Golden knight" })).toBeChecked();
  await a.page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // A hosts a private duel, B joins by the link as a guest.
  await a.testId("private-game").click();
  await expect(a.testId("waiting-card")).toBeVisible();
  const b = await players.join(await a.testId("invite-link").inputValue(), "B");
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);

  const idA = (await a.state()).you;
  // B sees A in the chosen skin, and so does A.
  await waitSkin(b, idA, "knight-golden-male");
  await waitSkin(a, idA, "knight-golden-male");
  // B, a guest, got a real skin, the same on both sides.
  const idB = (await b.state()).you;
  const skinB = await waitSkin(b, idB);
  expect(isSkinId(skinB)).toBe(true);
  await waitSkin(a, idB, skinB);
});

test("a guest can't choose a skin, and gets a random one in a match", async ({ players }) => {
  // In the menu: the picker shows, disabled, with a prompt to sign in.
  const g = await players.open("G");
  await g.goto("/");
  await g.testId("account-chip").click();
  const panel = g.testId("panel-account");
  await expect(panel.getByTestId("skin-sign-in")).toContainText("Sign in to choose your skin");
  await expect(panel.getByRole("radio", { name: "Random" })).toBeChecked();
  const knight = panel.getByRole("radio", { name: "Golden knight" });
  await expect(knight).toHaveAttribute("aria-disabled", "true");
  // The keyboard can still reach the list (to hear why it's disabled), but not change it.
  const random = panel.getByRole("radio", { name: "Random" });
  await random.focus();
  await g.page.keyboard.press("ArrowDown");
  await expect(random).toBeChecked();
  await expect(knight).not.toBeChecked();

  // Two guests in a duel: each wears a skin from SKINS, and both clients agree.
  const { a, b } = await players.duel();
  const idA = (await a.state()).you;
  const idB = (await b.state()).you;
  const skinA = await waitSkin(a, idA);
  const skinB = await waitSkin(a, idB);
  expect(isSkinId(skinA)).toBe(true);
  expect(isSkinId(skinB)).toBe(true);
  await waitSkin(b, idA, skinA);
  await waitSkin(b, idB, skinB);
  // The server prefers a skin nobody else in the room wears.
  expect(skinA).not.toBe(skinB);
  expect(Object.keys(await skins(b)).sort()).toEqual([idA, idB].sort());
});

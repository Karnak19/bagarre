// Accounts, held by the game server (@colyseus/auth, an in-memory database in
// the e2e server): sign up, choose a username, sign out and in again, play
// under the username, the leaderboard, and guests who keep playing as before.

import { expect, kill, test, type Player } from "./fixtures.ts";

/** A fresh email and username per call, so parallel tests and reruns never collide. */
function unique() {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`.slice(-10);
  return { email: `e2e-${id}@example.com`, username: `p_${id}`, password: "hunter22" };
}

const GUEST = /^Guest-\d{4}$/;

/** Signs up through the account panel and saves a username; leaves the panel open. */
async function signUp(p: Player, who: { email: string; username: string; password: string }) {
  await p.testId("account-chip").click();
  const panel = p.testId("panel-account");
  await expect(panel).toBeVisible();
  await panel.getByTestId("auth-to-sign-up").click();
  await expect(panel.getByTestId("sign-up")).toBeVisible();
  await panel.getByTestId("auth-email").fill(who.email);
  await panel.getByTestId("auth-password").fill(who.password);
  await panel.getByTestId("auth-submit").click();
  // A new account has no username yet: the form shows by itself.
  await expect(panel.getByTestId("username-form")).toBeVisible();
  await expect(panel.getByTestId("account-line")).toContainText("Pick a username");
  await panel.getByTestId("username-input").fill(who.username);
  await panel.getByTestId("username-save").click();
  await expect(panel.getByTestId("account-name")).toHaveText(who.username);
  await expect(panel.getByTestId("username-form")).toBeHidden();
}

test("sign up, choose a username, sign out, and sign in again", async ({ players }) => {
  const a = await players.open("A");
  await a.goto("/");
  const chipName = a.testId("account-chip-name");
  await expect(chipName).toHaveText(GUEST);
  const guest = (await chipName.textContent())!;
  const who = unique();

  await signUp(a, who);
  const panel = a.testId("panel-account");
  await expect(panel.getByTestId("account-stats")).toBeVisible();
  await a.page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(chipName).toHaveText(who.username);

  // Sign out: back to this browser's guest name.
  await a.testId("account-chip").click();
  await panel.getByTestId("sign-out").click();
  await expect(panel.getByTestId("sign-in")).toBeVisible();
  await expect(panel.getByTestId("account-name")).toHaveText(guest);
  await expect(chipName).toHaveText(guest);

  // A wrong password says so.
  await panel.getByTestId("auth-email").fill(who.email);
  await panel.getByTestId("auth-password").fill("not-the-password");
  await panel.getByTestId("auth-submit").click();
  await expect(panel.getByTestId("auth-error")).toContainText("Wrong email or password");

  // The right one, with the email typed differently: the username is back.
  await panel.getByTestId("auth-email").fill(`  ${who.email.toUpperCase()} `);
  await panel.getByTestId("auth-password").fill(who.password);
  await panel.getByTestId("auth-submit").click();
  await expect(panel.getByTestId("account-name")).toHaveText(who.username);
  await expect(panel.getByTestId("username-form")).toBeHidden();
  await expect(chipName).toHaveText(who.username);

  // The session outlives a reload.
  await a.page.reload();
  await expect(chipName).toHaveText(who.username);

  // Signing up again with the same email is refused.
  await a.testId("account-chip").click();
  await panel.getByTestId("sign-out").click();
  await panel.getByTestId("auth-to-sign-up").click();
  await panel.getByTestId("auth-email").fill(who.email);
  await panel.getByTestId("auth-password").fill(who.password);
  await panel.getByTestId("auth-submit").click();
  await expect(panel.getByTestId("auth-error")).toContainText("already uses this email");
  // The two refusals above are HTTP errors the browser logs by itself; nothing else.
  expect(a.errors.filter((e) => !e.includes("Failed to load resource"))).toEqual([]);
});

test("a signed-in player plays under their username against a guest, and the win reaches the leaderboard", async ({ players }) => {
  const a = await players.open("A");
  await a.goto("/");
  const who = unique();
  await signUp(a, who);
  await a.page.keyboard.press("Escape");
  await expect(a.testId("account-chip-name")).toHaveText(who.username);

  // A private duel: A hosts signed in, B joins by the link as a guest.
  await a.testId("private-game").click();
  await expect(a.testId("waiting-card")).toBeVisible();
  const invite = await a.testId("invite-link").inputValue();
  const b = await players.join(invite, "B");
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);

  const s = await a.state();
  const meA = a.me(s)!;
  const other = s.players.find((p) => p.id !== s.you)!;
  expect(meA.name).toBe(who.username);
  expect(meA.account).toBe(true);
  expect(other.name).toMatch(GUEST);
  expect(other.account).toBe(false);
  // B sees the same names.
  const fromB = await b.state();
  expect(fromB.players.find((p) => p.id === meA.id)!.name).toBe(who.username);
  expect(b.me(fromB)!.name).toMatch(GUEST);

  // A wins (two kills in the e2e rules): the match is recorded for A's account.
  await kill(s.roomId, meA.id, other.id);
  await expect.poll(async () => a.me(await a.state())!.kills).toBe(1);
  await expect.poll(async () => (await a.state()).players.find((p) => p.id === other.id)?.alive).toBe(true);
  await kill(s.roomId, meA.id, other.id);
  await expect(a.testId("result-card")).toContainText("You win!");
  await a.page.evaluate(() => {
    const out: string[] = [];
    // oxlint-disable-next-line typescript/no-explicit-any
    (window as any).__probe = out;
    const t0 = performance.now();
    const tick = () => {
      const el = document.querySelector('[data-testid="main-menu"]');
      if (!el || performance.now() - t0 > 8000) return;
      const b = el.getBoundingClientRect();
      const c = document.querySelector('[data-testid="result-card"]')!;
      // oxlint-disable-next-line typescript/no-explicit-any
      const g = (window as any).__bagarre;
      // oxlint-disable-next-line typescript/no-explicit-any
      const ww = window as any;
      if (ww.__el && ww.__el !== el) ww.__remounts = (ww.__remounts ?? 0) + 1;
      ww.__el = el;
      const k0 = `screen=${g.app.getState().screen} net=${g.app.match?.net.status} phase=${g.app.match?.latest?.phase} remounts=${ww.__remounts ?? 0} renders=${g.renders?.["card.result"] ?? "?"} `;
      const k = k0 + `${b.x.toFixed(2)},${b.y.toFixed(2)},${b.width.toFixed(2)}x${b.height.toFixed(2)} card=${c.getBoundingClientRect().height.toFixed(2)} anim=${document.getAnimations().map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty).join(",")} hover=${[...document.querySelectorAll(":hover")].pop()?.getAttribute("data-testid")}`;
      const now = performance.now();
      // oxlint-disable-next-line typescript/no-explicit-any
      const w = window as any;
      w.__gaps = [...(w.__gaps ?? []), Math.round(now - (w.__last ?? now))].slice(-400);
      w.__last = now;
      if (out.length === 0) out.push("bf=" + [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).backdropFilter !== "none").map((e) => (e.getAttribute("data-testid") ?? e.tagName) + ":" + getComputedStyle(e).backdropFilter).join(";"));
      if (out[out.length - 1]?.split("|")[1] !== k) out.push(`${Math.round(performance.now() - t0)}|${k}`);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  try {
    await a.testId("main-menu").click({ timeout: 6000 });
  } finally {
    // oxlint-disable-next-line typescript/no-explicit-any
    console.log("PROBE", JSON.stringify(await a.page.evaluate(() => [...(window as any).__probe, "gaps " + (window as any).__gaps.join(",")]).catch(() => null), null, 1));
  }
  await a.expectState("screen", "menu");

  // The server records the match on its own time: read the account until it shows.
  await expect
    .poll(() =>
      a.page.evaluate(async () => {
        // oxlint-disable-next-line typescript/no-explicit-any
        const acc = (window as any).__bagarre.account;
        await acc.refresh();
        return acc.state.account?.stats.wins ?? -1;
      }),
    )
    .toBe(1);
  await expect(a.testId("account-chip")).toContainText("1 W");
  await a.testId("open-leaderboard").click();
  const board = a.testId("leaderboard");
  await expect(board).toHaveAttribute("data-state", "ok");
  const row = board.locator(`[data-testid="leaderboard-row"][data-username="${who.username}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-you", "true");
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test("two guests still duel under their guest names", async ({ players }) => {
  const { a, b } = await players.duel();
  for (const p of [a, b]) {
    const s = await p.state();
    expect(s.players).toHaveLength(2);
    for (const pl of s.players) {
      expect(pl.name).toMatch(GUEST);
      expect(pl.account).toBe(false);
    }
  }
});

test("the password reset page refuses a bad link and leads back to the menu", async ({ players }) => {
  const a = await players.open("A");
  await a.goto("/reset-password");
  await expect(a.testId("reset-password")).toBeVisible();
  await expect(a.testId("reset-password-error")).toContainText("missing its reset token");

  await a.goto("/reset-password?token=not-a-real-token");
  await a.testId("reset-password-input").fill("newpass1");
  await a.testId("reset-password-confirm").fill("newpass2");
  await a.testId("reset-password-submit").click();
  await expect(a.testId("reset-password-error")).toContainText("don't match");
  await a.testId("reset-password-confirm").fill("newpass1");
  await a.testId("reset-password-submit").click();
  await expect(a.testId("reset-password-error")).toBeVisible();
  await expect(a.testId("reset-password-done")).toBeHidden();

  await a.testId("reset-password-back").click();
  await expect(a.page).toHaveURL(/\/(\?.*)?$/);
  await expect(a.testId("menu")).toBeVisible();
  expect(a.errors).toEqual([]);
});

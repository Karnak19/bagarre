// The battle royale's host start: the first player in is the host and starts
// the match with Start (or Enter), once enough players are in; nothing else
// starts it, not a countdown, not a full room, not a rematch, not a start
// request from anyone else. If the host leaves, the next one in takes over.

import { ROYALE_MIN_PLAYERS } from "@bagarre/shared";
import { expect, kill, pressStart, setWarmup, test, type Player } from "./fixtures.ts";

/**
 * Sends a start request straight through the page's room, as a tampered
 * client would, then waits for the server to have run a few ticks past it
 * (its messages are handled in order, before the next ticks' patches).
 */
async function sendStart(p: Player) {
  const tick = (await p.state()).tick;
  // oxlint-disable-next-line typescript/no-explicit-any
  await p.page.evaluate(() => (window as any).__bagarre.net.room.send("start", {}));
  await expect.poll(async () => (await p.state()).tick, { message: `${p.name}: the server ticked past the start request` }).toBeGreaterThan(tick + 10);
}

const nameOf = async (p: Player, id: string) => (await p.state()).players.find((x) => x.id === id)?.name ?? "";

test("battle royale: the host sees Start, the others wait for them; nobody else can start it, nor the host alone; the next one in takes over, and Start begins the warmup", async ({
  players,
}) => {
  const { host: a, invite, code } = await players.host("royale", "A");
  const ida = (await a.state()).you;
  await a.expectState("host", ida);

  // Alone: Start shows but can't be used, and says why. A click, Enter or a request straight to the room do nothing.
  const start = a.testId("royale-start");
  await expect(start).toBeVisible();
  await expect(start).toHaveAttribute("data-ready", "false");
  await expect(start).toBeDisabled();
  await expect(start).toBeFocused();
  await expect(a.testId("royale-start-hint")).toContainText(`needs ${ROYALE_MIN_PLAYERS - 1 === 1 ? "one more player" : `${ROYALE_MIN_PLAYERS - 1} more players`}`);
  await expect(a.testId("royale-start-hint")).toContainText("invite link");
  await start.click({ force: true });
  await a.page.keyboard.press("Enter");
  await sendStart(a);
  await a.expectState("phase", "waiting");

  // B joins: A's Start is ready; B sees who they wait for, and no Start. B's own request is ignored.
  const b = await players.join(invite, "B", "ironvale");
  await expect.poll(async () => (await b.state()).players.length).toBe(2);
  const idb = (await b.state()).you;
  await expect(start).toHaveAttribute("data-ready", "true");
  await expect(start).toHaveAttribute("data-players", "2");
  await expect(start).toBeEnabled();
  await expect(start).toContainText("2/10 players");
  await b.expectState("host", ida);
  await expect(b.testId("royale-waiting-host")).toHaveText(`Waiting for ${await nameOf(b, ida)} to start`);
  await expect(b.testId("royale-players")).toContainText("2/10 players");
  await expect(b.testId("royale-start")).toHaveCount(0);
  await expect(b.testId("seat").and(b.page.locator("[data-host]"))).toContainText(await nameOf(b, ida));
  await sendStart(b);
  await b.expectState("phase", "waiting");
  await a.expectState("phase", "waiting");

  // C joins, then the host leaves: B, next in, is host at once, and C now waits for B.
  const c = await players.join(invite, "C", "ironvale");
  await expect(start).toHaveAttribute("data-players", "3");
  await a.testId("waiting-cancel").click();
  await b.expectState("host", idb);
  await c.expectState("host", idb);
  await expect(b.testId("royale-start")).toHaveAttribute("data-ready", "true");
  await expect(b.testId("royale-start")).toHaveAttribute("data-players", "2");
  await expect(b.testId("royale-waiting-host")).toHaveCount(0);
  await expect(c.testId("royale-waiting-host")).toHaveText(`Waiting for ${await nameOf(c, idb)} to start`);
  await expect(c.testId("royale-start")).toHaveCount(0);
  await b.expectState("phase", "waiting");

  // B presses Enter (Start took the focus when B became host): the warmup begins for everyone.
  await setWarmup(code, 30);
  await expect(b.testId("royale-start")).toBeFocused();
  await b.page.keyboard.press("Enter");
  for (const p of [b, c]) {
    await p.expectState("phase", "warmup");
    await expect(p.testId("warmup")).toBeVisible();
  }
  await setWarmup(code, 1);
  for (const p of [b, c]) await p.expectState("phase", "playing");
});

test("battle royale: after the result everyone is back in the lobby, on their feet, and only the host's Start begins the next match", async ({ players }) => {
  const { players: all, code } = await players.royale(2);
  const [a, b] = all;
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  const [ida, idb] = await Promise.all(all.map(async (p) => (await p.state()).you));

  await kill(code, ida, idb);
  for (const p of all) await p.expectState("phase", "ended");
  await expect(a.testId("result-countdown")).toContainText("Back to the lobby");
  // No Rematch in a royale (nothing to stay for), and the card's focus isn't on Main menu, so Enter can't leave.
  await expect(a.testId("rematch")).toHaveCount(0);
  await expect(a.testId("main-menu")).not.toBeFocused();

  // After the result: waiting (no rematch on its own), the knocked-out player back up, the host's Start ready.
  for (const p of all) await p.expectState("phase", "waiting", 30_000);
  for (const p of all) await p.expectState("card", "waiting");
  await expect.poll(async () => (await b.state()).players.find((p) => p.id === idb)?.alive).toBe(true);
  await expect(a.testId("royale-start")).toHaveAttribute("data-ready", "true");
  await expect(b.testId("royale-waiting-host")).toBeVisible();
  await sendStart(b);
  await a.expectState("phase", "waiting");

  await pressStart(a, 2);
  for (const p of all) await p.expectState("phase", "playing");
});

test("battle royale: a dropped player doesn't count toward Start until they are back", async ({ players }) => {
  const { players: all } = await players.royaleLobby(2);
  const [a, b] = all;
  const start = a.testId("royale-start");
  await expect(start).toHaveAttribute("data-ready", "true");

  // B's connection drops: the server holds B's seat but won't start without B, so Start is off and says why.
  const nameB = b.me(await b.state())?.name ?? "";
  await b.waitReconnectable();
  await b.context.setOffline(true);
  await expect(start).toHaveAttribute("data-ready", "false");
  await expect(start).toBeDisabled();
  await expect(a.testId("royale-start-hint")).toHaveText(`Waiting for ${nameB} to reconnect.`);
  await a.page.keyboard.press("Enter");
  await sendStart(a);
  await a.expectState("phase", "waiting");

  // Back: Start is ready again.
  await b.context.setOffline(false);
  await expect(start).toHaveAttribute("data-ready", "true");
  await expect(a.testId("royale-start-hint")).toHaveCount(0);
});

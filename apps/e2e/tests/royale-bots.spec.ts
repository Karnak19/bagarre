// Bots in the battle royale (#48): the host adds and removes them from the
// lobby, nobody else can, they take seats with bot names and a BOT tag (the
// lobby seats, the name plate, the scoreboard, the placement table), never
// become host, and one person with bots can start a match. For now bots
// stand still (the server feeds them a neutral input); playing comes next.

import { ROYALE_MAX_PLAYERS } from "@bagarre/shared";
import { ROYALE_MAP, expect, kill, listedRooms, place, pressStart, roomExists, test, type Player, type Players } from "./fixtures.ts";

/** Sends a bot request straight through the page's room, as a tampered client would, then lets the server tick past it. */
async function sendBot(p: Player, type: "bot:add" | "bot:remove") {
  const tick = (await p.state()).tick;
  // oxlint-disable-next-line typescript/no-explicit-any
  await p.page.evaluate((t) => (window as any).__bagarre.net.room.send(t, {}), type);
  await expect.poll(async () => (await p.state()).tick, { message: `${p.name}: the server ticked past the bot request` }).toBeGreaterThan(tick + 10);
}

const bots = async (p: Player) => (await p.state()).players.filter((x) => x.bot);

test("battle royale: only the host adds and removes bots; they get bot names and a BOT tag, never the host's seat", async ({ players }) => {
  const { host: a, invite } = await players.host("royale", "A");
  const ida = (await a.state()).you;
  const add = a.testId("royale-add-bot");
  const remove = a.testId("royale-remove-bot");
  await expect(add).toBeVisible();
  await expect(remove).toBeDisabled();

  // B, not the host, sees no bot buttons, and its own requests are ignored.
  const b = await players.join(invite, "B", "ironvale");
  await expect.poll(async () => (await b.state()).players.length).toBe(2);
  await expect(b.testId("royale-add-bot")).toHaveCount(0);
  await expect(b.testId("royale-remove-bot")).toHaveCount(0);
  await sendBot(b, "bot:add");
  expect((await b.state()).players.length).toBe(2);

  // The host adds two: both seated, as bots with bot names, tagged in everyone's lobby.
  await add.click();
  await add.click();
  for (const p of [a, b]) await expect.poll(async () => (await bots(p)).length).toBe(2);
  const added = await bots(a);
  for (const bot of added) {
    expect(bot.name).toMatch(/^Bot /);
    expect(bot.connected).toBe(true);
  }
  for (const p of [a, b]) {
    const seats = p.testId("seat").and(p.page.locator("[data-bot]"));
    await expect(seats).toHaveCount(2);
    for (const seat of await seats.all()) await expect(seat).toContainText("BOT");
  }
  await expect(a.testId("royale-start")).toHaveAttribute("data-players", "4");
  await a.expectState("host", ida);
  await sendBot(b, "bot:remove");
  expect((await bots(a)).length).toBe(2);

  // Remove: the last one added goes.
  await expect(remove).toHaveAttribute("data-bots", "2");
  await remove.click();
  await expect.poll(async () => (await bots(a)).map((x) => x.id)).toEqual([added[0].id]);
  await expect(a.testId("royale-start")).toHaveAttribute("data-players", "3");

  // The host leaves: B is host, never the bot that was in before B.
  await a.testId("waiting-cancel").click();
  await b.expectState("host", (await b.state()).you);
  await expect(b.testId("royale-add-bot")).toBeVisible();

  // Up to the seat cap, no further.
  const addB = b.testId("royale-add-bot");
  for (let n = 2; n < ROYALE_MAX_PLAYERS; n++) {
    await addB.click();
    await expect(b.testId("royale-start")).toHaveAttribute("data-players", String(n + 1));
  }
  await expect(addB).toBeDisabled();
  await sendBot(b, "bot:add");
  expect((await b.state()).players.length).toBe(ROYALE_MAX_PLAYERS);
});

test("battle royale: one person with bots starts a match; the bots carry the BOT tag on their plate, the scoreboard and the placement table", async ({ players }) => {
  const { host: a, code } = await players.host("royale", "A");
  const ida = (await a.state()).you;
  await expect(a.testId("royale-start")).toHaveAttribute("data-ready", "false");
  await a.testId("royale-add-bot").click();
  await a.testId("royale-add-bot").click();
  await pressStart(a, 3);
  await a.expectState("phase", "playing");
  const [b1, b2] = await bots(a);

  // A bot next to us: its plate carries the BOT tag.
  const me = a.me(await a.state())!;
  await place(code, b1.id, me.x + 2, me.z);
  await a.page.waitForFunction(
    // oxlint-disable-next-line typescript/no-explicit-any
    (id) => (window as any).__bagarre.plates.some((x: { id: string; visible: boolean; badge: string }) => x.id === id && x.visible && x.badge.startsWith("BOT")),
    b1.id,
    { timeout: 15_000, polling: 50 },
  );

  // The scoreboard (Tab): a BOT tag on each bot's row, ping "–".
  const board = a.testId("scoreboard-layer").getByTestId("scoreboard");
  await a.page.keyboard.down("Tab");
  await expect(board).toBeVisible();
  await expect(board.getByTestId("player-tag").filter({ hasText: "BOT" })).toHaveCount(2);
  await a.page.keyboard.up("Tab");

  // Both bots out: A wins, and the placement table shows them with their tag.
  await kill(code, ida, b1.id);
  await kill(code, ida, b2.id);
  await a.expectState("phase", "ended");
  await expect(a.testId("result-card")).toContainText("You won!");
  await expect(a.testId("placement-row")).toHaveCount(3);
  await expect(a.testId("placement-row").getByTestId("player-tag").filter({ hasText: "BOT" })).toHaveCount(2);
  // One person: not counted in the stats, bots don't make up the number.
  await expect(a.testId("result-stats")).toContainText("bots not included");
});

/**
 * A public battle royale (quick match, so it is listed), hosted by A with two
 * bots in it and C watching. With C in, Colyseus would keep the room open on
 * its own: only the server's "only bots left" rule closes it.
 */
async function publicRoyaleWithBots(players: Players) {
  const a = await players.open("A");
  await a.goto("/", ROYALE_MAP);
  await a.testId("play-royale").click();
  await expect(a.testId("waiting-card")).toBeVisible();
  const roomId = (await a.state()).roomId;
  await a.testId("royale-add-bot").click();
  await a.testId("royale-add-bot").click();
  await expect.poll(async () => (await bots(a)).length).toBe(2);
  await expect.poll(listedRooms, { message: "the room is listed while A is in" }).toContain(roomId);
  const c = await players.open("C");
  await c.goto(`/game/${roomId}/watch`, ROYALE_MAP);
  await c.expectState("role", "spectator");
  return { a, c, roomId };
}

/** After the last person left: the room closes (the spectator is told) and isn't listed any more. */
async function expectClosed(c: Player, roomId: string) {
  await expect(c.testId("notice")).toContainText("The game ended");
  await expect.poll(() => roomExists(roomId), { message: "the room is gone" }).toBe(false);
  expect(await listedRooms()).not.toContain(roomId);
}

// Both quick-match into the public royale: one after the other, so they never share a room.
test.describe.serial("battle royale: the last person leaving closes the room, bots or not", () => {
  test("in the lobby", async ({ players }) => {
    const { a, c, roomId } = await publicRoyaleWithBots(players);
    await a.testId("waiting-cancel").click();
    await expectClosed(c, roomId);
  });

  test("during a match", async ({ players }) => {
    const { a, c, roomId } = await publicRoyaleWithBots(players);
    await pressStart(a, 3);
    await a.expectState("phase", "playing");
    await expect.poll(listedRooms).toContain(roomId);
    await a.page.keyboard.press("Escape");
    await a.testId("esc-leave").click();
    await expectClosed(c, roomId);
  });
});

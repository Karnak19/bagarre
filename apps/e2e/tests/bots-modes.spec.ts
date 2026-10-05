// Bots in a duel, an FFA and a team deathmatch (#48): the room's host adds
// them from the lobby (nobody else sees the buttons, and the server ignores
// anyone else's request), they fill seats with a BOT tag, and the match
// starts on its own as with people (a duel at once, an FFA and a team
// deathmatch after their countdown). In a match they play on the rule brain
// (the e2e server has no OpenRouter key): they move, shoot, respawn and play
// on, never at a teammate. A duel against a bot is never counted in the
// stats, and a room left with only bots closes.

import { MAX_HP, TEAM_BLUE, TEAM_RED } from "@bagarre/shared";
import { FFA_MAP, expect, kill, place, roomExists, setRespawn, test, type Player } from "./fixtures.ts";

/** Sends a bot request straight through the page's room, as a tampered client would, then lets the server tick past it. */
async function sendBot(p: Player, type: "bot:add" | "bot:remove") {
  const tick = (await p.state()).tick;
  // oxlint-disable-next-line typescript/no-explicit-any
  await p.page.evaluate((t) => (window as any).__bagarre.net.room.send(t, {}), type);
  await expect.poll(async () => (await p.state()).tick, { message: `${p.name}: the server ticked past the bot request` }).toBeGreaterThan(tick + 10);
}

const bots = async (p: Player) => (await p.state()).players.filter((x) => x.bot);

/** Someone among `ids` was hit: below full HP, dead, or died once already. */
async function hurt(p: Player, ids: string[]): Promise<boolean> {
  return (await p.state()).players.some((x) => ids.includes(x.id) && (x.hp < MAX_HP || !x.alive || x.deaths > 0));
}

test("duel: the host adds a bot as the opponent, the duel starts, the bot shoots, a result comes out, not counted in the stats", async ({ players }) => {
  const { host: a, code } = await players.host("duel", "A");
  const ida = (await a.state()).you;
  await a.expectState("host", ida);
  await expect(a.testId("remove-bot")).toBeDisabled();

  // One bot fills the second seat: the duel starts at once, as with a person.
  await a.testId("add-bot").click();
  await a.expectState("phase", "playing");
  const [bot] = await bots(a);
  expect(bot.name).toMatch(/^Bot /);
  expect(bot.connected).toBe(true);
  await a.expectState("host", ida);

  // Face to face on Yard's clear row (z = -12): the bot fights.
  await place(code, ida, -10, -12);
  await place(code, bot.id, -2, -12);
  await expect.poll(() => hurt(a, [ida]), { message: "the bot hit A", timeout: 15_000 }).toBe(true);

  // Two kills end it (the e2e duel's target); whoever wins, a duel against a bot isn't counted.
  await kill(code, ida, bot.id);
  const ended = async () => (await a.state()).phase === "ended";
  await expect.poll(async () => (await ended()) || (a.me(await a.state())?.kills ?? 0) >= 1, { message: "A's first kill" }).toBe(true);
  await expect.poll(async () => (await ended()) || (await bots(a))[0]?.alive === true, { message: "the bot back", timeout: 10_000 }).toBe(true);
  await kill(code, ida, bot.id);
  await a.expectState("phase", "ended");
  const card = a.testId("result-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("result-stats")).toContainText("a duel against a bot");
  await expect(card.getByTestId("scoreboard-row")).toHaveCount(2);
  await expect(card.getByTestId("player-tag").filter({ hasText: "BOT" })).toHaveCount(1);
});

test("FFA: only the host adds bots; they play (move, shoot, respawn and play on); the room closes when only bots are left", async ({ players }) => {
  const { host: a, invite, code } = await players.host("ffa", "A");
  const ida = (await a.state()).you;

  // B, not the host, sees no bot buttons, and its own request is ignored.
  const b = await players.join(invite, "B", FFA_MAP);
  await expect.poll(async () => (await b.state()).players.length).toBe(2);
  await expect(b.testId("add-bot")).toHaveCount(0);
  await expect(b.testId("remove-bot")).toHaveCount(0);
  await sendBot(b, "bot:add");
  expect((await b.state()).players.length).toBe(2);

  // The host's bot makes three: tagged in both lobbies, and the countdown starts the match.
  await expect(a.testId("add-bot")).toBeVisible();
  await a.testId("add-bot").click();
  for (const p of [a, b]) await expect(p.testId("seat").and(p.page.locator("[data-bot]"))).toContainText("BOT");
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
  const [bot] = await bots(a);

  // Next to A on Crossroads' clear line (z = 2.8): the bot shoots A.
  await place(code, ida, -7, 2.8);
  await place(code, bot.id, -1, 2.8);
  await expect.poll(() => hurt(a, [ida]), { message: "the bot hit A", timeout: 15_000 }).toBe(true);

  // Killed, it respawns and plays on: it walks off its respawn spot.
  await kill(code, ida, bot.id);
  await expect.poll(async () => (await bots(a))[0]?.alive, { message: "the bot respawned", timeout: 10_000 }).toBe(true);
  const back = (await bots(a))[0];
  await expect
    .poll(async () => {
      const now = (await bots(a))[0];
      return now.alive && Math.hypot(now.x - back.x, now.z - back.z) > 2;
    }, { message: "the respawned bot moves", timeout: 15_000 })
    .toBe(true);

  // C watches; both people leave: only the bot is left, and the room closes (C is told).
  const c = await players.open("C");
  await c.goto(`/game/${code}/watch`, FFA_MAP);
  await c.expectState("role", "spectator");
  await b.page.keyboard.press("Escape");
  await b.testId("esc-leave").click();
  await a.page.keyboard.press("Escape");
  await a.testId("esc-leave").click();
  await expect(c.testId("notice")).toContainText("The game ended");
  await expect.poll(() => roomExists(code), { message: "the room is gone" }).toBe(false);
});

test("team deathmatch: the host's bots get teams like anyone, never shoot a teammate, and fight the other team", async ({ players }) => {
  const { host: a, code } = await players.host("tdm", "A");
  const ida = (await a.state()).you;

  // Three bots make it 2v2, balanced like joins: red, blue, red, blue.
  for (let n = 0; n < 3; n++) await a.testId("add-bot").click();
  await expect(a.testId("team-players")).toContainText("2v2");
  await expect(a.testId("team-seats").locator("[data-bot]")).toHaveCount(3);
  await a.expectState("phase", "playing");
  const me = a.me(await a.state())!;
  expect(me.team).toBe(TEAM_RED);
  const all = await bots(a);
  const mate = all.find((x) => x.team === TEAM_RED)!;
  const foes = all.filter((x) => x.team === TEAM_BLUE);
  expect(mate).toBeDefined();
  expect(foes).toHaveLength(2);

  // Only red left standing (the blue bots out and held dead): the red bot, next to A, never fires a shot.
  await setRespawn(code, 60);
  for (const f of foes) await kill(code, ida, f.id);
  await expect.poll(async () => (await bots(a)).filter((x) => x.team === TEAM_BLUE && x.alive).length).toBe(0);
  await place(code, ida, -7, 2.8);
  await place(code, mate.id, -4, 2.8);
  // Shots from before the blue bots went out have long landed by then.
  await expect.poll(async () => (await a.state()).bullets).toBe(0);
  const hp = a.me(await a.state())!.hp;
  const quietUntil = Date.now() + 3000;
  while (Date.now() < quietUntil) {
    const s = await a.state();
    expect(s.bullets, "no bullet in flight: the red bot doesn't shoot its teammate").toBe(0);
    expect(a.me(s)!.hp).toBe(hp);
    await a.page.waitForTimeout(100);
  }
  // And it still plays: it walks off where it was put.
  await expect.poll(async () => {
    const m = (await bots(a)).find((x) => x.id === mate.id)!;
    return Math.hypot(m.x + 4, m.z - 2.8) > 1;
  }, { message: "the red bot moves", timeout: 10_000 }).toBe(true);

  // The blue bots back: one next to the red pair fights them.
  await setRespawn(code, 0.5);
  await expect.poll(async () => (await bots(a)).filter((x) => x.team === TEAM_BLUE && x.alive).length, { timeout: 10_000 }).toBe(2);
  await place(code, foes[0].id, -1, 2.8);
  await expect.poll(() => hurt(a, [ida, mate.id]), { message: "the blue bot hit someone on red", timeout: 15_000 }).toBe(true);
});

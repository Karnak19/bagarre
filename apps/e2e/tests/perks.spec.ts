// Perks: one passive bonus per player. In a duel it is picked on the
// waiting card and held from the match start: our HUD shows it, the
// opponent sees it next to our name (their HUD bar and our name plate), and
// Double dash really dashes twice inside its 1 s window, then cools down
// (read off the server's dash counter and cooldown). In a battle royale perks are chest loot: walked over with none
// held, swapped with F otherwise, the old one left on the floor.

import { ITEM_PERK, PERKS, dashCooldownTicks, dashWindowTicks } from "@bagarre/shared";
import { expect, openChest, setLoot, test, type Player } from "./fixtures.ts";

const DOUBLE = PERKS.findIndex((p) => p.key === "double-dash");
const BIG_MAG = PERKS.findIndex((p) => p.key === "big-mag");
const NO_PERK = 255;
/**
 * Waiting out a cooldown (up to 5 s of game time): the game counts it in
 * inputs, and a starved page sends fewer than 30 a second (it drops the
 * steps it is late on), so it lasts longer than its seconds there.
 */
const COOLDOWN_WAIT = 30_000;

/** The loot feed's line for what we got (its stable key). */
const lootRow = (p: Player, key: string) => p.page.locator(`[data-testid="hud-loot-row"][data-key="${key}"]`);

/** The name plate `p` draws for player `id` (the dev handle's `plates`). */
async function badgeOf(p: Player, id: string): Promise<string | undefined> {
  // oxlint-disable-next-line typescript/no-explicit-any
  return p.page.evaluate((id) => (window as any).__bagarre.plates.find((x: { id: string }) => x.id === id)?.badge, id);
}

/** What `dash()` saw: the predicted dashes, and the server once it took them. */
interface Dashes {
  /** Each dash: the input (seq) it started on, and the predicted `dashCd` right after. */
  starts: { seq: number; dashCd: number }[];
  /** The predicted `dashCd` the step the last dash ended. */
  end: number;
  /** The server's view of us, from the first snapshot that has the last dash over. */
  server: { lastSeq: number; dashCd: number; dashTicks: number; dashSeen: number };
}

/**
 * `p` dashes `n` times in a row, as fast as the game allows, counted in
 * game steps, not frames or polls: it hooks the prediction's step
 * (`predictor.apply`, one per input sent) and makes the next press on the
 * step the dash before it ends, so the next input carries it. A starved page
 * runs several steps per frame (a whole 5-tick dash can start and end
 * between two frames), and this doesn't care. Then it reads the server's
 * state, in the page, from the first snapshot that has the last dash over
 * (`lastSeq` past it), before any slow poll could miss the cooldown.
 * Fails at once if a press is taken without a dash.
 */
async function dash(p: Player, n = 1): Promise<Dashes> {
  return p.page.evaluate(
    ({ n, timeout }) =>
      new Promise<Dashes>((resolve, reject) => {
        // oxlint-disable-next-line typescript/no-explicit-any
        const b = (window as any).__bagarre;
        const pred = b.match.predictor;
        const apply = pred.apply;
        const starts: Dashes["starts"] = [];
        let pressed = 0;
        let dashing = false;
        let end: { seq: number; dashCd: number } | null = null;
        let timer = 0;
        const done = (fn: () => void) => {
          pred.apply = apply;
          clearInterval(timer);
          clearTimeout(deadline);
          fn();
        };
        const deadline = setTimeout(
          () => done(() => reject(new Error(`dash: ${starts.length}/${n} dashes, last ended ${JSON.stringify(end)}, server ${JSON.stringify(server())}`))),
          timeout,
        );
        const server = () => {
          const me = b.match.latest?.players.get(b.match.net.sessionId);
          return me && { lastSeq: Number(me.lastSeq), dashCd: Number(me.dashCd), dashTicks: Number(me.dashTicks), dashSeen: Number(me.dashSeen) };
        };
        const press = () => {
          b.input.presses.dash++;
          pressed++;
        };
        // oxlint-disable-next-line typescript/no-explicit-any
        pred.apply = (msg: any, can: unknown) => {
          const before = pred.sim;
          const res = apply.call(pred, msg, can);
          if (!res || !before || end) return res;
          const s = res.sim;
          if (!dashing && msg.dash >= b.input.presses.dash && s.dashSeen > before.dashSeen) {
            // Our press, taken on this step: the dash starts (moving this very step), or it was refused.
            if (!res.dashing || before.dashTicks > 0) {
              done(() => reject(new Error(`dash ${starts.length + 1}/${n} refused at seq ${msg.seq}: dashCd ${before.dashCd}, dashTicks ${before.dashTicks}`)));
              return res;
            }
            starts.push({ seq: msg.seq, dashCd: s.dashCd });
            dashing = true;
          }
          if (dashing && s.dashTicks === 0) {
            dashing = false;
            if (pressed < n) press();
            else end = { seq: msg.seq, dashCd: s.dashCd };
          }
          return res;
        };
        // The server's state, as soon as a snapshot has the last dash over (timers run between frames too).
        timer = setInterval(() => {
          const me = end && server();
          if (me && me.lastSeq >= end!.seq) done(() => resolve({ starts, end: end!.dashCd, server: me }));
        }, 10) as unknown as number;
        press();
      }),
    { n, timeout: 20_000 },
  );
}

test("a duel: the perk picked on the waiting card is held from the start, shown to both, and Double dash dashes twice", async ({ players }) => {
  const { host: a, invite } = await players.host("duel", "A");

  // The picker on the waiting card: none by default, Double dash once clicked.
  await expect(a.testId("perk-picker")).toBeVisible();
  await expect(a.testId("perk-pick-none")).toHaveAttribute("aria-pressed", "true");
  await a.testId("perk-pick-double-dash").click();
  await expect.poll(async () => a.me(await a.state())?.perkPick).toBe(DOUBLE);

  const b = await players.join(invite, "B");
  await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
  const ida = (await a.state()).you;
  await expect.poll(async () => a.me(await a.state())?.perk).toBe(DOUBLE);
  expect(b.me(await b.state())?.perk).toBe(NO_PERK);

  // A's HUD: the perk box and the glyph by A's name. B's: by A's bar, and over A's head.
  await expect(a.testId("hud-perk")).toHaveAttribute("data-perk", "double-dash");
  await expect(a.testId("hud-perk")).toContainText("Double dash");
  await expect(a.testId("hud-me-perk")).toHaveText("⏩");
  await expect(b.testId("hud-opponent-perk")).toHaveText("⏩");
  await expect(b.testId("hud-perk")).toHaveCount(0);
  await expect(b.testId("hud-me-perk")).toHaveCount(0);
  await expect.poll(() => badgeOf(b, ida)).toBe("⏩");

  // Two dashes on A's dash box, none counted on B's (the plain dash).
  await expect(a.testId("hud-dash")).toHaveAttribute("data-count", "2");
  await expect(b.testId("hud-dash")).not.toHaveAttribute("data-count");
  const cd = dashCooldownTicks(DOUBLE);
  const win = dashWindowTicks(DOUBLE);
  const seen = a.me(await a.state())!.dashSeen;
  const x0 = a.me(await a.state())!.x;
  const z0 = a.me(await a.state())!.z;

  // Two dashes in a row, the second inside the window: the first opens it
  // (window + cooldown), the second starts the 4 s cooldown.
  const two = await dash(a, 2);
  const [s1, s2] = two.starts.map((d) => d.seq);
  expect(two.starts.map((d) => d.dashCd)).toEqual([cd + win, cd]);
  // The server took both presses, and both dashes: its cooldown is the one
  // the second started (`dashCd` plus the inputs since s2, at least `cd`),
  // never what the first alone would leave (window + cooldown since s1).
  expect(two.server.dashSeen).toBe(seen + 2);
  expect(two.server.dashTicks).toBe(0);
  expect(two.server.dashCd).toBeGreaterThan(0);
  expect(two.server.dashCd).toBeLessThanOrEqual(cd);
  const since = two.server.dashCd + (two.server.lastSeq - s2);
  expect(since).toBeGreaterThanOrEqual(cd);
  expect(since).toBeLessThan(cd + win - (s2 - s1));
  // Both moved A (from wherever it stood: a wall may cut one short, never both to nothing).
  const me = a.me(await a.state())!;
  expect(Math.hypot(me.x - x0, me.z - z0)).toBeGreaterThan(1);
  // Nothing left until the cooldown has run (4 s), then both dashes again.
  await expect(a.testId("hud-dash")).toHaveAttribute("data-count", "0");
  await expect(a.testId("hud-dash")).not.toHaveAttribute("data-ready");
  await expect(a.testId("hud-dash")).toHaveAttribute("data-count", "2", { timeout: COOLDOWN_WAIT });
  await expect(a.testId("hud-dash")).toHaveAttribute("data-ready");

  // One dash only: the window opens, runs out unused, and the cooldown follows it.
  const one = await dash(a);
  expect(one.starts.map((d) => d.dashCd)).toEqual([cd + win]);
  expect(one.end).toBeGreaterThan(cd);
  expect(one.end).toBeLessThanOrEqual(cd + win);
  expect(one.server.dashSeen).toBe(seen + 3);
  expect(one.server.dashCd + (one.server.lastSeq - one.starts[0].seq)).toBeGreaterThanOrEqual(cd + win);
  await expect(a.testId("hud-dash")).toHaveAttribute("data-count", "0");
  await expect.poll(async () => a.me(await a.state())!.dashCd, { message: "the window closed into the cooldown" }).toBeLessThanOrEqual(cd);
  expect(a.me(await a.state())!.dashSeen).toBe(seen + 3);
  await expect(a.testId("hud-dash")).toHaveAttribute("data-count", "2", { timeout: COOLDOWN_WAIT });
});

test("battle royale: a chest's perk is taken by walking over it, a second one only with F, which leaves the first behind", async ({ players }) => {
  const { players: all, code } = await players.royale(2);
  const [a] = all;
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  const ida = (await a.state()).you;
  const [c1, c2] = (await a.state()).crates;
  const prompt = a.testId("hud-swap");
  const meA = async () => a.me(await a.state())!;

  // No picker in a royale, and no perk to start with.
  expect((await meA()).perk).toBe(NO_PERK);
  await expect(a.testId("hud-perk")).toHaveCount(0);

  // None held: walking over it takes it, with a loot feed line.
  await setLoot(code, { kind: ITEM_PERK, item: DOUBLE, amount: 1 });
  await openChest(a, code, ida, c1);
  await expect.poll(async () => (await meA()).perk, { message: "A picked up Double dash" }).toBe(DOUBLE);
  await expect(a.testId("hud-perk")).toHaveAttribute("data-perk", "double-dash");
  await expect(lootRow(a, "double-dash")).toHaveText("+⏩ Double dash");

  // Holding one, standing on another: it stays on the floor, and F offers the swap.
  await setLoot(code, { kind: ITEM_PERK, item: BIG_MAG, amount: 1 });
  const big = await openChest(a, code, ida, c2);
  await expect(prompt).toHaveAttribute("data-kind", "perk");
  await expect(prompt).toHaveAttribute("data-from", "double-dash");
  await expect(prompt).toHaveAttribute("data-to", "big-mag");
  expect((await a.state()).items.some((it) => it.id === big.id)).toBe(true);
  expect((await meA()).perk).toBe(DOUBLE);
  // Drawn as a perk on the floor (its glyph badge), not as anything else.
  const floorKinds = () =>
    // oxlint-disable-next-line typescript/no-explicit-any
    a.page.evaluate(() => ((window as any).__bagarre.scene.royale.group.children as { name: string }[]).map((o) => o.name).filter((n) => n.startsWith("item:")));
  await expect.poll(floorKinds).toEqual(["item:perk"]);

  // F: Bigger mag held, Double dash left where A stands (not A's to take back until A steps off).
  await a.focusGame();
  await a.page.keyboard.press("KeyF");
  await expect.poll(async () => (await meA()).perk, { message: "A swapped in Bigger mag" }).toBe(BIG_MAG);
  const left = (await a.state()).items.find((it) => it.kind === ITEM_PERK && it.item === DOUBLE);
  expect(left?.blockedFor).toBe(ida);
  expect((await a.state()).items.some((it) => it.id === big.id)).toBe(false);
  await expect(a.testId("hud-perk")).toHaveAttribute("data-perk", "big-mag");
  await expect(lootRow(a, "big-mag")).toHaveText("⏩ Double dash→🔋 Bigger mag");
  await expect(prompt).toHaveAttribute("data-state", "off");
});

// Name plates over the players' heads, read through the dev handle
// (`__bagarre.plates`), never through pixels.

import { expect, kill, setRespawn, test, type Player } from "./fixtures.ts";

interface Plate {
  id: string;
  visible: boolean;
  name: string;
  hp: number;
  shield: number;
  dimmed: boolean;
}

function plates(p: Player): Promise<Plate[]> {
  // oxlint-disable-next-line typescript/no-explicit-any
  return p.page.evaluate(() => (window as any).__bagarre.plates);
}

async function plateOf(p: Player, id: string): Promise<Plate | undefined> {
  return (await plates(p)).find((x) => x.id === id);
}

/** Waits, in the page, until the plate of `id` matches (checked often). */
function waitPlate(p: Player, id: string, want: { visible?: boolean; hp?: number; dimmed?: boolean }, timeout = 15_000) {
  return p.page.waitForFunction(
    ({ id, want }) => {
      // oxlint-disable-next-line typescript/no-explicit-any
      const plate = (window as any).__bagarre.plates.find((x: Plate) => x.id === id);
      if (!plate) return false;
      return Object.entries(want).every(([k, v]) => plate[k] === v);
    },
    { id, want },
    { timeout, polling: 30 },
  );
}

test("a duel: the opponent's plate has their name and full HP, ours a bar with no name", async ({ players }) => {
  const { a, b } = await players.duel();
  const s = await a.state();
  const opp = s.players.find((p) => p.id !== s.you)!;
  expect(opp.name).toBe((await b.state()).players.find((p) => p.id === opp.id)!.name);
  await expect.poll(() => plateOf(a, opp.id)).toMatchObject({ visible: true, name: opp.name, hp: 1, dimmed: false });
  await expect.poll(() => plateOf(a, s.you)).toMatchObject({ visible: true, name: "", hp: 1 });
});

test("a kill hides the plate until the respawn, which brings it back at full HP", async ({ players }) => {
  const { a, b, code } = await players.duel();
  const ida = (await a.state()).you;
  const idb = (await b.state()).you;
  await waitPlate(a, idb, { visible: true, hp: 1 });

  // The death is held until A's plate has shown it: the e2e respawn (0.5 s)
  // can fall between two frames of a starved CI page. Then B respawns.
  await setRespawn(code, 60);
  await kill(code, ida, idb);
  await waitPlate(a, idb, { visible: false });
  await setRespawn(code, 0.5);
  await waitPlate(a, idb, { visible: true, hp: 1 });
  // The victim's own bar too.
  await waitPlate(b, idb, { visible: true, hp: 1 });
  expect(await plateOf(a, idb)).toMatchObject({ visible: true, hp: 1, name: (await b.state()).players.find((p) => p.id === idb)!.name });
});

test("Show names off hides the names, keeps the bars, and survives a reload", async ({ players }) => {
  const { a, b } = await players.duel();
  const idb = (await b.state()).you;
  const nameB = (await a.state()).players.find((p) => p.id === idb)!.name;
  await expect.poll(() => plateOf(a, idb)).toMatchObject({ visible: true, name: nameB });

  await a.page.keyboard.press("Escape");
  await a.testId("esc-settings").click();
  const names = a.testId("settings-names").getByRole("switch");
  await expect(names).toBeChecked();
  await names.click();
  await expect(names).not.toBeChecked();
  await expect.poll(() => plateOf(a, idb)).toMatchObject({ visible: true, name: "", hp: 1 });

  await a.page.reload();
  await a.page.waitForFunction(() => "__bagarre" in window);
  await a.expectState("phase", "playing");
  await expect.poll(() => plateOf(a, idb)).toMatchObject({ visible: true, name: "", hp: 1 });

  await a.page.keyboard.press("Escape");
  await a.testId("esc-settings").click();
  await expect(a.testId("settings-names").getByRole("switch")).not.toBeChecked();
});

test("a spectator sees both players' plates, names included", async ({ players }) => {
  const { a, code } = await players.duel();
  const both = (await a.state()).players;
  const c = await players.open("C");
  await c.goto(`/game/${code}/watch`);
  await c.expectState("role", "spectator");
  for (const p of both) await expect.poll(() => plateOf(c, p.id)).toMatchObject({ visible: true, name: p.name, hp: 1, dimmed: false });
});

test("a reconnecting player's plate is dimmed on the opponent's side", async ({ players }) => {
  const { a, b } = await players.duel();
  const ida = (await a.state()).you;
  await waitPlate(b, ida, { visible: true, dimmed: false });

  await a.waitReconnectable();
  await a.context.setOffline(true);
  await waitPlate(b, ida, { dimmed: true });
  expect(await plateOf(b, ida)).toMatchObject({ visible: true, dimmed: true });

  await a.context.setOffline(false);
  await waitPlate(b, ida, { dimmed: false }, 20_000);
});

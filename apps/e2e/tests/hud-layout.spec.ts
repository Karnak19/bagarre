// The HUD's layout (Hud.tsx): one grid over the screen, each box stacked in
// its corner. At the common window sizes, none of the main boxes overlap,
// all of them are on screen, and the alert slot sits under the character
// (the screen's centre, where the camera keeps it).

import { ITEM_PERK, PERKS } from "@bagarre/shared";
import { expect, openChest, setLoot, test, type Player } from "./fixtures.ts";

/** The HUD's main boxes, by test id; the ones not shown in a mode are skipped. */
const BOXES = [
  "hud-minimap",
  "hud-ffa",
  "hud-team",
  "hud-royale",
  "hud-score",
  "hud-status",
  "hud-zone-arrow",
  "hud-killfeed",
  "hud-opponent",
  "hud-loot",
  "hud-me",
  "hud-abilities",
  "hud-weapon",
  "hud-slots",
  "hud-heals",
  "hud-sound",
  "hud-picker",
  "hud-alert",
];

type Box = { id: string; x: number; y: number; w: number; h: number };

/** The bounding boxes of the main boxes on screen (an empty alert slot has no size, and is skipped too). */
async function boxes(p: Player): Promise<Box[]> {
  return p.page.evaluate((ids) => {
    const out: Box[] = [];
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ id, x: r.x, y: r.y, w: r.width, h: r.height });
    }
    return out;
  }, BOXES);
}

/** Every pair of boxes that overlap ("hud-me × hud-weapon"); none expected. */
function overlaps(all: Box[]): string[] {
  const out: string[] = [];
  for (const [i, a] of all.entries())
    for (const b of all.slice(i + 1))
      if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) out.push(`${a.id} × ${b.id}`);
  return out;
}

async function expectLaidOut(p: Player, must: string[]) {
  const size = p.page.viewportSize()!;
  const all = await boxes(p);
  for (const id of must) expect(all.map((b) => b.id), `${id} on screen`).toContain(id);
  expect(overlaps(all), `no overlap at ${size.width}×${size.height}`).toEqual([]);
  for (const b of all) {
    expect(b.x, `${b.id} inside the window`).toBeGreaterThanOrEqual(0);
    expect(b.y, `${b.id} inside the window`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w, `${b.id} inside the window`).toBeLessThanOrEqual(size.width + 0.5);
    expect(b.y + b.h, `${b.id} inside the window`).toBeLessThanOrEqual(size.height + 0.5);
  }
}

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 1000, height: 700 },
];

test("the duel HUD: score at the top, the opponent top right, you and your abilities bottom left, your gun bottom right, nothing overlapping", async ({ players }) => {
  const { a } = await players.duel();
  for (const size of SIZES) {
    await a.page.setViewportSize(size);
    await expectLaidOut(a, ["hud-score", "hud-opponent", "hud-me", "hud-abilities", "hud-weapon", "hud-sound"]);
    // You at the bottom left, your gun at the bottom right, the score centred at the top.
    const all = await boxes(a);
    const at = (id: string) => all.find((b) => b.id === id)!;
    expect(at("hud-me").x).toBeLessThan(size.width / 2);
    expect(at("hud-me").y).toBeGreaterThan(size.height / 2);
    expect(at("hud-weapon").x).toBeGreaterThan(size.width / 2);
    expect(at("hud-opponent").y).toBeLessThan(size.height / 2);
    expect(Math.abs(at("hud-score").x + at("hud-score").w / 2 - size.width / 2)).toBeLessThan(2);
  }
});

test("the battle royale HUD: minimap and panel top left, slots and heals bottom right, the F prompt under the character, nothing overlapping", async ({ players }) => {
  const { players: all, code } = await players.royale(2);
  const [a] = all;
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  const ida = (await a.state()).you;
  const [c1, c2] = (await a.state()).crates;

  // A perk (a badge by A's name), then a second one on the floor by A: the F prompt is up.
  const DOUBLE = PERKS.findIndex((p) => p.key === "double-dash");
  const BIG_MAG = PERKS.findIndex((p) => p.key === "big-mag");
  await setLoot(code, { kind: ITEM_PERK, item: DOUBLE, amount: 1 });
  await openChest(a, code, ida, c1);
  await expect(a.testId("hud-perk")).toHaveAttribute("data-perk", "double-dash");
  await setLoot(code, { kind: ITEM_PERK, item: BIG_MAG, amount: 1 });
  await openChest(a, code, ida, c2);
  await expect(a.testId("hud-swap")).toHaveAttribute("data-state", "on");
  await expect(a.testId("hud-alert")).toHaveAttribute("data-top", "swap");

  for (const size of SIZES) {
    await a.page.setViewportSize(size);
    await expectLaidOut(a, ["hud-minimap", "hud-royale", "hud-me", "hud-abilities", "hud-slots", "hud-heals", "hud-sound", "hud-alert"]);
    const boxesNow = await boxes(a);
    const at = (id: string) => boxesNow.find((b) => b.id === id)!;
    expect(at("hud-minimap").x).toBeLessThan(size.width / 2);
    expect(at("hud-minimap").y).toBeLessThan(size.height / 2);
    expect(at("hud-slots").x).toBeGreaterThan(size.width / 2);
    // The alert: centred, just under the middle of the screen.
    const alert = at("hud-alert");
    expect(Math.abs(alert.x + alert.w / 2 - size.width / 2)).toBeLessThan(2);
    expect(alert.y).toBeGreaterThan(size.height / 2);
    expect(alert.y).toBeLessThan(size.height * 0.7);
  }
});

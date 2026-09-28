// The Maps page (`/maps`) and walking around a map (`/maps/<id>`): the list
// shows every map, a walk builds the real arena with no connection to the
// game server at all, its camera keys work, Back and Esc return to the list,
// a direct load works, and round trips leave nothing behind.

import { FFA_MAPS, MAPS, type FfaMapDef } from "@bagarre/shared";
import type { Page } from "@playwright/test";
import { attractSettled, countListeners, expect, leakCounts, test, type Player } from "./fixtures.ts";

const DUEL = "runway";
const FFA = FFA_MAPS[0].id;

/** The walk as the dev handle sees it: null while no walk is on. */
const walk = (a: Player) =>
  a.page.evaluate(() => {
    // oxlint-disable-next-line typescript/no-explicit-any
    const b = (window as any).__bagarre;
    return b.walk as { mapId: string; mode: string } | null;
  });

const sceneMapId = (a: Player) =>
  // oxlint-disable-next-line typescript/no-explicit-any
  a.page.evaluate(() => ((window as any).__bagarre.scene?.map?.id as string | undefined) ?? null);

const pageErrors = (a: Player) => a.errors.filter((e) => e.startsWith("pageerror"));

/** Every WebSocket, and every matchmaking request, the page opens from now on. */
function watchNetwork(page: Page) {
  const sockets: string[] = [];
  const matchmake: string[] = [];
  page.on("websocket", (ws) => sockets.push(ws.url()));
  page.on("request", (r) => {
    if (r.url().includes("/matchmake")) matchmake.push(r.url());
  });
  return { sockets, matchmake };
}

test("the menu's Maps button lists every map, with the Teams tag on the team maps", async ({ players }) => {
  const a = await players.open("A");
  await a.goto("/");
  await a.testId("open-maps").click();
  await expect(a.page).toHaveURL(/\/maps(\?|$)/);
  await expect(a.testId("maps")).toBeVisible();
  for (const m of [...MAPS, ...FFA_MAPS]) {
    const card = a.testId(`map-card-${m.id}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(m.name);
    await expect(a.testId(`map-size-${m.id}`)).toContainText(`${m.halfX * 2} × ${m.halfZ * 2} m`);
    await expect(a.testId(`walk-${m.id}`)).toBeVisible();
    await expect(a.testId(`map-teams-${m.id}`)).toHaveCount((m as Partial<FfaMapDef>).teams ? 1 : 0);
  }
  // Back to the menu.
  await a.testId("maps-back").click();
  await expect(a.testId("menu")).toBeVisible();
  expect(pageErrors(a)).toEqual([]);
});

test("walking around a map builds its arena with no server connection; 2 is Overview, Back and Esc return", async ({ players }) => {
  const a = await players.open("A");
  const net = watchNetwork(a.page);
  await a.goto("/maps");
  await expect(a.testId("maps")).toBeVisible();

  await a.testId(`walk-${DUEL}`).click();
  await expect(a.page).toHaveURL(new RegExp(`/maps/${DUEL}(\\?|$)`));
  await expect(a.testId("walk")).toBeVisible();
  await expect.poll(() => walk(a).then((w) => w?.mapId)).toBe(DUEL);
  expect(await sceneMapId(a)).toBe(DUEL);
  expect((await walk(a))?.mode).toBe("free");
  // oxlint-disable-next-line typescript/no-explicit-any
  expect(await a.page.evaluate(() => (window as any).__bagarre.stats().inRoom)).toBe(false);

  await a.page.keyboard.press("2");
  await expect.poll(() => walk(a).then((w) => w?.mode)).toBe("overview");
  await expect(a.testId("walk")).toHaveAttribute("data-mode", "overview");
  await a.page.keyboard.press("3");
  await expect.poll(() => walk(a).then((w) => w?.mode)).toBe("free");

  // Back: the list again, and the walk is over.
  await a.testId("walk-back").click();
  await expect(a.testId("maps")).toBeVisible();
  await expect(a.page).toHaveURL(/\/maps(\?|$)/);
  await expect.poll(() => walk(a)).toBeNull();

  // Esc from a walk returns too.
  await a.testId(`walk-${FFA}`).click();
  await expect.poll(() => walk(a).then((w) => w?.mapId)).toBe(FFA);
  await a.page.keyboard.press("Escape");
  await expect(a.testId("maps")).toBeVisible();
  await expect.poll(() => walk(a)).toBeNull();

  expect(net.sockets, "no WebSocket at all").toEqual([]);
  expect(net.matchmake, "no matchmaking").toEqual([]);
  expect(pageErrors(a)).toEqual([]);
});

test("a direct load of /maps/<id> walks around that map, and so does a reload", async ({ players }) => {
  const a = await players.open("A");
  const net = watchNetwork(a.page);
  await a.goto(`/maps/${FFA}`);
  await expect(a.testId("walk")).toBeVisible();
  await expect.poll(() => walk(a).then((w) => w?.mapId)).toBe(FFA);
  expect(await sceneMapId(a)).toBe(FFA);

  await a.page.reload();
  await a.page.waitForFunction(() => "__bagarre" in window);
  await expect.poll(() => walk(a).then((w) => w?.mapId)).toBe(FFA);
  expect(await sceneMapId(a)).toBe(FFA);

  // Back on a direct load: the list (replacing the entry, there is nothing behind it).
  await a.testId("walk-back").click();
  await expect(a.testId("maps")).toBeVisible();
  await expect.poll(() => walk(a)).toBeNull();

  expect(net.sockets).toEqual([]);
  expect(net.matchmake).toEqual([]);
  expect(pageErrors(a)).toEqual([]);
});

test("an unknown map id goes back to the list", async ({ players }) => {
  const a = await players.open("A");
  await a.goto("/maps/nowhere");
  await expect(a.testId("maps")).toBeVisible();
  await expect(a.page).toHaveURL(/\/maps(\?|$)/);
  expect(pageErrors(a)).toEqual([]);
});

test("list and walk round trips leave nothing behind", async ({ players }) => {
  const a = await players.open("A");
  await countListeners(a.page);
  await a.goto("/maps");
  await expect(a.testId("maps")).toBeVisible();

  const counts = () => leakCounts(a.page);

  // One trip: list → walk (counted there: same map every time) → Back → list (counted too).
  const trip = async () => {
    // The list's characters in their skins first, so every count has their uploads.
    await attractSettled(a.page);
    await a.testId(`walk-${DUEL}`).click();
    await expect.poll(() => walk(a).then((w) => w?.mapId)).toBe(DUEL);
    const walking = await counts();
    await a.testId("walk-back").click();
    await expect(a.testId("maps")).toBeVisible();
    await expect.poll(() => walk(a)).toBeNull();
    const list = await counts();
    return { walking, list };
  };

  // The first trip builds what every later one reuses (shaders, the arena's models).
  const first = await trip();
  expect(first.walking.inRoom).toBe(false);
  expect(first.walking.loopsPerFrame).toBe(1);
  expect(first.list.loopsPerFrame).toBe(1);
  // The list's attract scene picks a random map each time, so its scene is
  // not counted object by object; the walk is always the same map. A leaked
  // walk (a second arena, the attract soldiers left in) is hundreds.
  const NOISE = 12;
  for (let i = 0; i < 2; i++) {
    const next = await trip();
    expect(next.walking.loopsPerFrame, "one frame loop").toBe(1);
    expect(next.list.loopsPerFrame, "one frame loop").toBe(1);
    expect(next.walking.geometries, "geometries").toBeLessThanOrEqual(first.walking.geometries + NOISE);
    expect(next.walking.textures, "textures").toBe(first.walking.textures);
    expect(next.walking.programs, "shader programs").toBeLessThanOrEqual(first.walking.programs);
    expect(next.walking.objects, "scene objects").toBeLessThanOrEqual(first.walking.objects + NOISE);
    expect(next.walking.listeners, "listeners while walking").toBe(first.walking.listeners);
    expect(next.list.listeners, "listeners on the list").toBe(first.list.listeners);
    expect(next.list.inRoom).toBe(false);
  }
  expect(pageErrors(a)).toEqual([]);
});

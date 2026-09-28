import { attractSettled, countListeners, expect, leakCounts, test } from "./fixtures.ts";

test("menu and game round trips leave nothing behind", async ({ players }) => {
  const a = await players.open("A");
  await countListeners(a.page);
  await a.goto("/");
  await expect(a.testId("play")).toBeVisible();

  const counts = () => leakCounts(a.page);

  const trip = async () => {
    await a.testId("private-game").click();
    await expect(a.testId("waiting-card")).toBeVisible();
    await a.expectState("phase", "waiting");
    await a.testId("waiting-cancel").click();
    await expect(a.testId("menu")).toBeVisible();
    await a.expectState("roomId", "");
    // Let the menu settle (the attract scene's skins, sounds fading out).
    await attractSettled(a.page);
    await expect.poll(async () => (await counts()).voices).toBe(0);
    return counts();
  };

  // The first trip builds what every game reuses (shaders, the arena's models).
  const first = await trip();
  expect(first.inRoom).toBe(false);
  expect(first.loopsPerFrame).toBe(1);
  // The menu's attract scene fires tracers and effects of its own, so its
  // object and geometry counts move by a few from one moment to the next. A
  // leaked game (an arena, a character, the HUD's meshes) is hundreds.
  const NOISE = 12;
  for (let i = 0; i < 2; i++) {
    const next = await trip();
    expect(next.loopsPerFrame, "one frame loop").toBe(1);
    expect(next.geometries, "geometries").toBeLessThanOrEqual(first.geometries + NOISE);
    expect(next.textures, "textures").toBe(first.textures);
    expect(next.programs, "shader programs").toBeLessThanOrEqual(first.programs);
    expect(next.objects, "scene objects").toBeLessThanOrEqual(first.objects + NOISE);
    expect(next.listeners, "window and document listeners").toBe(first.listeners);
    expect(next.voices, "sounds on the menu").toBe(0);
  }
});

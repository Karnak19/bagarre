import { expect, test } from "./fixtures.ts";

interface Counts {
  geometries: number;
  textures: number;
  programs: number;
  objects: number;
  voices: number;
  inRoom: boolean;
  frames: number;
  listeners: number;
  /** Frames the app drew per animation frame the browser gave it (1: one loop). */
  loopsPerFrame: number;
}

test("menu and game round trips leave nothing behind", async ({ players }) => {
  const a = await players.open("A");
  // Count the window's and the document's live event listeners.
  await a.page.addInitScript(() => {
    const live = new Set<string>();
    const key = (t: EventTarget, type: string, fn: unknown, opts: unknown) =>
      `${t === window ? "w" : "d"}:${type}:${String((fn as { name?: string })?.name)}:${typeof opts === "object" ? !!(opts as { capture?: boolean })?.capture : !!opts}`;
    const ids = new WeakMap<object, number>();
    let n = 0;
    const id = (fn: unknown) => {
      if (typeof fn !== "function" && typeof fn !== "object") return 0;
      if (!ids.has(fn as object)) ids.set(fn as object, ++n);
      return ids.get(fn as object)!;
    };
    for (const target of [window, document] as EventTarget[]) {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      target.addEventListener = (type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) => {
        if (fn) live.add(`${key(target, type, fn, opts)}#${id(fn)}`);
        add(type, fn, opts);
      };
      target.removeEventListener = (type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions) => {
        if (fn) live.delete(`${key(target, type, fn, opts)}#${id(fn)}`);
        remove(type, fn, opts);
      };
    }
    Object.assign(window, { __liveListeners: live });
  });
  await a.goto("/");
  await expect(a.testId("play")).toBeVisible();

  const counts = (): Promise<Counts> =>
    a.page.evaluate(async () => {
      // oxlint-disable-next-line typescript/no-explicit-any
      const w = window as any;
      const start = w.__bagarre.stats().frames;
      let raf = 0;
      await new Promise<void>((done) => {
        const tick = () => (++raf >= 20 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
      const stats = w.__bagarre.stats();
      return { ...stats, listeners: w.__liveListeners.size, loopsPerFrame: Math.round((stats.frames - start) / raf) };
    });

  const trip = async () => {
    await a.testId("private-game").click();
    await expect(a.testId("waiting-card")).toBeVisible();
    await a.expectState("phase", "waiting");
    await a.testId("waiting-cancel").click();
    await expect(a.testId("menu")).toBeVisible();
    await a.expectState("roomId", "");
    // Let the menu settle (the attract scene, sounds fading out).
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

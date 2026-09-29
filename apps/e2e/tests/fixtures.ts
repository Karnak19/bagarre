// Shared fixtures for the e2e suite.
//
// - `players.open()` makes a player: its own browser context (own storage,
//   own guest name, own connection), so N players are N contexts.
// - `players.duel()` / `players.ffa(n)` / `players.teams(n)` open a private game by its link and
//   wait until every player is in the match. Private games are never listed
//   nor quick-matched, so tests running in parallel never meet.
// - `Player.state()` reads the dev handle `window.__bagarre` (Vite dev only)
//   into one plain object: assertions go through it and data-testids, never
//   through pixels.
// - `kill()` asks the e2e server's control API (server.ts) for a kill.
// - `unique()` / `signUp()` make an account through the account panel.

import { test as base, expect, type Browser, type BrowserContext, type BrowserType, type LaunchOptions, type Page } from "@playwright/test";
import { GL, SERVER_PORT } from "../playwright.config.ts";

/** Every game page pins the map, so a run is the same every time. FFA pins its own. */
export const DUEL_MAP = "yard";
export const FFA_MAP = "crossroads";
/**
 * Frames drawn per second (`?fps=`, dev only): nothing here looks at pixels,
 * and a dozen pages drawing at 60 fps starve the machine (the GPU locally,
 * the CPU with SwiftShader). The game itself still runs every frame.
 */
const DRAW_FPS = Number(process.env.E2E_FPS ?? 10);

export interface PlayerState {
  screen: string;
  card: string;
  path: string;
  roomId: string;
  you: string;
  status: string | null;
  role: string | null;
  mode: string | null;
  phase: string | null;
  mapId: string | null;
  spectators: number;
  /** Team deathmatch: each team's kills. */
  redScore: number;
  blueScore: number;
  opponentLeft: boolean;
  boardOpen: boolean;
  inputEnabled: boolean;
  /** Our own character's gun, as drawn (null: no character drawn). */
  drawnWeapon: number | null;
  /** The spectator view while watching: who is followed and the camera mode. */
  spectator: { followId: string; mode: string } | null;
  players: {
    id: string;
    name: string;
    /** The server saw an account with a username (false: a guest). */
    account: boolean;
    kills: number;
    deaths: number;
    weapon: number;
    pick: number;
    alive: boolean;
    connected: boolean;
    slot: number;
    /** 0 red, 1 blue, 255 outside a team mode. */
    team: number;
    hp: number;
    x: number;
    z: number;
  }[];
}

export interface MusicState {
  /** The AudioContext runs: unlocked by a gesture, and the browser has audio. */
  running: boolean;
  mood: "menu" | "match" | "off";
  /** The track the mood asks for (set even with no audio). */
  wanted: string | null;
  /** The track heard (null until decoded, or with no audio). */
  playing: string | null;
  loading: string | null;
  /** Decoded tracks held: the one playing and the one fading out, never more. */
  held: number;
}

export class Player {
  readonly errors: string[] = [];
  constructor(
    readonly name: string,
    readonly context: BrowserContext,
    readonly page: Page,
  ) {
    page.on("pageerror", (e) => this.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") this.errors.push(`console.error: ${m.text()}`);
    });
  }

  /** Opens a path of the app, with the map pinned (`?map=`) and the drawing capped (`?fps=`). */
  async goto(path: string, map = DUEL_MAP) {
    const url = new URL(path, "http://x");
    if (!url.searchParams.has("map")) url.searchParams.set("map", map);
    if (!url.searchParams.has("fps")) url.searchParams.set("fps", String(DRAW_FPS));
    await this.page.goto(url.pathname + url.search);
    await this.page.waitForFunction(() => "__bagarre" in window);
  }

  /** The dev handle's view of the app, as one plain object. */
  state(): Promise<PlayerState> {
    return this.page.evaluate(() => {
      // oxlint-disable-next-line typescript/no-explicit-any
      const b = (window as any).__bagarre;
      const s = b.app.getState();
      const m = b.match;
      const latest = m?.latest ?? null;
      const players: PlayerState["players"] = [];
      latest?.players.forEach((p: Record<string, unknown>, id: string) =>
        players.push({
          id,
          name: String(p.name),
          account: !!p.account,
          kills: Number(p.kills),
          deaths: Number(p.deaths),
          weapon: Number(p.weapon),
          pick: Number(p.pick),
          alive: !!p.alive,
          connected: !!p.connected,
          slot: Number(p.slot),
          team: Number(p.team),
          hp: Number(p.hp),
          x: Number(p.x),
          z: Number(p.z),
        }),
      );
      players.sort((a, c) => a.slot - c.slot);
      return {
        screen: s.screen,
        card: b.card,
        path: location.pathname,
        roomId: s.roomId,
        you: m?.net.sessionId ?? "",
        status: m?.net.status ?? null,
        role: m?.net.role ?? null,
        mode: latest?.mode ?? null,
        phase: latest?.phase ?? null,
        mapId: latest?.mapId ?? null,
        spectators: latest?.spectators ?? 0,
        redScore: latest?.redScore ?? 0,
        blueScore: latest?.blueScore ?? 0,
        opponentLeft: s.opponentLeft,
        boardOpen: b.boardOpen,
        inputEnabled: b.input.enabled,
        drawnWeapon: m?.meshes?.get(m.net.sessionId)?.character?.weapon ?? null,
        spectator: b.spectator ? { followId: b.spectator.followId, mode: b.spectator.mode } : null,
        players,
      };
    });
  }

  /** Polls one field of `state()` until it matches. */
  async expectState<K extends keyof PlayerState>(key: K, value: PlayerState[K], timeout = 15_000) {
    await expect.poll(async () => (await this.state())[key], { timeout, message: `${this.name}: ${key}` }).toEqual(value);
  }

  /**
   * Waits until the SDK would reconnect on its own: it only retries a room
   * joined more than 5 s ago (`reconnection.minUptime`); a drop sooner than
   * that ends in "Connection lost".
   */
  async waitReconnectable() {
    await this.page.waitForFunction(() => {
      // oxlint-disable-next-line typescript/no-explicit-any
      const room = (window as any).__bagarre.net?.room;
      return !!room && room.joinedAtTime > 0 && Date.now() - room.joinedAtTime > room.reconnection.minUptime + 300;
    }, undefined, { timeout: 15_000, polling: 200 });
  }

  /** How many sounds have played so far (the dev `sfxLog`). */
  sfxCount(): Promise<number> {
    // oxlint-disable-next-line typescript/no-explicit-any
    return this.page.evaluate(() => (window as any).__bagarre.sfxLog.length);
  }

  /** The names of the sounds played since `sfxCount()` returned `n`. */
  sfxSince(n: number): Promise<string[]> {
    // oxlint-disable-next-line typescript/no-explicit-any
    return this.page.evaluate((from) => (window as any).__bagarre.sfxLog.slice(from).map((e: { name: string }) => e.name), n);
  }

  /** The music's state (`__bagarre.music`, see audio.ts' musicDebug). */
  music(): Promise<MusicState> {
    // oxlint-disable-next-line typescript/no-explicit-any
    return this.page.evaluate(() => (window as any).__bagarre.music);
  }

  /** Drives the dev autopilot (`__bagarre.bot`): world-space move, aim angle, fire. */
  bot(patch: { on?: boolean; mx?: number; mz?: number; aim?: number; fire?: boolean }): Promise<void> {
    // oxlint-disable-next-line typescript/no-explicit-any
    return this.page.evaluate((p) => void Object.assign((window as any).__bagarre.bot, p), patch);
  }

  me(s: PlayerState) {
    return s.players.find((p) => p.id === s.you);
  }

  testId(id: string) {
    return this.page.getByTestId(id);
  }

  /** The canvas has the keyboard: what a player's keys go to during a match. */
  async focusGame() {
    await this.page.locator("#game").focus().catch(() => {});
    await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
}

/** What the leak checks count: GPU resources, scene objects, sounds, frames, listeners (see `countListeners`). */
export interface LeakCounts {
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

/** From the next navigation on, counts the window's and the document's live event listeners (for `leakCounts`). */
export async function countListeners(page: Page): Promise<void> {
  await page.addInitScript(() => {
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
}

/**
 * Waits for the menu's attract characters to wear their skins and be drawn a
 * couple of times: a skin loads on its own schedule, and the leak checks'
 * first count must already include its GPU uploads.
 */
export async function attractSettled(page: Page) {
  await page.waitForFunction(() => (window as any).__bagarre.attract?.loaded === true, null, { timeout: 30_000 });
  const frames = await page.evaluate(() => (window as any).__bagarre.stats().frames as number);
  await page.waitForFunction((f) => (window as any).__bagarre.stats().frames >= f + 2, frames, { timeout: 30_000 });
}

/** The dev handle's stats, the live listener count, and how many frames the app drew per animation frame (1: one loop). */
export function leakCounts(page: Page): Promise<LeakCounts> {
  return page.evaluate(async () => {
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
}

/** Asks the e2e server for a kill (server.ts): the killer's shot kills the victim at once. */
export async function kill(roomId: string, killer: string, victim: string) {
  const res = await fetch(`http://localhost:${SERVER_PORT + 1}/kill`, {
    method: "POST",
    body: JSON.stringify({ roomId, killer, victim }),
  });
  expect(res.status, await res.text()).toBe(200);
}

/** A fresh email and username per call, so parallel tests and reruns never collide. */
export function unique() {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`.slice(-10);
  return { email: `e2e-${id}@example.com`, username: `p_${id}`, password: "hunter22" };
}

/** Signs up through the account panel and saves a username; leaves the panel open. */
export async function signUp(p: Player, who: { email: string; username: string; password: string }) {
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

export class Players {
  private all: Player[] = [];
  private browsers: Browser[] = [];
  constructor(
    private browserType: BrowserType,
    private launchOptions: LaunchOptions,
    private contextOptions: Parameters<Browser["newContext"]>[0],
  ) {}

  /**
   * A new player: its own browser context. With a real GPU (Metal) every
   * player shares one browser. With SwiftShader each player gets its own
   * browser, so its own GPU process: SwiftShader renders on the CPU inside
   * the GPU process, and one shared GPU process serialises every page's
   * frames (with three players in one browser, a page took 30 s to load).
   */
  async open(name = `P${this.all.length + 1}`): Promise<Player> {
    let browser: Browser;
    const own = (process.env.E2E_BROWSERS ?? (GL === "swiftshader" ? "own" : "shared")) === "own";
    if (!own && this.browsers[0]) browser = this.browsers[0];
    else {
      browser = await this.browserType.launch(this.launchOptions);
      this.browsers.push(browser);
    }
    const context = await browser.newContext(this.contextOptions);
    const page = await context.newPage();
    const p = new Player(name, context, page);
    this.all.push(p);
    return p;
  }

  /** The host opens a private game of that mode from the menu; resolves with its invite link. */
  async host(mode: "duel" | "ffa" | "tdm" = "duel", name = "A"): Promise<{ host: Player; invite: string; code: string }> {
    const host = await this.open(name);
    await host.goto("/", mode === "duel" ? DUEL_MAP : FFA_MAP);
    await host.testId(mode === "ffa" ? "private-ffa" : mode === "tdm" ? "private-tdm" : "private-game").click();
    await expect(host.page).toHaveURL(/\/game\/[A-Za-z0-9_-]+/);
    await expect(host.testId("waiting-card")).toBeVisible();
    const invite = await host.testId("invite-link").inputValue();
    expect(invite).toMatch(/\/game\/[A-Za-z0-9_-]+/);
    const code = new URL(invite).pathname.split("/")[2]!;
    return { host, invite, code };
  }

  /** Opens an invite link as a new player. */
  async join(invite: string, name?: string, map = DUEL_MAP): Promise<Player> {
    const p = await this.open(name);
    await p.goto(new URL(invite).pathname, map);
    return p;
  }

  /** A private duel by link, both players in the match. */
  async duel(): Promise<{ a: Player; b: Player; code: string; invite: string }> {
    const { host: a, invite, code } = await this.host("duel", "A");
    const b = await this.join(invite, "B");
    await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
    await Promise.all([a.expectState("card", "none"), b.expectState("card", "none")]);
    return { a, b, code, invite };
  }

  /** A private FFA by link with `n` players; resolves once they are all in the room (the countdown may still run). */
  async ffa(n: number): Promise<{ players: Player[]; code: string; invite: string }> {
    const { host, invite, code } = await this.host("ffa", "A");
    const players = [host];
    for (let i = 1; i < n; i++) players.push(await this.join(invite, String.fromCharCode(65 + i), FFA_MAP));
    for (const p of players) await expect.poll(async () => (await p.state()).players.length).toBe(n);
    return { players, code, invite };
  }

  /** A private team deathmatch by link with `n` players (on the FFA map); resolves once they are all in the room. */
  async teams(n: number): Promise<{ players: Player[]; code: string; invite: string }> {
    const { host, invite, code } = await this.host("tdm", "A");
    const players = [host];
    for (let i = 1; i < n; i++) players.push(await this.join(invite, String.fromCharCode(65 + i), FFA_MAP));
    for (const p of players) await expect.poll(async () => (await p.state()).players.length).toBe(n);
    return { players, code, invite };
  }

  async closeAll() {
    await Promise.all(this.browsers.map((b) => b.close().catch(() => {})));
    this.all = [];
    this.browsers = [];
  }
}

export const test = base.extend<{ players: Players }>({
  players: async ({ playwright, launchOptions, contextOptions }, use) => {
    const players = new Players(playwright.chromium, launchOptions, contextOptions);
    await use(players);
    await players.closeAll();
  },
});

export { expect };

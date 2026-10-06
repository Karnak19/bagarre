// Shared fixtures for the e2e suite.
//
// - `players.open()` makes a player: its own browser context (own storage,
//   own guest name, own connection), so N players are N contexts.
// - `players.duel()` / `players.ffa(n)` / `players.teams(n)` / `players.royale(n)` open a private
//   game by its link and wait until every player is in the match (a royale's host then presses
//   Start, through the real UI). Private games are never listed
//   nor quick-matched, so tests running in parallel never meet.
// - `Player.state()` reads the dev handle `window.__bagarre` (Vite dev only)
//   into one plain object: assertions go through it and data-testids, never
//   through pixels.
// - `kill()` asks the e2e server's control API (server.ts) for a kill;
//   `setRespawn()` / `setCountdown()` / `setWarmup()` hold its short timers
//   open while a slow page gets to see them.
// - `unique()` / `signUp()` make an account through the account panel.

import { test as base, expect, type Browser, type BrowserContext, type BrowserType, type LaunchOptions, type Page } from "@playwright/test";
import { GAMES_ROUTE } from "@bagarre/shared";
import { GL, SERVER_PORT } from "../playwright.config.ts";

/** Every game page pins the map, so a run is the same every time. FFA pins its own. */
export const DUEL_MAP = "yard";
export const FFA_MAP = "crossroads";
/** The battle royale's map: Ironvale, the only one in its pool. */
export const ROYALE_MAP = "ironvale";
/**
 * Frames drawn per second (`?fps=`, dev only): nothing here looks at pixels,
 * and a dozen pages drawing at 60 fps starve the machine (the GPU locally,
 * the CPU with SwiftShader). The game itself still runs every frame; the HUD
 * and the minimap update with the drawn frames. Every page also draws
 * `?lite` (no antialiasing, no shadows).
 *
 * With SwiftShader (CI) a drawn frame costs a lot of CPU, even lite, and a
 * starved page gets fewer animation frames, which is where the game runs and
 * the checks look: 5 a second there.
 */
const DRAW_FPS = Number(process.env.E2E_FPS ?? (GL === "swiftshader" ? 5 : 10));

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
  /** The latest snapshot's server tick (0 before any). */
  tick: number;
  /** Session id of the room's host (the battle royale's host starts the match). */
  host: string;
  /** Warmup: the server tick it ends on (0 outside warmup), and the tick the match clock started on. */
  warmupEnd: number;
  startTick: number;
  /** Bullets in flight: the server's (latest snapshot), and our own predicted ones not yet confirmed or gone. */
  bullets: number;
  localBullets: number;
  /** Grenades in the air or on the ground (latest snapshot). */
  grenades: number;
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
  /** Battle royale: we are out and watch the rest of the match from our seat. */
  knockedOut: boolean;
  /** Battle royale: the chests (`open` once F opened one), items on the floor, and the zone's end tick (0: none). */
  crates: { id: string; x: number; z: number; open: boolean }[];
  /**
   * `blockedFor`: who dropped it under their feet and hasn't stepped off it yet ("": nobody).
   * A chest's loot: the chest it fell from (`fromX`, `fromZ`), and the ticks it fell on and lands on (0: there at once).
   */
  items: {
    id: string;
    x: number;
    z: number;
    kind: number;
    item: number;
    amount: number;
    blockedFor: string;
    fromX: number;
    fromZ: number;
    dropTick: number;
    readyTick: number;
  }[];
  zoneEnd: number;
  /** Our gun in hand as the prediction has it (a switch shows here first). */
  predictedWeapon: number | null;
  players: {
    id: string;
    name: string;
    /** The server saw an account with a username (false: a guest). */
    account: boolean;
    /** A bot: a seat the server drives, no client (added by the royale's host). */
    bot: boolean;
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
    /** Grenade type in hand and picked (GRENADES index), steps of stun left, and the flash's end tick and length. */
    grenade: number;
    /** Aim angle, radians (as the server last applied it). */
    aim: number;
    /** Last input the server applied for this player. */
    lastSeq: number;
    grenadePick: number;
    stunTicks: number;
    flashEnd: number;
    flashTicks: number;
    /** Rounds in the magazine and ticks of reload left (as the server last synced them). */
    ammo: number;
    reloadTicks: number;
    /** Battle royale: the slot in hand (0-2), the three slots' guns (255 empty) and magazines, grenades left, and the knock-out tick (0: in). */
    hand: number;
    guns: number[];
    mags: number[];
    grenades: number;
    outTick: number;
    /** Battle royale: the last F press counter the server consumed (an F press counts once the server saw it). */
    swapSeen: number;
    /** Battle royale: healing items and shield charges carried, the heal in progress (255: none), its steps left, and how the last one ended (HEAL_STOP). */
    bandages: number;
    medkits: number;
    shields: number;
    heal: number;
    healStop: number;
    /** What the shield bubble can still soak. */
    shieldHp: number;
    /** Final place once the match ended (0 before). */
    place: number;
    /** Scoreboard: bullets fired, bullets that hit, damage dealt (this match). */
    shots: number;
    hits: number;
    damage: number;
    /** Melee: ticks of cooldown left, and the last V press counter the server consumed. */
    meleeCd: number;
    meleeSeen: number;
    /** The perk held and the one picked for the next spawn (PERKS index, 255: none). */
    perk: number;
    perkPick: number;
    /** Dash: ticks until every charge is back, ticks of dash left, and the last Space press counter the server consumed. */
    dashCd: number;
    dashTicks: number;
    dashSeen: number;
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

  /** Opens a path of the app, with the map pinned (`?map=`) and the drawing capped and lightened (`?fps=`, `?lite`). */
  async goto(path: string, map = DUEL_MAP) {
    const url = new URL(path, "http://x");
    if (!url.searchParams.has("map")) url.searchParams.set("map", map);
    if (!url.searchParams.has("fps")) url.searchParams.set("fps", String(DRAW_FPS));
    if (!url.searchParams.has("lite")) url.searchParams.set("lite", "1");
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
          bot: !!p.bot,
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
          grenade: Number(p.grenade),
          aim: Number(p.aim),
          lastSeq: Number(p.lastSeq),
          grenadePick: Number(p.grenadePick),
          stunTicks: Number(p.stunTicks),
          flashEnd: Number(p.flashEnd),
          flashTicks: Number(p.flashTicks),
          ammo: Number(p.ammo),
          reloadTicks: Number(p.reloadTicks),
          hand: Number((p.kit as Record<string, number>)?.hand ?? 0),
          guns: [0, 1, 2].map((i) => Number((p.kit as Record<string, number>)?.[`gun${i}`] ?? 255)),
          mags: [0, 1, 2].map((i) => Number((p.kit as Record<string, number>)?.[`mag${i}`] ?? 0)),
          grenades: Number((p.kit as Record<string, number>)?.grenades ?? 0),
          outTick: Number(p.outTick ?? 0),
          swapSeen: Number((p.kit as Record<string, number>)?.swapSeen ?? 0),
          bandages: Number((p.kit as Record<string, number>)?.bandages ?? 0),
          medkits: Number((p.kit as Record<string, number>)?.medkits ?? 0),
          shields: Number((p.kit as Record<string, number>)?.shields ?? 0),
          heal: Number((p.kit as Record<string, number>)?.heal ?? 255),
          healStop: Number((p.kit as Record<string, number>)?.healStop ?? 0),
          shieldHp: Number(p.shieldHp ?? 0),
          place: Number(p.place ?? 0),
          shots: Number(p.shots ?? 0),
          hits: Number(p.hits ?? 0),
          damage: Number(p.damage ?? 0),
          meleeCd: Number(p.meleeCd ?? 0),
          meleeSeen: Number(p.meleeSeen ?? 0),
          perk: Number(p.perk ?? 255),
          perkPick: Number(p.perkPick ?? 255),
          dashCd: Number(p.dashCd ?? 0),
          dashTicks: Number(p.dashTicks ?? 0),
          dashSeen: Number(p.dashSeen ?? 0),
        }),
      );
      const crates: PlayerState["crates"] = [];
      latest?.crates?.forEach((c: { x: number; z: number; open: boolean }, id: string) => crates.push({ id, x: c.x, z: c.z, open: !!c.open }));
      const items: PlayerState["items"] = [];
      latest?.items?.forEach((it: Omit<PlayerState["items"][number], "id">, id: string) => items.push({ id, ...it }));
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
        tick: latest?.tick ?? 0,
        host: latest?.host ?? "",
        warmupEnd: latest?.warmupEnd ?? 0,
        startTick: latest?.startTick ?? 0,
        bullets: latest?.bullets.size ?? 0,
        localBullets: m?.localBullets?.bullets?.size ?? 0,
        grenades: latest?.grenades.size ?? 0,
        spectators: latest?.spectators ?? 0,
        redScore: latest?.redScore ?? 0,
        blueScore: latest?.blueScore ?? 0,
        opponentLeft: s.opponentLeft,
        boardOpen: b.boardOpen,
        inputEnabled: b.input.enabled,
        drawnWeapon: m?.meshes?.get(m.net.sessionId)?.character?.weapon ?? null,
        spectator: b.spectator ? { followId: b.spectator.followId, mode: b.spectator.mode } : null,
        knockedOut: !!m?.knockedOut,
        crates,
        items,
        zoneEnd: latest?.zone?.end ?? 0,
        predictedWeapon: m?.predictor?.sim ? m.predictor.weaponOf() : null,
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
  bot(patch: { on?: boolean; mx?: number; mz?: number; aim?: number; fire?: boolean; target?: { x: number; z: number } | null }): Promise<void> {
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

/**
 * Asks the e2e server to make that room's warmups last `seconds` (server.ts'
 * /warmup): the next ones, and the one running if any (it then ends `seconds` from now).
 */
export async function setWarmup(roomId: string, seconds: number) {
  const res = await fetch(`http://localhost:${SERVER_PORT + 1}/warmup`, {
    method: "POST",
    body: JSON.stringify({ roomId, seconds }),
  });
  expect(res.status, await res.text()).toBe(200);
}

/**
 * Asks the e2e server to make that room's pre-match countdowns last `seconds`
 * (server.ts' /countdown): the next ones, and the one running if any (it then
 * ends `seconds` from now). Hold one open before the last player joins, check
 * it, then release it with a short one.
 */
export async function setCountdown(roomId: string, seconds: number) {
  const res = await fetch(`http://localhost:${SERVER_PORT + 1}/countdown`, {
    method: "POST",
    body: JSON.stringify({ roomId, seconds }),
  });
  expect(res.status, await res.text()).toBe(200);
}

/**
 * Asks the e2e server to make that room's respawns come `seconds` after a
 * death (server.ts' /respawn), the players dead right now included (from
 * now). A death lasts 0.5 s in the e2e rules, less than a starved CI page may
 * take between two frames: hold it before the kill, check it, then release it.
 */
export async function setRespawn(roomId: string, seconds: number) {
  const res = await fetch(`http://localhost:${SERVER_PORT + 1}/respawn`, {
    method: "POST",
    body: JSON.stringify({ roomId, seconds }),
  });
  expect(res.status, await res.text()).toBe(200);
}

/**
 * Asks the e2e server to give every smoke cloud in a room `seconds` left from
 * now (server.ts' /smoke). Returns the ticks each had left before.
 */
export async function setSmoke(roomId: string, seconds: number): Promise<number[]> {
  const res = await fetch(`http://localhost:${SERVER_PORT + 1}/smoke`, {
    method: "POST",
    body: JSON.stringify({ roomId, seconds }),
  });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return JSON.parse(text) as number[];
}

/** Whether the e2e server still has that room (server.ts' /room): false once it closed. */
export async function roomExists(roomId: string): Promise<boolean> {
  const res = await fetch(`http://localhost:${SERVER_PORT + 1}/room`, { method: "POST", body: JSON.stringify({ roomId }) });
  return res.status === 200;
}

/** The game server's open games list (GET /games, the menu's), as its room ids. */
export async function listedRooms(): Promise<string[]> {
  const res = await fetch(`http://localhost:${SERVER_PORT}${GAMES_ROUTE}`);
  const { games } = (await res.json()) as { games: { roomId: string }[] };
  return games.map((g) => g.roomId);
}

/** Asks the e2e server to put a player on (x, z) at once (server.ts' /place). */
export async function place(roomId: string, id: string, x: number, z: number) {
  const res = await fetch(`http://localhost:${SERVER_PORT + 1}/place`, {
    method: "POST",
    body: JSON.stringify({ roomId, id, x, z }),
  });
  expect(res.status, await res.text()).toBe(200);
}

/**
 * Battle royale: player `p` (session `id`) stands 1 m east of `chest`,
 * presses F and the chest opens. Resolves with the loot it dropped (as `p`'s
 * page sees it), with `p` moved onto where it lands (it falls toward them,
 * so about at their feet): it is theirs by walking over it once it has
 * landed, if they can take it.
 */
export async function openChest(p: Player, roomId: string, id: string, chest: { id: string; x: number; z: number }) {
  await place(roomId, id, chest.x + 1, chest.z);
  await p.focusGame();
  await p.page.keyboard.press("KeyF");
  // Watched in the page, every few ms: the loot falls for ROYALE.lootDrop
  // (0.6 s) and, if `p` can take it, is gone once landed, which a slow poll
  // from here can miss whole.
  const seen = await p.page.waitForFunction(
    (chest) => {
      // oxlint-disable-next-line typescript/no-explicit-any
      const items = (window as any).__bagarre.match?.latest?.items;
      const all: PlayerState["items"] = [];
      items?.forEach((it: Omit<PlayerState["items"][number], "id">, id: string) => all.push({ id, ...it }));
      return all.find((it) => it.readyTick > 0 && Math.hypot(it.fromX - chest.x, it.fromZ - chest.z) < 0.01) ?? null;
    },
    chest,
    { polling: 10, timeout: 20_000 },
  ).catch(async (e) => {
    const open = (await p.state()).crates.find((c) => c.id === chest.id)?.open;
    throw new Error(`${p.name}: ${open ? "the chest opened, its loot never seen" : "the chest never opened (F not taken)"}`, { cause: e });
  });
  const loot = (await seen.jsonValue())!;
  await expect.poll(async () => (await p.state()).crates.find((c) => c.id === chest.id)?.open, { message: `${p.name} opened the chest` }).toBe(true);
  await place(roomId, id, loot.x, loot.z);
  return loot;
}

/** Battle royale: from now on a chest's loot in that room takes `seconds` to land (server.ts' /lootdrop). */
export async function setLootDrop(roomId: string, seconds: number) {
  const res = await fetch(`http://localhost:${SERVER_PORT + 1}/lootdrop`, { method: "POST", body: JSON.stringify({ roomId, seconds }) });
  expect(res.status, await res.text()).toBe(200);
}

/**
 * Battle royale: from now on that room's chests drop this gun (a WEAPONS
 * index), or this floor item (`{ kind, item, amount }`: healing items,
 * shield charges...) (server.ts' /loot).
 */
export async function setLoot(roomId: string, drop: number | { kind: number; item: number; amount: number }) {
  const body = typeof drop === "number" ? { roomId, weapon: drop } : { roomId, ...drop };
  const res = await fetch(`http://localhost:${SERVER_PORT + 1}/loot`, { method: "POST", body: JSON.stringify(body) });
  expect(res.status, await res.text()).toBe(200);
}

/** Battle royale: the running zone starts shrinking `wait` s from now and is closed `close` s from now (server.ts' /zone). */
export async function setZone(roomId: string, wait: number, close: number) {
  const res = await fetch(`http://localhost:${SERVER_PORT + 1}/zone`, { method: "POST", body: JSON.stringify({ roomId, wait, close }) });
  expect(res.status, await res.text()).toBe(200);
}

/** Asks the e2e server to set a living player's HP (server.ts' /hp): no kill, feed line or damage stat. */
export async function setHp(roomId: string, id: string, hp: number) {
  const res = await fetch(`http://localhost:${SERVER_PORT + 1}/hp`, {
    method: "POST",
    body: JSON.stringify({ roomId, id, hp }),
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

/**
 * Battle royale: the host presses Start on its waiting card, once it shows
 * `n` players and is enabled. (The match then goes into its warmup.)
 */
export async function pressStart(host: Player, n: number) {
  const start = host.testId("royale-start");
  await expect(start).toHaveAttribute("data-players", String(n));
  await expect(start).toHaveAttribute("data-ready", "true");
  await start.click();
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
  async host(mode: "duel" | "ffa" | "tdm" | "royale" = "duel", name = "A"): Promise<{ host: Player; invite: string; code: string }> {
    const host = await this.open(name);
    await host.goto("/", mode === "duel" ? DUEL_MAP : mode === "royale" ? ROYALE_MAP : FFA_MAP);
    await host.testId(mode === "duel" ? "private-game" : `private-${mode}`).click();
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

  /**
   * A private battle royale by link with `n` players (on Ironvale): once they
   * are all in the room, the host (A, the first in) presses Start on its
   * waiting card. Resolves once the match is started (its warmup or play).
   */
  async royale(n: number): Promise<{ players: Player[]; code: string; invite: string }> {
    const lobby = await this.royaleLobby(n);
    await pressStart(lobby.players[0], n);
    for (const p of lobby.players) await expect.poll(async () => (await p.state()).phase, { message: `${p.name}: started` }).not.toBe("waiting");
    return lobby;
  }

  /** A private battle royale by link with `n` players, all in the room, still waiting for the host (A, `players[0]`) to start it. */
  async royaleLobby(n: number): Promise<{ players: Player[]; code: string; invite: string }> {
    const { host, invite, code } = await this.host("royale", "A");
    const players = [host];
    for (let i = 1; i < n; i++) players.push(await this.join(invite, String.fromCharCode(65 + i), ROYALE_MAP));
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

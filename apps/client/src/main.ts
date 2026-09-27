import "./style.css";
import {
  INTERP_DELAY_MS,
  MATCH_END_DELAY,
  SERVER_PORT,
  SHIELD,
  TICK_MS,
  weaponDef,
  mapById,
  TICK_RATE,
  type InputMessage,
  type Phase,
  type PlayerView,
  type Vec2,
} from "@bagarre/shared";
import { WEAPON_SFX, initAudioOnFirstGesture, isMuted, play, setListener, setMuted, type PlayOptions, type SfxName } from "./audio.ts";
import { LocalBullets } from "./bullets.ts";
import { Hud, type HudModel } from "./hud.ts";
import { Input, screenToWorldMove } from "./input.ts";
import { SnapshotBuffer } from "./interpolation.ts";
import { Net } from "./net.ts";
import { Predictor } from "./prediction.ts";
import { loadAssets } from "./assets.ts";
import { GameScene, PLAYER_COLORS, PlayerMesh, setAssets } from "./scene.ts";

// --- Config from the URL ---------------------------------------------------
const params = new URLSearchParams(location.search);
/** `?lag=100` adds 100 ms of round-trip latency (50 ms each way). */
const lagMs = Math.max(0, Number(params.get("lag")) || 0);
/** `?map=runway` asks for that map (dev servers only, the server ignores it in production). */
const mapParam = params.get("map");
const serverUrl =
  params.get("server") ??
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `${location.protocol}//${location.hostname}:${SERVER_PORT}`;

// --- Setup -------------------------------------------------------------------
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
// Models, props and particles load before anything else. A file that fails
// falls back to the placeholder look (see assets.ts), so this always resolves.
const loadingEl = document.querySelector<HTMLElement>("#hud-status")!;
const setLoading = (f: number) => (loadingEl.textContent = `Loading assets... ${Math.round(f * 100)}%`);
setLoading(0);
setAssets(await loadAssets(setLoading));
const scene = new GameScene(canvas);
const input = new Input(canvas);
const hud = new Hud();
const net = new Net(lagMs, mapParam);
const buffer = new SnapshotBuffer();
const predictor = new Predictor();
const localBullets = new LocalBullets();
const meshes = new Map<string, PlayerMesh>();
/** Each player as of the previous snapshot, to spot what changed (hits, deaths, remote shots...). */
const lastView = new Map<string, PlayerView>();
/** Grenades already heard being thrown / landing. Pruned like `announcedBlasts`. */
const seenGrenades = new Set<string>();
const landedGrenades = new Set<string>();
/**
 * Grenade blasts, detected when the snapshot arrives and shown when render
 * time reaches it. (Sampling the interpolated grenades could skip the single
 * snapshot where `exploded` is true on a slow frame.)
 */
const blasts: { at: number; x: number; z: number; own: boolean }[] = [];
const announcedBlasts = new Set<string>();
/**
 * The opponent's muzzle flashes, due when render time reaches the shot. Read
 * from their ammo count like their shot sound (a point-blank bullet can hit
 * and vanish before any snapshot shows it, so "a new bullet appeared" misses
 * shots). One flash per round spent.
 */
const remoteShots: { at: number; id: string }[] = [];
/** The map of the latest snapshot ("" before the first one). */
let mapId = "";
/**
 * Time left on the map name card shown at match start, in ms. It counts down
 * by frame time capped at 100 ms per frame, not by the wall clock: the first
 * frames of a match can take seconds (shaders compiling for the new props and
 * the opponent's model) and would otherwise use it up before it is seen.
 */
let mapCardLeft = 0;
/**
 * Dev-only autopilot for the headless browser check: when `on`, it replaces
 * the mouse and keyboard (world-space move, aim angle, fire). Never set
 * outside dev (only reachable through `window.__bagarre`).
 */
const bot = { on: false, mx: 0, mz: 0, aim: 0, fire: false };

let seq = 0;
let accumulator = 0;
let lastFrame = performance.now();
let aim = 0;
let cameraSnapped = false;
let phase: Phase = "waiting";
let endedAt = 0;
/** Cursor on the ground (grenade target). */
let cursor: Vec2 | null = null;
/** Where the opponent was drawn last frame, for visual hits of predicted bullets. */
let opponentDrawn: Vec2 | null = null;
/** Fire button state on the previous tick, for the empty-click on a fresh press. */
let wasFiring = false;

// --- Sound -------------------------------------------------------------------
// Our own actions play the moment they are predicted (in the tick loop below),
// never from reconcile: it replays pending inputs and would play them again.
// Everything read from a snapshot about the opponent is delayed by the
// interpolation delay, so it is heard when it is drawn.
const REMOTE_DELAY = INTERP_DELAY_MS / 1000;
/** How long the map name stays up at match start. */
const MAP_CARD_MS = 3500;
/** ...fading out over its last this many ms. */
const MAP_CARD_FADE_MS = 500;
/** Dev-only log of every sound played, read by the headless check. */
const sfxLog: { t: number; name: SfxName; delay: number; x?: number; z?: number }[] = [];
function sfx(name: SfxName, opts?: PlayOptions) {
  if (import.meta.env.DEV) sfxLog.push({ t: performance.now(), name, delay: opts?.delay ?? 0, x: opts?.x, z: opts?.z });
  play(name, opts);
}
initAudioOnFirstGesture();
input.onMute = () => setMuted(!isMuted());

function canMove(p: PlayerView, ph: Phase) {
  return p.alive && ph !== "ended";
}

/** Mirrors the server rule for MSG_PICK. */
function canPick(p: PlayerView | null, ph: Phase) {
  return !!p && (!p.alive || ph !== "playing");
}

input.onPick = (weapon) => {
  const latest = buffer.latest();
  const me = latest?.players.get(net.sessionId) ?? null;
  if (latest && canPick(me, latest.phase)) {
    net.sendPick(weapon);
    sfx("weapon_pick");
  }
};

function meshFor(id: string, slot: number): PlayerMesh {
  let m = meshes.get(id);
  if (!m) {
    m = new PlayerMesh(PLAYER_COLORS[slot] ?? 0x888888, id === net.sessionId, slot);
    meshes.set(id, m);
    scene.addPlayer(m);
  }
  return m;
}

/**
 * The server switched maps (or this is the first snapshot). It does so
 * between matches, in the same tick as it puts both players on the new
 * spawns, so this snapshot carries the new map and the new positions
 * together. Everything from before is dropped rather than blended: the
 * interpolation buffer (the opponent would slide from an old-map position),
 * our predicted bullets and drawn projectiles (they flew on the old map),
 * pending flashes and blasts. The predictor forgets its state and restarts
 * from this snapshot on the new map (see Predictor.setMap). This runs before
 * the snapshot is buffered or reconciled, so nothing ever uses two maps.
 */
function switchMap(id: string) {
  const map = mapById(id);
  mapId = id;
  buffer.clear();
  predictor.setMap(map);
  localBullets.setMap(map);
  scene.setMap(map);
  blasts.length = 0;
  remoteShots.length = 0;
  opponentDrawn = null;
  cameraSnapped = false;
}

net.onSnapshot = (s) => {
  if (s.mapId !== mapId) switchMap(s.mapId);
  buffer.push(s);
  const me = s.players.get(net.sessionId);
  if (me) {
    predictor.reconcile(me, canMove(me, s.phase));
    localBullets.reconcile(s, me.lastSeq);
  }

  if (s.phase !== phase) {
    if (s.phase === "playing") mapCardLeft = MAP_CARD_MS;
    if (s.phase === "ended") {
      endedAt = performance.now();
      sfx(s.winner === net.sessionId ? "match_win" : "match_lose");
    }
    phase = s.phase;
  }

  const now = performance.now();
  s.grenades.forEach((g, id) => {
    // Our own throws were already heard from the prediction.
    if (!seenGrenades.has(id)) {
      seenGrenades.add(id);
      if (g.owner !== net.sessionId) sfx("grenade_throw", { x: g.x, z: g.z, delay: REMOTE_DELAY });
    }
    if (g.landed && !landedGrenades.has(id)) {
      landedGrenades.add(id);
      sfx("grenade_bounce", { x: g.tx, z: g.tz, delay: REMOTE_DELAY });
    }
    if (!g.exploded || announcedBlasts.has(id)) return;
    announcedBlasts.add(id);
    blasts.push({ at: s.t + INTERP_DELAY_MS, x: g.tx, z: g.tz, own: g.owner === net.sessionId });
  });
  for (const set of [announcedBlasts, seenGrenades, landedGrenades])
    if (set.size > 64) for (const id of set) if (!s.grenades.has(id)) set.delete(id);

  s.players.forEach((p, id) => {
    const prev = lastView.get(id);
    lastView.set(id, p);
    if (!prev) return;
    const mine = id === net.sessionId;
    // Our own events are heard now; the opponent's when they are drawn, where they are.
    const at: PlayOptions | undefined = mine ? undefined : { x: p.x, z: p.z, delay: REMOTE_DELAY };

    // Hit flash (and its sound) when someone's HP goes down.
    if (p.hp < prev.hp) {
      meshFor(id, p.slot).flash(now + (mine ? 0 : INTERP_DELAY_MS));
      sfx(mine ? "hurt" : "hit", at);
    }
    if (p.shieldHp < prev.shieldHp && p.shieldHp > 0) sfx("shield_hit", at);
    // Broken by damage, not simply run out (expiry zeroes it on its last tick).
    if (prev.shieldHp > 0 && p.shieldHp === 0 && prev.shieldTicks > 1) sfx("shield_break", at);
    if (prev.alive && !p.alive) sfx("death", at);
    if (!prev.alive && p.alive) sfx("respawn", at);

    // The opponent's own actions (ours come from the prediction). Shots are
    // read from the ammo count, not from new bullets: a fast bullet can hit
    // and vanish before any snapshot shows it. Several inputs can land in
    // one server tick, so one snapshot may hold more than one shot.
    if (mine || !prev.alive || !p.alive) return;
    const shots = p.weapon === prev.weapon ? prev.ammo - p.ammo : 0;
    const gap = weaponDef(p.weapon).fireInterval;
    for (let i = 0; i < shots; i++) {
      sfx(WEAPON_SFX[p.weapon] ?? "rifle", { ...at, delay: REMOTE_DELAY + i * gap });
      remoteShots.push({ at: now + INTERP_DELAY_MS + i * gap * 1000, id });
    }
    if (p.dashCd > prev.dashCd) sfx("dash", at);
    if (prev.reloadTicks === 0 && p.reloadTicks > 0) sfx("reload", { ...at, volume: 0.7 });
    if (p.shieldTicks > prev.shieldTicks) sfx("shield_up", at);
  });

  // Drop meshes of players who left.
  for (const [id, m] of meshes) {
    if (!s.players.has(id)) {
      scene.removePlayer(m);
      meshes.delete(id);
      lastView.delete(id);
    }
  }
};

void net.connect(serverUrl);

// Dev-only handle for poking at the game from the console or a test script.
if (import.meta.env.DEV) Object.assign(window, { __bagarre: { scene, net, predictor, localBullets, input, sfxLog, buffer, bot } });

// --- Game loop ---------------------------------------------------------------
function frame(now: number) {
  const dtMs = Math.min(now - lastFrame, 250);
  lastFrame = now;
  const dt = dtMs / 1000;

  const latest = buffer.latest();
  const meServer = latest?.players.get(net.sessionId) ?? null;

  // 1. Fixed-rate input: exactly one input per simulation tick, predicted
  //    locally with the shared step function and sent to the server.
  if (latest && meServer) {
    accumulator += dtMs;
    let steps = 0;
    while (accumulator >= TICK_MS && steps < 5) {
      accumulator -= TICK_MS;
      steps++;
      const move = bot.on ? { mx: bot.mx, mz: bot.mz } : screenToWorldMove(scene.camera, input.screenAxes());
      const here = predictor.sim ?? meServer;
      const target = cursor ?? { x: here.x + Math.cos(aim) * 6, z: here.z + Math.sin(aim) * 6 };
      const msg: InputMessage = {
        seq: ++seq,
        mx: move.mx,
        mz: move.mz,
        aim,
        fire: bot.on ? bot.fire : input.firing,
        gx: target.x,
        gz: target.z,
        ...input.presses,
      };
      const before = predictor.sim;
      const res = predictor.apply(msg, canMove(meServer, latest.phase));
      // Instant local shots: same pellets, same ids as the server will spawn.
      if (res?.fired) localBullets.spawn(meServer.slot, msg.seq, predictor.weapon, res.sim.x, res.sim.z, msg.aim);
      if (res && before) {
        if (res.fired) sfx(WEAPON_SFX[predictor.weapon] ?? "rifle");
        if (res.sim.dashCd > before.dashCd) sfx("dash");
        if (res.grenade) sfx("grenade_throw");
        if (res.shield) sfx("shield_up");
        if (before.reloadTicks === 0 && res.sim.reloadTicks > 0) sfx("reload");
        else if (msg.fire && !wasFiring && !res.fired && res.sim.reloadTicks > 0) sfx("empty_click");
      }
      wasFiring = msg.fire;
      localBullets.step(opponentDrawn);
      net.sendInput(msg);
    }
    // After a long hitch, don't try to send a burst of stale inputs.
    if (accumulator > TICK_MS) accumulator = 0;
  }

  // 2. Local player: predicted position, smoothed between ticks.
  if (meServer) {
    const pos = predictor.render(accumulator / TICK_MS, dt);
    setListener(pos.x, pos.z);
    if (bot.on) aim = bot.aim;
    else if (input.hasPointer) {
      const hit = scene.cursorOnGround(input.ndc);
      cursor = hit ? { x: hit.x, z: hit.z } : null;
      if (hit) {
        const dx = hit.x - pos.x;
        const dz = hit.z - pos.z;
        if (dx * dx + dz * dz > 0.01) aim = Math.atan2(dz, dx);
      }
    }
    const mine = meshFor(net.sessionId, meServer.slot);
    mine.set(pos.x, pos.z, aim, meServer.alive, meServer.weapon);
    mine.setShield(meServer.shieldTicks > 0 ? meServer.shieldHp / SHIELD.absorb : 0);
    scene.follow(pos.x, pos.z, dt, !cameraSnapped);
    cameraSnapped = true;
  }

  // 3. Remote player and bullets: interpolated ~100 ms in the past.
  const renderTime = now - INTERP_DELAY_MS;
  let opponent: PlayerView | null = null;
  opponentDrawn = null;
  latest?.players.forEach((p, id) => {
    if (id === net.sessionId) return;
    opponent = p;
    const s = buffer.samplePlayer(id, renderTime);
    if (!s) return;
    const m = meshFor(id, s.slot);
    m.set(s.x, s.z, s.aim, s.alive, s.weapon);
    m.setShield(s.shieldTicks > 0 ? s.shieldHp / SHIELD.absorb : 0);
    if (s.alive) opponentDrawn = { x: s.x, z: s.z };
  });
  for (let i = remoteShots.length - 1; i >= 0; i--) {
    if (remoteShots[i].at > now) continue;
    meshes.get(remoteShots[i].id)?.shot(now);
    remoteShots.splice(i, 1);
  }

  // Our own bullets are drawn from the prediction; the server's copies of
  // them are skipped (see LocalBullets). Everyone else's are interpolated.
  const bullets = new Map<string, { x: number; z: number; slot: number }>();
  for (const [id, b] of buffer.sampleBullets(renderTime)) {
    if (localBullets.owns(id)) continue;
    bullets.set(id, { x: b.x, z: b.z, slot: latest?.players.get(b.owner)?.slot ?? 0 });
  }
  if (meServer) localBullets.render(accumulator / TICK_MS, meServer.slot, bullets);
  scene.syncBullets(bullets);
  scene.syncGrenades(buffer.sampleGrenades(renderTime), now);
  while (blasts.length > 0 && blasts[0].at <= now) {
    const b = blasts.shift()!;
    scene.blast(b.x, b.z, now, b.own);
    sfx("explosion", { x: b.x, z: b.z });
  }

  for (const m of meshes.values()) {
    m.update(now);
    if (m.dashing) scene.addGhost(m.group.position.x, m.group.position.z, m.color, now);
  }
  scene.render(now);

  // 4. HUD.
  let status = "";
  if (net.status === "connecting") status = "Connecting to server...";
  else if (net.status === "disconnected") status = `Disconnected${net.error ? `: ${net.error}` : ""}. Reload to retry.`;
  else if (!latest) status = "Joining...";
  else if (latest.phase === "waiting") status = "Waiting for opponent... (open a second tab)";
  else if (meServer && !meServer.alive && latest.phase === "playing")
    status = `Respawning in ${(meServer.respawnTicks / TICK_RATE).toFixed(1)}s (1-4 to change weapon)`;

  let banner: { title: string; sub: string } | null = null;
  if (latest?.phase === "ended") {
    const left = Math.max(0, MATCH_END_DELAY - (now - endedAt) / 1000);
    banner = {
      title: latest.winner === net.sessionId ? "You win!" : "You lose",
      sub: `Next match in ${left.toFixed(0)}s`,
    };
  }

  const map = scene.map;
  let mapCard: HudModel["mapCard"] = null;
  if (map && latest?.phase === "playing" && mapCardLeft > 0) {
    mapCard = { title: map.name, sub: map.blurb, opacity: Math.min(1, mapCardLeft / MAP_CARD_FADE_MS) };
    mapCardLeft -= Math.min(dtMs, 100);
  }

  const debugParts = [`pending inputs ${predictor.pendingCount}`, `correction ${predictor.lastError.toFixed(3)} m`];
  if (lagMs > 0) debugParts.unshift(`lag +${lagMs} ms`);
  hud.update({
    status,
    me: meServer,
    opponent,
    sim: predictor.sim,
    canPick: !!latest && canPick(meServer, latest.phase),
    banner,
    mapCard,
    debug: debugParts.join("  |  "),
    muted: isMuted(),
  });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

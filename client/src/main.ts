import "./style.css";
import {
  INTERP_DELAY_MS,
  MATCH_END_DELAY,
  SERVER_PORT,
  SHIELD,
  TICK_MS,
  TICK_RATE,
  type InputMessage,
  type Phase,
  type PlayerView,
  type Vec2,
} from "@bagarre/shared";
import { LocalBullets } from "./bullets.ts";
import { Hud } from "./hud.ts";
import { Input, screenToWorldMove } from "./input.ts";
import { SnapshotBuffer } from "./interpolation.ts";
import { Net } from "./net.ts";
import { Predictor } from "./prediction.ts";
import { GameScene, PLAYER_COLORS, PlayerMesh } from "./scene.ts";

// --- Config from the URL ---------------------------------------------------
const params = new URLSearchParams(location.search);
/** `?lag=100` adds 100 ms of round-trip latency (50 ms each way). */
const lagMs = Math.max(0, Number(params.get("lag")) || 0);
const serverUrl =
  params.get("server") ??
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `${location.protocol}//${location.hostname}:${SERVER_PORT}`;

// --- Setup -------------------------------------------------------------------
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const scene = new GameScene(canvas);
const input = new Input(canvas);
const hud = new Hud();
const net = new Net(lagMs);
const buffer = new SnapshotBuffer();
const predictor = new Predictor();
const localBullets = new LocalBullets();
const meshes = new Map<string, PlayerMesh>();
const lastHp = new Map<string, number>();
/**
 * Grenade blasts, detected when the snapshot arrives and shown when render
 * time reaches it. (Sampling the interpolated grenades could skip the single
 * snapshot where `exploded` is true on a slow frame.)
 */
const blasts: { at: number; x: number; z: number }[] = [];
const announcedBlasts = new Set<string>();

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
  if (latest && canPick(me, latest.phase)) net.sendPick(weapon);
};

function meshFor(id: string, slot: number): PlayerMesh {
  let m = meshes.get(id);
  if (!m) {
    m = new PlayerMesh(PLAYER_COLORS[slot] ?? 0x888888, id === net.sessionId);
    meshes.set(id, m);
    scene.addPlayer(m);
  }
  return m;
}

net.onSnapshot = (s) => {
  buffer.push(s);
  const me = s.players.get(net.sessionId);
  if (me) {
    predictor.reconcile(me, canMove(me, s.phase));
    localBullets.reconcile(s, me.lastSeq);
  }

  if (s.phase !== phase) {
    if (s.phase === "ended") endedAt = performance.now();
    phase = s.phase;
  }

  // Hit flash when someone's HP goes down.
  const now = performance.now();
  s.grenades.forEach((g, id) => {
    if (!g.exploded || announcedBlasts.has(id)) return;
    announcedBlasts.add(id);
    blasts.push({ at: s.t + INTERP_DELAY_MS, x: g.tx, z: g.tz });
  });
  if (announcedBlasts.size > 64) for (const id of announcedBlasts) if (!s.grenades.has(id)) announcedBlasts.delete(id);
  s.players.forEach((p, id) => {
    const prev = lastHp.get(id);
    if (prev !== undefined && p.hp < prev) meshFor(id, p.slot).flash(now + (id === net.sessionId ? 0 : INTERP_DELAY_MS));
    lastHp.set(id, p.hp);
  });

  // Drop meshes of players who left.
  for (const [id, m] of meshes) {
    if (!s.players.has(id)) {
      scene.removePlayer(m);
      meshes.delete(id);
      lastHp.delete(id);
    }
  }
};

void net.connect(serverUrl);

// Dev-only handle for poking at the game from the console or a test script.
if (import.meta.env.DEV) Object.assign(window, { __bagarre: { scene, net, predictor, localBullets } });

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
      const move = screenToWorldMove(scene.camera, input.screenAxes());
      const here = predictor.sim ?? meServer;
      const target = cursor ?? { x: here.x + Math.cos(aim) * 6, z: here.z + Math.sin(aim) * 6 };
      const msg: InputMessage = {
        seq: ++seq,
        mx: move.mx,
        mz: move.mz,
        aim,
        fire: input.firing,
        gx: target.x,
        gz: target.z,
        ...input.presses,
      };
      const res = predictor.apply(msg, canMove(meServer, latest.phase));
      // Instant local shots: same pellets, same ids as the server will spawn.
      if (res?.fired) localBullets.spawn(meServer.slot, msg.seq, predictor.weapon, res.sim.x, res.sim.z, msg.aim);
      localBullets.step(opponentDrawn);
      net.sendInput(msg);
    }
    // After a long hitch, don't try to send a burst of stale inputs.
    if (accumulator > TICK_MS) accumulator = 0;
  }

  // 2. Local player: predicted position, smoothed between ticks.
  if (meServer) {
    const pos = predictor.render(accumulator / TICK_MS, dt);
    if (input.hasPointer) {
      const hit = scene.cursorOnGround(input.ndc);
      cursor = hit ? { x: hit.x, z: hit.z } : null;
      if (hit) {
        const dx = hit.x - pos.x;
        const dz = hit.z - pos.z;
        if (dx * dx + dz * dz > 0.01) aim = Math.atan2(dz, dx);
      }
    }
    const mine = meshFor(net.sessionId, meServer.slot);
    mine.set(pos.x, pos.z, aim, meServer.alive);
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
    m.set(s.x, s.z, s.aim, s.alive);
    m.setShield(s.shieldTicks > 0 ? s.shieldHp / SHIELD.absorb : 0);
    if (s.alive) opponentDrawn = { x: s.x, z: s.z };
  });

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
    scene.blast(b.x, b.z, now);
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

  const debugParts = [`pending inputs ${predictor.pendingCount}`, `correction ${predictor.lastError.toFixed(3)} m`];
  if (lagMs > 0) debugParts.unshift(`lag +${lagMs} ms`);
  hud.update({
    status,
    me: meServer,
    opponent,
    sim: predictor.sim,
    canPick: !!latest && canPick(meServer, latest.phase),
    banner,
    debug: debugParts.join("  |  "),
  });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

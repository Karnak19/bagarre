// One joined game: the prediction, interpolation, predicted bullets, player
// meshes and sound triggers for a single room. main.ts makes one per room it
// joins and disposes it on leave, so going menu -> game -> menu any number of
// times leaves nothing behind (no room, no mesh, no pending timer).

import {
  INTERP_DELAY_MS,
  SHIELD,
  TICK_MS,
  TICK_RATE,
  mapById,
  weaponDef,
  type InputMessage,
  type Phase,
  type PlayerView,
  type Vec2,
} from "@bagarre/shared";
import { WEAPON_SFX, isMuted, play, setListener, type PlayOptions, type SfxName } from "./audio.ts";
import { LocalBullets } from "./bullets.ts";
import type { Hud, HudModel } from "./hud.ts";
import { screenToWorldMove, type Input } from "./input.ts";
import { SnapshotBuffer } from "./interpolation.ts";
import type { Net, Snapshot } from "./net.ts";
import { Predictor } from "./prediction.ts";
import { GameScene, PLAYER_COLORS, PlayerMesh } from "./scene.ts";

// Our own actions play the moment they are predicted (in the tick loop below),
// never from reconcile: it replays pending inputs and would play them again.
// Everything read from a snapshot about the opponent is delayed by the
// interpolation delay, so it is heard when it is drawn.
const REMOTE_DELAY = INTERP_DELAY_MS / 1000;
/** How long the map name stays up at match start. */
const MAP_CARD_MS = 3500;
/** ...fading out over its last this many ms. */
const MAP_CARD_FADE_MS = 500;

/** Dev-only autopilot for the headless checks: world-space move, aim angle, fire. */
export interface Bot {
  on: boolean;
  mx: number;
  mz: number;
  aim: number;
  fire: boolean;
}

export interface SfxLogEntry {
  t: number;
  name: SfxName;
  delay: number;
  x?: number;
  z?: number;
}

export interface MatchDeps {
  scene: GameScene;
  input: Input;
  hud: Hud;
  net: Net;
  bot: Bot;
  /** Dev-only log of every sound played, read by the headless checks. */
  sfxLog: SfxLogEntry[];
}

function canMove(p: PlayerView, ph: Phase) {
  return p.alive && ph !== "ended";
}

/** Mirrors the server rule for MSG_PICK. */
function canPick(p: PlayerView | null, ph: Phase) {
  return !!p && (!p.alive || ph !== "playing");
}

export class Match {
  readonly net: Net;
  readonly buffer = new SnapshotBuffer();
  readonly predictor = new Predictor();
  readonly localBullets = new LocalBullets();
  private scene: GameScene;
  private input: Input;
  private hud: Hud;
  private bot: Bot;
  private sfxLog: SfxLogEntry[];
  private meshes = new Map<string, PlayerMesh>();
  /** Each player as of the previous snapshot, to spot what changed (hits, deaths, remote shots...). */
  private lastView = new Map<string, PlayerView>();
  /** Grenades already heard being thrown / landing. Pruned like `announcedBlasts`. */
  private seenGrenades = new Set<string>();
  private landedGrenades = new Set<string>();
  /**
   * Grenade blasts, detected when the snapshot arrives and shown when render
   * time reaches it. (Sampling the interpolated grenades could skip the single
   * snapshot where `exploded` is true on a slow frame.)
   */
  private blasts: { at: number; x: number; z: number; own: boolean }[] = [];
  private announcedBlasts = new Set<string>();
  /**
   * The opponent's muzzle flashes, due when render time reaches the shot. Read
   * from their ammo count like their shot sound (a point-blank bullet can hit
   * and vanish before any snapshot shows it, so "a new bullet appeared" misses
   * shots). One flash per round spent.
   */
  private remoteShots: { at: number; id: string }[] = [];
  /** The map of the latest snapshot ("" before the first one). */
  private mapId = "";
  /** Connection epoch of the snapshots in use (see Snapshot.epoch); -1 before the first. */
  private epoch = -1;
  /**
   * Time left on the map name card shown at match start, in ms. It counts down
   * by frame time capped at 100 ms per frame, not by the wall clock: the first
   * frames of a match can take seconds (shaders compiling for the new props and
   * the opponent's model) and would otherwise use it up before it is seen.
   */
  private mapCardLeft = 0;
  private seq = 0;
  private accumulator = 0;
  private aim = 0;
  private cameraSnapped = false;
  /** Server phase as of the latest snapshot. */
  phase: Phase = "waiting";
  /** performance.now() when the current match ended (for the rematch countdown). */
  endedAt = 0;
  /** Cursor on the ground (grenade target). */
  private cursor: Vec2 | null = null;
  /** Where the opponent was drawn last frame, for visual hits of predicted bullets. */
  private opponentDrawn: Vec2 | null = null;
  /** Fire button state on the previous tick, for the empty-click on a fresh press. */
  private wasFiring = false;
  private disposed = false;

  constructor(deps: MatchDeps) {
    this.net = deps.net;
    this.scene = deps.scene;
    this.input = deps.input;
    this.hud = deps.hud;
    this.bot = deps.bot;
    this.sfxLog = deps.sfxLog;
    this.net.onSnapshot = (s) => this.onSnapshot(s);
  }

  private sfx(name: SfxName, opts?: PlayOptions) {
    if (import.meta.env.DEV) this.sfxLog.push({ t: performance.now(), name, delay: opts?.delay ?? 0, x: opts?.x, z: opts?.z });
    play(name, opts);
  }

  /** The latest snapshot, or null before the first one. */
  get latest(): Snapshot | null {
    return this.buffer.latest() ?? null;
  }

  get me(): PlayerView | null {
    return this.latest?.players.get(this.net.sessionId) ?? null;
  }

  get opponent(): PlayerView | null {
    let out: PlayerView | null = null;
    this.latest?.players.forEach((p, id) => {
      if (id !== this.net.sessionId) out = p;
    });
    return out;
  }

  /** Weapon picks are accepted right now (dead, waiting or between matches). */
  get canPick(): boolean {
    const latest = this.latest;
    return !!latest && canPick(this.me, latest.phase);
  }

  /** Picks the weapon for the next (re)spawn, if allowed right now. Returns whether it was sent. */
  pick(weapon: number): boolean {
    if (!this.canPick) return false;
    this.net.sendPick(weapon);
    this.sfx("weapon_pick");
    return true;
  }

  private meshFor(id: string, slot: number): PlayerMesh {
    let m = this.meshes.get(id);
    if (!m) {
      m = new PlayerMesh(PLAYER_COLORS[slot] ?? 0x888888, id === this.net.sessionId, slot);
      this.meshes.set(id, m);
      this.scene.addPlayer(m);
    }
    return m;
  }

  private dropMesh(id: string) {
    const m = this.meshes.get(id);
    if (!m) return;
    this.scene.removePlayer(m);
    m.dispose();
    this.meshes.delete(id);
    this.lastView.delete(id);
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
  private switchMap(id: string) {
    const map = mapById(id);
    this.mapId = id;
    this.buffer.clear();
    this.predictor.setMap(map);
    this.localBullets.setMap(map);
    this.scene.setMap(map);
    this.scene.clearProjectiles();
    this.blasts.length = 0;
    this.remoteShots.length = 0;
    this.opponentDrawn = null;
    this.cameraSnapped = false;
  }

  /**
   * A fresh start from this snapshot: the first one, or the first one after
   * an automatic reconnection. Everything from before the drop is dropped
   * the same way a map switch does it (the opponent would slide from where
   * they were, our pending inputs were lost with the connection). On top of
   * that, what already happened while we were away is taken as known, not
   * replayed: no hit, death or throw sound for it, no blast.
   */
  private resync(s: Snapshot) {
    this.epoch = s.epoch;
    // A new map rebuilds the arena; the same map only needs what switchMap
    // drops besides the arena.
    if (s.mapId !== this.mapId) this.switchMap(s.mapId);
    else {
      this.buffer.clear();
      this.scene.clearProjectiles();
      this.blasts.length = 0;
      this.remoteShots.length = 0;
      this.opponentDrawn = null;
      this.cameraSnapped = false;
    }
    this.predictor.reset();
    this.localBullets.clear();
    this.lastView.clear();
    this.accumulator = 0;
    s.grenades.forEach((g, id) => {
      this.seenGrenades.add(id);
      if (g.landed) this.landedGrenades.add(id);
      if (g.exploded) this.announcedBlasts.add(id);
    });
    // After a reload this is a new Match on an old seat: carry on from what
    // the server already has, or it would ignore our inputs (seq) and
    // ability presses (counters) until ours caught up.
    const me = s.players.get(this.net.sessionId);
    if (me) {
      this.seq = Math.max(this.seq, me.lastSeq);
      const p = this.input.presses;
      p.dash = Math.max(p.dash, me.dashSeen);
      p.grenade = Math.max(p.grenade, me.grenadeSeen);
      p.shield = Math.max(p.shield, me.shieldSeen);
      p.reload = Math.max(p.reload, me.reloadSeen);
    }
  }

  private onSnapshot(s: Snapshot) {
    if (this.disposed) return;
    const sessionId = this.net.sessionId;
    // Still in the `?lag=` queue from before a reconnection: stale.
    if (s.epoch < this.epoch) return;
    if (s.epoch !== this.epoch) this.resync(s);
    else if (s.mapId !== this.mapId) this.switchMap(s.mapId);
    this.buffer.push(s);
    const me = s.players.get(sessionId);
    if (me) {
      this.predictor.reconcile(me, canMove(me, s.phase));
      this.localBullets.reconcile(s, me.lastSeq);
    }

    if (s.phase !== this.phase) {
      if (s.phase === "playing") this.mapCardLeft = MAP_CARD_MS;
      if (s.phase === "ended") {
        this.endedAt = performance.now();
        this.sfx(s.winner === sessionId ? "match_win" : "match_lose");
      }
      this.phase = s.phase;
    }

    const now = performance.now();
    s.grenades.forEach((g, id) => {
      // Our own throws were already heard from the prediction.
      if (!this.seenGrenades.has(id)) {
        this.seenGrenades.add(id);
        if (g.owner !== sessionId) this.sfx("grenade_throw", { x: g.x, z: g.z, delay: REMOTE_DELAY });
      }
      if (g.landed && !this.landedGrenades.has(id)) {
        this.landedGrenades.add(id);
        this.sfx("grenade_bounce", { x: g.tx, z: g.tz, delay: REMOTE_DELAY });
      }
      if (!g.exploded || this.announcedBlasts.has(id)) return;
      this.announcedBlasts.add(id);
      this.blasts.push({ at: s.t + INTERP_DELAY_MS, x: g.tx, z: g.tz, own: g.owner === sessionId });
    });
    for (const set of [this.announcedBlasts, this.seenGrenades, this.landedGrenades])
      if (set.size > 64) for (const id of set) if (!s.grenades.has(id)) set.delete(id);

    s.players.forEach((p, id) => {
      const prev = this.lastView.get(id);
      this.lastView.set(id, p);
      if (!prev) return;
      const mine = id === sessionId;
      // Our own events are heard now; the opponent's when they are drawn, where they are.
      const at: PlayOptions | undefined = mine ? undefined : { x: p.x, z: p.z, delay: REMOTE_DELAY };

      // Hit flash (and its sound) when someone's HP goes down.
      if (p.hp < prev.hp) {
        this.meshFor(id, p.slot).flash(now + (mine ? 0 : INTERP_DELAY_MS));
        this.sfx(mine ? "hurt" : "hit", at);
      }
      if (p.shieldHp < prev.shieldHp && p.shieldHp > 0) this.sfx("shield_hit", at);
      // Broken by damage, not simply run out (expiry zeroes it on its last tick).
      if (prev.shieldHp > 0 && p.shieldHp === 0 && prev.shieldTicks > 1) this.sfx("shield_break", at);
      if (prev.alive && !p.alive) this.sfx("death", at);
      if (!prev.alive && p.alive) this.sfx("respawn", at);

      // The opponent's own actions (ours come from the prediction). Shots are
      // read from the ammo count, not from new bullets: a fast bullet can hit
      // and vanish before any snapshot shows it. Several inputs can land in
      // one server tick, so one snapshot may hold more than one shot.
      if (mine || !prev.alive || !p.alive) return;
      const shots = p.weapon === prev.weapon ? prev.ammo - p.ammo : 0;
      const gap = weaponDef(p.weapon).fireInterval;
      for (let i = 0; i < shots; i++) {
        this.sfx(WEAPON_SFX[p.weapon] ?? "rifle", { ...at, delay: REMOTE_DELAY + i * gap });
        this.remoteShots.push({ at: now + INTERP_DELAY_MS + i * gap * 1000, id });
      }
      if (p.dashCd > prev.dashCd) this.sfx("dash", at);
      if (prev.reloadTicks === 0 && p.reloadTicks > 0) this.sfx("reload", { ...at, volume: 0.7 });
      if (p.shieldTicks > prev.shieldTicks) this.sfx("shield_up", at);
    });

    // Drop meshes of players who left.
    for (const id of this.meshes.keys()) if (!s.players.has(id)) this.dropMesh(id);
  }

  /** One frame: send this frame's inputs, draw everyone, update the HUD. */
  frame(now: number, dtMs: number) {
    if (this.disposed) return;
    const dt = dtMs / 1000;
    const { scene, input, bot, net, predictor, localBullets, buffer } = this;
    const sessionId = net.sessionId;
    const latest = buffer.latest();
    const meServer = latest?.players.get(sessionId) ?? null;

    // 1. Fixed-rate input: exactly one input per simulation tick, predicted
    //    locally with the shared step function and sent to the server. Inputs
    //    keep flowing while an overlay is up (Input is then off, so they say
    //    "stand still, don't fire"): the server still acks them and the
    //    prediction stays in step.
    //    Nothing while reconnecting: the server takes no input from us then,
    //    and our character must not run off on its own.
    if (net.status !== "connected") this.accumulator = 0;
    else if (latest && meServer) {
      this.accumulator += dtMs;
      let steps = 0;
      while (this.accumulator >= TICK_MS && steps < 5) {
        this.accumulator -= TICK_MS;
        steps++;
        const move = bot.on ? { mx: bot.mx, mz: bot.mz } : screenToWorldMove(scene.camera, input.screenAxes());
        const here = predictor.sim ?? meServer;
        const aim = this.aim;
        const target = this.cursor ?? { x: here.x + Math.cos(aim) * 6, z: here.z + Math.sin(aim) * 6 };
        const msg: InputMessage = {
          seq: ++this.seq,
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
          if (res.fired) this.sfx(WEAPON_SFX[predictor.weapon] ?? "rifle");
          if (res.sim.dashCd > before.dashCd) this.sfx("dash");
          if (res.grenade) this.sfx("grenade_throw");
          if (res.shield) this.sfx("shield_up");
          if (before.reloadTicks === 0 && res.sim.reloadTicks > 0) this.sfx("reload");
          else if (msg.fire && !this.wasFiring && !res.fired && res.sim.reloadTicks > 0) this.sfx("empty_click");
        }
        this.wasFiring = msg.fire;
        localBullets.step(this.opponentDrawn);
        net.sendInput(msg);
      }
      // After a long hitch, don't try to send a burst of stale inputs.
      if (this.accumulator > TICK_MS) this.accumulator = 0;
    }

    // 2. Local player: predicted position, smoothed between ticks.
    if (meServer) {
      const pos = predictor.render(this.accumulator / TICK_MS, dt);
      setListener(pos.x, pos.z);
      if (bot.on) this.aim = bot.aim;
      else if (input.hasPointer && input.enabled) {
        const hit = scene.cursorOnGround(input.ndc);
        this.cursor = hit ? { x: hit.x, z: hit.z } : null;
        if (hit) {
          const dx = hit.x - pos.x;
          const dz = hit.z - pos.z;
          if (dx * dx + dz * dz > 0.01) this.aim = Math.atan2(dz, dx);
        }
      }
      const mine = this.meshFor(sessionId, meServer.slot);
      mine.set(pos.x, pos.z, this.aim, meServer.alive, meServer.weapon);
      mine.setShield(meServer.shieldTicks > 0 ? meServer.shieldHp / SHIELD.absorb : 0);
      scene.follow(pos.x, pos.z, dt, !this.cameraSnapped);
      this.cameraSnapped = true;
    }

    // 3. Remote player and bullets: interpolated ~100 ms in the past.
    const renderTime = now - INTERP_DELAY_MS;
    let opponent: PlayerView | null = null;
    this.opponentDrawn = null;
    latest?.players.forEach((p, id) => {
      if (id === sessionId) return;
      opponent = p;
      const s = buffer.samplePlayer(id, renderTime);
      if (!s) return;
      const m = this.meshFor(id, s.slot);
      m.set(s.x, s.z, s.aim, s.alive, s.weapon);
      m.setShield(s.shieldTicks > 0 ? s.shieldHp / SHIELD.absorb : 0);
      if (s.alive) this.opponentDrawn = { x: s.x, z: s.z };
    });
    const shots = this.remoteShots;
    for (let i = shots.length - 1; i >= 0; i--) {
      if (shots[i].at > now) continue;
      this.meshes.get(shots[i].id)?.shot(now);
      shots.splice(i, 1);
    }

    // Our own bullets are drawn from the prediction; the server's copies of
    // them are skipped (see LocalBullets). Everyone else's are interpolated.
    const bullets = new Map<string, { x: number; z: number; slot: number }>();
    for (const [id, b] of buffer.sampleBullets(renderTime)) {
      if (localBullets.owns(id)) continue;
      bullets.set(id, { x: b.x, z: b.z, slot: latest?.players.get(b.owner)?.slot ?? 0 });
    }
    if (meServer) localBullets.render(this.accumulator / TICK_MS, meServer.slot, bullets);
    scene.syncBullets(bullets);
    scene.syncGrenades(buffer.sampleGrenades(renderTime), now);
    while (this.blasts.length > 0 && this.blasts[0].at <= now) {
      const b = this.blasts.shift()!;
      scene.blast(b.x, b.z, now, b.own);
      this.sfx("explosion", { x: b.x, z: b.z });
    }

    for (const m of this.meshes.values()) {
      m.update(now);
      if (m.dashing) scene.addGhost(m.group.position.x, m.group.position.z, m.color, now);
    }

    // 4. HUD. Waiting and the match result have their own cards (overlays.ts).
    // (`opponent` is assigned in a callback above, which TypeScript can't follow.)
    const opp = opponent as PlayerView | null;
    const away = opp && !opp.connected ? opp : null;
    let status = "";
    if (net.status === "disconnected") status = `Disconnected${net.error ? `: ${net.error}` : ""}.`;
    else if (away) status = `${away.name || "Your opponent"} lost their connection. Waiting for them to come back…`;
    else if (meServer && !meServer.alive && latest?.phase === "playing")
      status = `Respawning in ${(meServer.respawnTicks / TICK_RATE).toFixed(1)}s (1-4 to change weapon)`;

    const map = scene.map;
    let mapCard: HudModel["mapCard"] = null;
    if (map && latest?.phase === "playing" && this.mapCardLeft > 0) {
      mapCard = { title: map.name, sub: map.blurb, opacity: Math.min(1, this.mapCardLeft / MAP_CARD_FADE_MS) };
      this.mapCardLeft -= Math.min(dtMs, 100);
    }

    const debugParts = [`pending inputs ${predictor.pendingCount}`, `correction ${predictor.lastError.toFixed(3)} m`];
    if (net.lagMs > 0) debugParts.unshift(`lag +${net.lagMs} ms`);
    this.hud.update({
      status,
      me: meServer,
      opponent,
      sim: predictor.sim,
      canPick: !!latest && canPick(meServer, latest.phase),
      mapCard,
      debug: debugParts.join("  |  "),
      muted: isMuted(),
    });
  }

  /** Removes everything this game put in the scene and stops reacting to the network. Leave the room with `net.leave()`. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.net.onSnapshot = () => {};
    for (const id of this.meshes.keys()) this.dropMesh(id);
    this.scene.clearProjectiles();
    this.buffer.clear();
    this.blasts.length = 0;
    this.remoteShots.length = 0;
  }
}

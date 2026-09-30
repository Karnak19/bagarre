// One joined game: the prediction, interpolation, predicted bullets, player
// meshes and sound triggers for a single room. main.ts makes one per room it
// joins and disposes it on leave, so going menu -> game -> menu any number of
// times leaves nothing behind (no room, no mesh, no pending timer).
//
// Watching (no seat: we aren't in `state.players`) runs the same match with
// no local player: nothing is predicted or sent, everyone is interpolated
// like a remote player, and the camera and the sound listener come from the
// spectator (spectate/spectator.ts). Taking a seat mid-way flips back to the
// player path on the first snapshot that has us, on the same Match.
//
// Battle royale: once knocked out (`knockedOut`) we keep our seat but watch
// like a spectator until the match ends: the camera starts on our killer (the
// nearest living player after a zone death) and cycles through the players
// still alive. While alive, the number keys and the wheel pick a gun slot
// (Input's slot mode), predicted by the shared step like a shot; the zone,
// the crates and the items on the floor are drawn from the latest snapshot
// (scene.royale), the zone at the server tick we are at right now.

import {
  GRENADES,
  INTERP_DELAY_MS,
  KILL_GRENADE,
  KILL_ZONE,
  MAX_HP,
  NO_GUN,
  ROYALE,
  NO_TEAM,
  SHIELD,
  TICK_MS,
  TICK_RATE,
  WEAPONS,
  canDamage,
  carriedGuns,
  cycleSlot,
  findMap,
  gunAt,
  isGrenadeType,
  magAt,
  ordinal,
  outsideZone,
  playerCan,
  sameTeam,
  ownsCloud,
  smokeCover,
  smokeVeil,
  weaponDef,
  zoneAt,
  zoneProgress,
  type InputMessage,
  type KitMode,
  type Phase,
  type PlayerView,
  type SmokeVeil,
  type Vec2,
} from "@bagarre/shared";
import { getShowNames } from "./display.ts";
import { isMuted, play, setListener, type PlayOptions, type SfxName } from "./audio.ts";
import { LocalBullets } from "./bullets.ts";
import type { FfaHud, Hud, HudModel, KillFeedLine, RoyaleHud, TeamHud } from "./hud.ts";
import { screenToWorldMove, type Input } from "./input.ts";
import { WEAPON_KEYS, grenadeView, gunView } from "./items.ts";
import { SnapshotBuffer } from "./interpolation.ts";
import type { Minimap } from "./minimap.ts";
import type { Net, Snapshot } from "./net.ts";
import { Predictor } from "./prediction.ts";
import { paintFor, paintOf } from "./paint.ts";
import { FADED_OPACITY, GameScene, PLAYER_CSS_COLORS, PlayerMesh, playerColor } from "./scene.ts";
import type { SmokeCloud } from "./vfx.ts";
import { byPlace, clock, secondsLeft, warmupLeft } from "./scoreboard.ts";
import { sceneRig } from "./spectate/camera.ts";
import type { SpectatorControlActions } from "./spectate/controls.ts";
import type { CameraMode } from "./spectate/model.ts";
import { Spectator } from "./spectate/spectator.ts";

/** The spectator's Follow zoom: the game's own in a duel, a little wider on the bigger FFA and team maps. */
const FOLLOW_VIEW_HEIGHT = { duel: 22, ffa: 26, tdm: 26, royale: 26 } as const;
/** How the players of a mode carry their guns (the shared step's KitMode). */
const kitOf = (mode: string): KitMode => (mode === "royale" ? "slots" : "loadout");
/** CSS colour of a paint index (paint.ts). */
const paintCss = (paint: number) => PLAYER_CSS_COLORS[paint % PLAYER_CSS_COLORS.length];

// Our own actions play the moment they are predicted (in the tick loop below),
// never from reconcile: it replays pending inputs and would play them again.
// Everything read from a snapshot about the opponent is delayed by the
// interpolation delay, so it is heard when it is drawn.
const REMOTE_DELAY = INTERP_DELAY_MS / 1000;
/** How long the map name stays up at match start. */
const MAP_CARD_MS = 3500;
/** ...fading out over its last this many ms. */
const MAP_CARD_FADE_MS = 500;
/**
 * The flash's white screen: fully white for the first part of it, then a
 * steady fade out (opacity = min(1, fraction left x FLASH_HOLD)). A plain
 * fade, never a strobe.
 */
const FLASH_HOLD = 1.6;
/** How long a kill feed line stays up, fading over its last second. */
export const KILL_FEED_MS = 6000;
const KILL_FEED_FADE_MS = 1000;

/** Dev-only autopilot for the headless checks: world-space move, aim angle, fire. */
export interface Bot {
  on: boolean;
  mx: number;
  mz: number;
  aim: number;
  fire: boolean;
  /** Where a grenade thrown now goes (null: 6 m ahead along the aim, or the cursor). */
  target: Vec2 | null;
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
  minimap: Minimap;
}

/** What our player may do this step: the server's own rule (`playerCan`), so warmup predicts no shot. */
function canMove(p: PlayerView, ph: Phase) {
  return playerCan(p.alive, ph);
}

/**
 * Mirrors the server rule for MSG_PICK: while dead, or at any time outside
 * `playing` (waiting, warmup, between matches). In warmup a living player's
 * pick goes in hand at once; the predictor follows when the server's
 * snapshot shows the new weapon (reconcile).
 */
function canPick(p: PlayerView | null, ph: Phase, mode = "duel") {
  // Battle royale: no loadout at all (everyone starts with the Pistol).
  return mode !== "royale" && !!p && (!p.alive || ph !== "playing");
}

/**
 * Battle royale: we are out (killed, the zone) while the match goes on, so
 * we watch it like a spectator, from our own seat.
 */
function isKnockedOut(s: Snapshot | null | undefined, me: PlayerView | null | undefined): boolean {
  return !!s && !!me && s.mode === "royale" && s.phase === "playing" && !me.alive && me.outTick > 0;
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
  private minimap: Minimap;
  private meshes = new Map<string, PlayerMesh>();
  /** When each kill feed line was first seen (performance.now()), by its `n`. */
  private feedSeen = new Map<number, number>();
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
  private blasts: { at: number; x: number; z: number; own: boolean; kind: number }[] = [];
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
  /** Where the living opponents were drawn last frame, for visual hits of predicted bullets. */
  private opponentsDrawn: Vec2[] = [];
  /** Fire button state on the previous tick, for the empty-click on a fresh press. */
  private wasFiring = false;
  private disposed = false;
  /**
   * The spectator view (camera, player list), made on the first snapshot
   * without us in it, once the mode is known. Kept after a seat is taken
   * (unused then), so a later switch back reuses it.
   */
  spectator: Spectator | null = null;
  /** Highest kill feed number already handed to the spectator (its "switch to the killer"). */
  private lastKillN = -1;
  /** The previous frame was a spectator's: the frustum must go back to the game's when we get a seat. */
  private spectatedLastFrame = false;
  /** Where a player was drawn this frame (their mesh, interpolated): the spectator camera's target. No allocation. */
  private readonly drawnAt = (id: string, out: { x: number; z: number }): boolean => {
    const m = this.meshes.get(id);
    if (!m) return false;
    out.x = m.group.position.x;
    out.z = m.group.position.z;
    return true;
  };
  /** Called by `dispose()`: the engine's spectator controls go with the match. */
  onDispose: () => void = () => {};

  constructor(deps: MatchDeps) {
    this.net = deps.net;
    this.scene = deps.scene;
    this.input = deps.input;
    this.hud = deps.hud;
    this.bot = deps.bot;
    this.sfxLog = deps.sfxLog;
    this.minimap = deps.minimap;
    this.net.onSnapshot = (s) => this.onSnapshot(s);
    // The wheel, in slot mode: the next or previous gun carried, from our predicted slots.
    this.input.onCycle = (dir) => {
      const sim = this.predictor.sim;
      if (sim && this.predictor.kit === "slots") this.input.selectSlot(cycleSlot(sim.kit, dir));
    };
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

  /**
   * Watching: a snapshot has come in and we aren't in it, or (battle royale)
   * we are out of the match and watch the rest of it from our seat.
   */
  get spectating(): boolean {
    return !!this.latest && (this.net.role === "spectator" || this.knockedOut);
  }

  /** Battle royale: knocked out while the match goes on (we watch it, see isKnockedOut). */
  get knockedOut(): boolean {
    return isKnockedOut(this.latest, this.me);
  }

  /**
   * What the spectator controls and overlay call. Stable for the match's
   * life (the Spectator itself only exists from the first snapshot).
   */
  readonly spectateActions: SpectatorControlActions & { follow(id: string): void } = {
    cycle: (dir) => this.spectator?.cycle(dir),
    setMode: (mode: CameraMode) => this.spectator?.setMode(mode),
    mode: () => this.spectator?.mode() ?? "follow",
    pan: (x, y) => this.spectator?.pan(x, y),
    drag: (dx, dy) => this.spectator?.drag(dx, dy),
    zoom: (dy) => this.spectator?.zoom(dy),
    follow: (id) => this.spectator?.follow(id),
  };

  get opponent(): PlayerView | null {
    let out: PlayerView | null = null;
    this.latest?.players.forEach((p, id) => {
      if (id !== this.net.sessionId) out = p;
    });
    return out;
  }

  /**
   * What the input sent now may do. The snapshot's rule (`playerCan`), but
   * at the end of a warmup the snapshot is behind: an input sent now reaches
   * the server about a round trip after the snapshot's tick, so once that is
   * past the warmup's end tick it is predicted armed, like the server will
   * treat it (the match's first shot is seen and heard at once, not only
   * when the server's bullet comes back).
   */
  private canNow(me: PlayerView, s: Snapshot, now: number) {
    const can = canMove(me, s.phase);
    if (!can.act || can.armed || s.phase !== "warmup" || s.warmupEnd <= 0) return can;
    // The server applies inputs before it ends the warmup in a tick, so it
    // arms them from the tick after the end one; one more tick of margin, as a
    // shot predicted too early would be a ghost bullet.
    const arrives = s.tick + (now - s.t + me.ping) / TICK_MS;
    return arrives >= s.warmupEnd + 2 ? { act: true, armed: true } : can;
  }

  /** Weapon picks are accepted right now (dead, waiting or between matches). */
  get canPick(): boolean {
    const latest = this.latest;
    return !!latest && canPick(this.me, latest.phase, latest.mode);
  }

  /** Picks the weapon for the next (re)spawn, if allowed right now. Returns whether it was sent. */
  pick(weapon: number): boolean {
    if (!this.canPick) return false;
    this.net.sendPick({ weapon });
    this.sfx("weapon_pick");
    return true;
  }

  /** Picks the grenade type for the next (re)spawn, same rules as a weapon. Returns whether it was sent. */
  pickGrenade(type: number): boolean {
    if (!this.canPick || !isGrenadeType(type)) return false;
    this.net.sendPick({ grenade: type });
    this.sfx("weapon_pick");
    return true;
  }

  /** The next grenade type after the one picked (G cycles them). */
  cycleGrenade(): boolean {
    const me = this.me;
    return !!me && this.pickGrenade((me.grenadePick + 1) % GRENADES.length);
  }

  /** How smoke has each player drawn for us this frame (dev handle, tests). */
  veils(): Record<string, SmokeVeil> {
    const out: Record<string, SmokeVeil> = {};
    for (const [id, m] of this.meshes) out[id] = m.veil;
    return out;
  }

  /** The player's mesh, in `paint` (paint.ts), wearing `skin`. A new paint (a team switch) or skin remakes it. */
  private meshFor(id: string, paint: number, skin: string | undefined): PlayerMesh {
    let m = this.meshes.get(id);
    // None sent (an older server, or a snapshot without it): keep the skin
    // already worn rather than remake the mesh; with no mesh yet, the capsule.
    skin ||= m?.skin || "";
    if (m && (m.slot !== paint || m.skin !== skin)) {
      this.scene.removePlayer(m);
      m.dispose();
      this.meshes.delete(id);
      m = undefined;
    }
    if (!m) {
      m = new PlayerMesh(playerColor(paint), id === this.net.sessionId, paint, skin, id);
      this.meshes.set(id, m);
      this.scene.addPlayer(m);
    }
    return m;
  }

  /** Dev only: every heal cue shown, oldest first (the dev handle's `heals`). */
  readonly healLog: { t: number; id: string; amount: number }[] = [];

  /** Per player drawn, the skin its mesh wears and whether that model has loaded (the dev handle's `skins()`). */
  skins(): Record<string, { skin: string; loaded: boolean }> {
    const out: Record<string, { skin: string; loaded: boolean }> = {};
    for (const [id, m] of this.meshes) out[id] = { skin: m.skin, loaded: m.loaded };
    return out;
  }

  private dropMesh(id: string) {
    const m = this.meshes.get(id);
    if (!m) return;
    this.scene.removePlayer(m);
    m.dispose();
    this.meshes.delete(id);
    this.lastView.delete(id);
    this.scene.plates.release(id);
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
    this.mapId = id;
    // Duel and FFA maps alike. An unknown id is a bug (an older client, a
    // map not in this build): say so and keep what is on screen, rather than
    // silently predicting on another map.
    const map = findMap(id);
    if (!map) {
      console.error(`[match] unknown map "${id}": this client doesn't have it`);
      return;
    }
    this.buffer.clear();
    this.predictor.setMap(map);
    this.localBullets.setMap(map);
    this.scene.setMap(map);
    this.minimap.setMap(map);
    this.spectator?.setMap(map);
    this.scene.clearProjectiles();
    this.blasts.length = 0;
    this.remoteShots.length = 0;
    this.opponentsDrawn = [];
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
      this.opponentsDrawn = [];
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
      p.switch = Math.max(p.switch, me.kit.switchSeen);
      p.swap = Math.max(p.swap, me.kit.swapSeen);
      this.input.slot = me.kit.hand;
    }
  }

  private onSnapshot(s: Snapshot) {
    if (this.disposed) return;
    const sessionId = this.net.sessionId;
    // Still in the `?lag=` queue from before a reconnection: stale.
    if (s.epoch < this.epoch) return;
    const newEpoch = s.epoch !== this.epoch;
    if (newEpoch) this.resync(s);
    else if (s.mapId !== this.mapId) this.switchMap(s.mapId);
    const resynced = newEpoch || this.lastKillN < 0;
    this.buffer.push(s);
    const me = s.players.get(sessionId);
    if (me) {
      this.predictor.reconcile(me, canMove(me, s.phase), kitOf(s.mode));
      this.localBullets.reconcile(s, me.lastSeq);
    }

    const now = performance.now();
    this.spectate(s, now, !me || isKnockedOut(s, me), resynced);

    // A new phase (a match starting, a duel back to waiting) resets everyone's
    // HP without a death: that is no heal.
    const samePhase = s.phase === this.phase;
    if (s.phase !== this.phase) {
      // The map's name as the match starts: with its warmup, or into play when there is none.
      if (s.phase === "warmup" || (s.phase === "playing" && this.phase !== "warmup")) this.mapCardLeft = MAP_CARD_MS;
      if (s.phase === "ended") {
        this.endedAt = performance.now();
        // A spectator has no side: no win or lose sting. With teams, our team's result.
        const won = s.mode === "tdm" ? !!me && me.team === s.winningTeam : s.winner === sessionId;
        if (me) this.sfx(won ? "match_win" : "match_lose");
      }
      this.phase = s.phase;
    }

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
      this.blasts.push({ at: s.t + INTERP_DELAY_MS, x: g.tx, z: g.tz, own: g.owner === sessionId, kind: g.kind });
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
        this.meshFor(id, paintOf(p), p.skin).flash(now + (mine ? 0 : INTERP_DELAY_MS));
        this.sfx(mine ? "hurt" : "hit", at);
      }
      // Heal cue (a green glow on them) when HP goes up while they stay alive,
      // in the same phase. Never on a respawn (dead before) or a match
      // reset (a new phase), and never the hit flash or sound above.
      if (p.hp > prev.hp && prev.alive && p.alive && samePhase) {
        this.meshFor(id, paintOf(p), p.skin).healed(now + (mine ? 0 : INTERP_DELAY_MS));
        if (import.meta.env.DEV) this.healLog.push({ t: now, id, amount: p.hp - prev.hp });
      }
      if (p.shieldHp < prev.shieldHp && p.shieldHp > 0) this.sfx("shield_hit", at);
      // Broken by damage, not simply run out (expiry zeroes it on its last tick).
      if (prev.shieldHp > 0 && p.shieldHp === 0 && prev.shieldTicks > 1) this.sfx("shield_break", at);
      if (prev.alive && !p.alive) this.sfx("death", at);
      if (!prev.alive && p.alive) this.sfx("respawn", at);
      // Battle royale: something picked up (a gun in a new slot, grenades).
      if (mine && p.alive && prev.alive && samePhase && (carriedGuns(p).length > carriedGuns(prev).length || p.kit.grenades > prev.kit.grenades))
        this.sfx("weapon_pick");

      // The opponent's own actions (ours come from the prediction). Shots are
      // read from the ammo count, not from new bullets: a fast bullet can hit
      // and vanish before any snapshot shows it. Several inputs can land in
      // one server tick, so one snapshot may hold more than one shot.
      if (mine || !prev.alive || !p.alive) return;
      const shots = p.weapon === prev.weapon ? prev.ammo - p.ammo : 0;
      const def = weaponDef(p.weapon);
      const gap = def.burst ? (def.burstInterval ?? def.fireInterval) : def.fireInterval;
      for (let i = 0; i < shots; i++) {
        this.sfx(gunView(p.weapon).sfx, { ...at, delay: REMOTE_DELAY + i * gap });
        this.remoteShots.push({ at: now + INTERP_DELAY_MS + i * gap * 1000, id });
      }
      if (p.dashCd > prev.dashCd) this.sfx("dash", at);
      if (prev.reloadTicks === 0 && p.reloadTicks > 0) this.sfx("reload", { ...at, volume: 0.7 });
      if (p.shieldTicks > prev.shieldTicks) this.sfx("shield_up", at);
    });

    // Drop meshes of players who left.
    for (const id of this.meshes.keys()) if (!s.players.has(id)) this.dropMesh(id);
  }

  /**
   * Feeds the spectator one snapshot (and makes it on the first one we
   * watch). The kills since the last snapshot come from the synced kill
   * feed, so the camera can move to the killer; a self-kill (killer "")
   * names the victim, which the model reads as "no killer". `reset`: the
   * first snapshot or a reconnect's resync, whose feed is history, and whose
   * players' state isn't a change.
   */
  private spectate(s: Snapshot, now: number, watching: boolean, reset: boolean) {
    let kills: { victim: string; killer: string }[] | undefined;
    let top = this.lastKillN;
    for (const k of s.feed) {
      if (k.n <= this.lastKillN) continue;
      top = Math.max(top, k.n);
      if (!reset) (kills ??= []).push({ victim: k.victim, killer: k.killer || k.victim });
    }
    this.lastKillN = Math.max(top, 0);
    const out = isKnockedOut(s, s.players.get(this.net.sessionId));
    const justOut = out && !this.wasOut;
    this.wasOut = out;
    if (!watching) return;
    if (!this.spectator) {
      const mode = s.mode;
      // The spectator colours players by seat; with teams, a seat's colour is its player's team's.
      const colorOf = (slot: number) => {
        let paint = slot;
        this.latest?.players.forEach((p) => {
          if (p.slot === slot) paint = paintOf(p);
        });
        return paintCss(paint);
      };
      // A battle royale cycles through the players still in it only.
      this.spectator = new Spectator({ rig: sceneRig(this.scene), colorOf, followViewHeight: FOLLOW_VIEW_HEIGHT[mode], cycleAlive: mode === "royale" });
      const map = findMap(s.mapId);
      if (map) this.spectator.setMap(map);
      // Follow in a duel, the whole map in a free for all or a team deathmatch.
      if (mode !== "duel") this.spectator.setMode("overview");
      reset = true;
    }
    // No "Join the game" in a royale once it started (no drop-in): no free seat to show.
    const maxPlayers = s.mode === "royale" && s.phase !== "waiting" ? s.players.size : s.maxPlayers;
    this.spectator.onSnapshot({ players: s.players, spectators: s.spectators, maxPlayers, kills }, now, reset);
    // Just knocked out: watch whoever did it, or the nearest player still in after a zone death.
    if (justOut) {
      const me = s.players.get(this.net.sessionId);
      const line = [...s.feed].reverse().find((k) => k.victim === this.net.sessionId);
      const killer = line?.killer && s.players.get(line.killer)?.alive ? line.killer : null;
      let nearest: string | null = null;
      let best = Infinity;
      s.players.forEach((p, id) => {
        const d = me ? Math.hypot(p.x - me.x, p.z - me.z) : 0;
        if (id !== this.net.sessionId && p.alive && d < best) [best, nearest] = [d, id];
      });
      const target = killer ?? nearest;
      if (target) this.spectator.follow(target);
    }
  }

  /** The previous snapshot had us knocked out (battle royale), to catch the moment it happens. */
  private wasOut = false;

  /**
   * One frame: send this frame's inputs, draw everyone, update the HUD.
   * `draw` false (dev `?fps=` between two drawn frames): the game runs, but
   * the HUD and the minimap wait for the next drawn frame, like the scene.
   */
  frame(now: number, dtMs: number, draw = true) {
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
    // Battle royale: 1-3 and the wheel pick a gun slot (never a loadout gun), while in the match.
    const royale = latest?.mode === "royale";
    const out = isKnockedOut(latest, meServer);
    input.slotMode = royale && !!meServer && !out;
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
        const target = (bot.on && bot.target) || this.cursor || { x: here.x + Math.cos(aim) * 6, z: here.z + Math.sin(aim) * 6 };
        const msg: InputMessage = {
          seq: ++this.seq,
          mx: move.mx,
          mz: move.mz,
          aim,
          fire: bot.on ? bot.fire : input.firing,
          gx: target.x,
          gz: target.z,
          ...input.presses,
          slot: input.slot,
        };
        const before = predictor.sim;
        const res = predictor.apply(msg, this.canNow(meServer, latest, now));
        // Instant local shots: same pellets, same ids as the server will spawn,
        // from the gun in hand as predicted (a slot switch counts at once).
        const gun = predictor.weaponOf(res?.sim ?? null);
        if (res?.fired) localBullets.spawn(meServer.slot, msg.seq, gun, res.sim.x, res.sim.z, msg.aim);
        if (res && before) {
          if (res.fired) this.sfx(gunView(gun).sfx);
          if (predictor.weaponOf(before) !== gun) this.sfx("weapon_pick");
          if (res.sim.dashCd > before.dashCd) this.sfx("dash");
          if (res.grenade) this.sfx("grenade_throw");
          if (res.shield) this.sfx("shield_up");
          if (before.reloadTicks === 0 && res.sim.reloadTicks > 0) this.sfx("reload");
          else if (msg.fire && !this.wasFiring && !res.fired && res.sim.reloadTicks > 0) this.sfx("empty_click");
        }
        this.wasFiring = msg.fire;
        localBullets.step(this.opponentsDrawn);
        net.sendInput(msg);
      }
      // After a long hitch, don't try to send a burst of stale inputs.
      if (this.accumulator > TICK_MS) this.accumulator = 0;
    }

    // 2. Local player: predicted position, smoothed between ticks. Where we
    //    stand is also where smoke is seen from (`viewer`).
    let viewer: Vec2 | null = null;
    // Knocked out in a royale: the spectator's camera and ears, like a watcher.
    const watching = !meServer || out;
    if (!watching && this.spectatedLastFrame) {
      // A seat was just taken: back to the game's own framing.
      this.spectatedLastFrame = false;
      scene.resize();
      this.cameraSnapped = false;
    }
    if (meServer) {
      const pos = predictor.render(this.accumulator / TICK_MS, dt);
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
      const mine = this.meshFor(sessionId, paintOf(meServer), meServer.skin);
      mine.set(pos.x, pos.z, this.aim, meServer.alive, predictor.weaponOf());
      if ((predictor.sim?.stunTicks ?? 0) > 0) mine.stunned(now);
      viewer = pos;
      const shield = meServer.shieldTicks > 0 ? meServer.shieldHp / SHIELD.absorb : 0;
      mine.setShield(shield);
      // Our own plate: the bar alone, at the predicted position like the body.
      scene.plates.set(sessionId, pos.x, pos.z, meServer.name, paintOf(meServer), meServer.hp / MAX_HP, shield, meServer.alive, meServer.connected, false);
      if (!watching) {
        setListener(pos.x, pos.z);
        scene.follow(pos.x, pos.z, dt, !this.cameraSnapped);
        this.cameraSnapped = true;
      }
    }

    // Battle royale: the zone as of now (the latest tick plus the time since
    // it came in), the crates and the items on the floor.
    const tickNow = latest ? latest.tick + (now - latest.t) / TICK_MS : 0;
    if (royale && latest) {
      scene.royale.setZone(zoneAt(latest.zone, tickNow));
      scene.royale.sync(latest.crates, latest.items, now);
    }

    // 3. Remote players and bullets: interpolated ~100 ms in the past.
    const renderTime = now - INTERP_DELAY_MS;
    let opponent: PlayerView | null = null;
    const drawn: Vec2[] = [];
    const allies: { x: number; z: number; slot: number }[] = [];
    const myTeam = meServer?.team ?? NO_TEAM;
    const showNames = getShowNames();

    // Smoke clouds, as of the render time (they appear when the grenade's
    // blast is drawn). Hiding players in them is decided here, on the
    // client only: the server sends every position to everyone. That is
    // accepted (a game between friends, no anti-cheat), so this is not
    // secure, and isn't meant to be. What smoke hides from an enemy, and
    // only from an enemy (never from themselves, a teammate, or a
    // spectator, who sees them faded): their model, name plate and health
    // bar, minimap dot, muzzle flash, and their bullets while in or behind
    // the cloud (the tracer shows once it comes out). Their shots and steps
    // are still heard, and the kill feed still names them.
    const renderTick = buffer.sampleTick(renderTime);
    const clouds: SmokeCloud[] = [];
    buffer.sampleSmokes(renderTime)?.forEach((c, id) => {
      if (c.start <= renderTick && renderTick < c.end) clouds.push({ id, x: c.x, z: c.z, start: c.start, end: c.end, owner: c.owner, team: c.team });
    });
    scene.syncSmokes(clouds, renderTick);
    const viewerTeam = meServer ? myTeam : null;
    // The clouds our side threw (us, or our team) are see-through to us.
    const seenClouds = clouds.map((c) => ({ x: c.x, z: c.z, mine: ownsCloud(meServer ? sessionId : null, viewerTeam, c) }));

    latest?.players.forEach((p, id) => {
      if (id === sessionId) return;
      opponent = p;
      const s = buffer.samplePlayer(id, renderTime);
      if (!s) return;
      const m = this.meshFor(id, paintOf(s), s.skin);
      // A spectator has no viewpoint: only being inside a cloud counts (and it fades, never hides).
      const veil = clouds.length > 0 ? smokeVeil(viewerTeam, s.team, false, smokeCover(viewer ?? s, s, seenClouds)) : "none";
      m.set(s.x, s.z, s.aim, s.alive, s.weapon, veil);
      if (s.stunTicks > 0) m.stunned(now);
      const shield = s.shieldTicks > 0 ? s.shieldHp / SHIELD.absorb : 0;
      m.setShield(shield);
      // Their plate follows the interpolated body, and shows what it shows (hits land when drawn).
      const fade = veil === "hidden" ? 0 : veil === "faded" ? FADED_OPACITY : 1;
      scene.plates.set(id, s.x, s.z, s.name, paintOf(s), s.hp / MAX_HP, shield, s.alive, s.connected, showNames, fade);
      if (!s.alive) return;
      // Our predicted bullets stop on whoever they can hurt, and fly through
      // teammates, like the server's (canDamage).
      if (canDamage(myTeam, s.team, false)) drawn.push({ x: s.x, z: s.z });
      else allies.push({ x: s.x, z: s.z, slot: paintOf(s) });
    });
    this.opponentsDrawn = drawn;

    // Watching: the camera follows the spectator's pick (its drawn,
    // interpolated position) or frames the map, and the sounds are heard
    // from where it looks.
    const spectator = this.spectator;
    if (watching && latest && spectator) {
      this.spectatedLastFrame = true;
      spectator.frame(now, dt, this.drawnAt);
      setListener(spectator.listenerX, spectator.listenerZ);
    }
    const shots = this.remoteShots;
    for (let i = shots.length - 1; i >= 0; i--) {
      if (shots[i].at > now) continue;
      const m = this.meshes.get(shots[i].id);
      if (m) {
        m.shot(now);
        // Minimap: an enemy shows up only when they fire (teammates are always
        // on it), and not from inside or behind smoke: heard, not placed.
        const shooter = latest?.players.get(shots[i].id);
        if ((!shooter || !sameTeam(shooter.team, myTeam)) && m.veil !== "hidden")
          this.minimap.ping(m.group.position.x, m.group.position.z, m.slot, now, shots[i].id);
      }
      shots.splice(i, 1);
    }

    // Our own bullets are drawn from the prediction; the server's copies of
    // them are skipped (see LocalBullets). Everyone else's are interpolated.
    const bullets = new Map<string, { x: number; z: number; slot: number; owner?: string; weapon?: number; hidden?: boolean }>();
    for (const [id, b] of buffer.sampleBullets(renderTime)) {
      if (localBullets.owns(id)) continue;
      const owner = latest?.players.get(b.owner);
      // An enemy's bullet in or behind smoke isn't drawn (see above); a spectator sees them all.
      const hidden = !!viewer && clouds.length > 0 && !sameTeam(owner?.team ?? NO_TEAM, myTeam) && smokeCover(viewer, b, seenClouds) === "foreign";
      bullets.set(id, { x: b.x, z: b.z, slot: owner ? paintOf(owner) : 0, owner: b.owner, hidden });
    }
    if (meServer) localBullets.render(this.accumulator / TICK_MS, paintOf(meServer), bullets, sessionId);
    scene.syncBullets(bullets);
    scene.syncGrenades(buffer.sampleGrenades(renderTime), now);
    while (this.blasts.length > 0 && this.blasts[0].at <= now) {
      const b = this.blasts.shift()!;
      scene.blast(b.x, b.z, now, b.own, b.kind);
      this.sfx(grenadeView(b.kind).sfx, { x: b.x, z: b.z });
    }

    for (const m of this.meshes.values()) {
      m.update(now);
      if (m.dashing && m.veil !== "hidden") scene.addGhost(m.group.position.x, m.group.position.z, m.color, now);
    }

    // 4. HUD. Waiting and the match result have their own cards (Cards.tsx).
    // (`opponent` is assigned in a callback above, which TypeScript can't follow.)
    const ffa = latest?.mode === "ffa";
    const teams = latest?.mode === "tdm";
    // The big maps (FFA, teams, royale): no single opponent, a minimap.
    const big = ffa || teams || royale;
    const opp = big ? null : (opponent as PlayerView | null);
    let away: PlayerView | null = opp && !opp.connected ? opp : null;
    if (big) latest?.players.forEach((p, id) => (away ??= id !== sessionId && !p.connected ? p : null));
    let status = "";
    if (net.status === "disconnected") status = `Disconnected${net.error ? `: ${net.error}` : ""}.`;
    else if (away)
      status = big
        ? `${away.name || "A player"} lost their connection.`
        : `${away.name || "Your opponent"} lost their connection. Waiting for them to come back…`;
    else if (meServer && !meServer.alive && latest?.phase === "playing" && !royale)
      status = `Respawning in ${(meServer.respawnTicks / TICK_RATE).toFixed(1)}s (${WEAPON_KEYS}: weapon, G: grenade)`;

    const map = scene.map;
    let mapCard: HudModel["mapCard"] = null;
    if (map && (latest?.phase === "warmup" || latest?.phase === "playing") && this.mapCardLeft > 0) {
      mapCard = { title: map.name, sub: map.blurb, opacity: Math.min(1, this.mapCardLeft / MAP_CARD_FADE_MS) };
      this.mapCardLeft -= Math.min(dtMs, 100);
    }

    const debugParts = [`pending inputs ${predictor.pendingCount}`, `correction ${predictor.lastError.toFixed(3)} m`];
    if (net.lagMs > 0) debugParts.unshift(`lag +${net.lagMs} ms`);
    if (draw && big && meServer) {
      const pos = predictor.sim ?? meServer;
      this.minimap.draw(now, { x: pos.x, z: pos.z, aim: this.aim, slot: paintOf(meServer), alive: meServer.alive }, allies, clouds);
    }

    // The flash's white screen, from the synced end tick: how far we are
    // through it right now (the latest snapshot's tick, plus the time since
    // it came in).
    let flash = 0;
    if (meServer && latest && meServer.flashTicks > 0) {
      const tickNow = latest.tick + (now - latest.t) / TICK_MS;
      const left = (meServer.flashEnd - tickNow) / meServer.flashTicks;
      if (left > 0) flash = Math.min(1, left * FLASH_HOLD);
    }

    if (!draw) return;
    this.hud.update({
      status,
      me: meServer,
      opponent: opp,
      ffa: ffa && latest ? this.ffaHud(latest) : null,
      team: teams && latest ? this.teamHud(latest, meServer) : null,
      royale: royale && latest ? this.royaleHud(latest, meServer, tickNow) : null,
      feed: latest ? this.feedLines(latest, now) : [],
      sim: predictor.sim,
      canPick: !!latest && canPick(meServer, latest.phase, latest.mode),
      warmup: latest?.phase === "warmup" ? warmupLeft(latest) : null,
      mapCard,
      debug: debugParts.join("  |  "),
      muted: isMuted(),
      spectators: latest?.spectators ?? 0,
      flash,
    });
  }

  /** Rank, top 3 and clock for the FFA HUD. */
  private ffaHud(s: Snapshot): FfaHud {
    const you = this.net.sessionId;
    const all: (PlayerView & { id: string })[] = [];
    s.players.forEach((p, id) => all.push({ ...p, id }));
    all.sort((a, b) => a.slot - b.slot);
    const placed = byPlace(all, s.phase === "ended", s.mode === "royale");
    const mine = placed.find((p) => p.player.id === you);
    const left = secondsLeft(s);
    const running = s.phase === "playing";
    return {
      rank: mine?.place ?? 0,
      rankLabel: mine ? ordinal(mine.place) : "",
      players: all.length,
      kills: mine?.player.kills ?? 0,
      killsToWin: s.killsToWin,
      top: placed.slice(0, 3).map(({ player: p }) => ({ id: p.id, name: p.name, slot: p.slot, kills: p.kills, you: p.id === you })),
      timeLeft: running && left !== null && !s.suddenDeath ? clock(Math.ceil(left)) : "",
      lowTime: running && left !== null && left <= 30,
      suddenDeath: s.suddenDeath,
    };
  }

  /**
   * The battle royale's HUD: who is still in, the zone (time to its next
   * step, and the way back when we are outside), our three gun slots and
   * the grenade stack. The slots and the magazines are the predicted ones,
   * so a switch shows at once.
   */
  private royaleHud(s: Snapshot, me: PlayerView | null, tickNow: number): RoyaleHud {
    let alive = 0;
    s.players.forEach((p) => (alive += p.alive ? 1 : 0));
    const zone = s.zone;
    const running = s.phase === "playing" && zone.end > 0;
    const stage: RoyaleHud["zone"] = !running ? "none" : tickNow < zone.start ? "waiting" : tickNow < zone.end ? "shrinking" : "closed";
    const next = stage === "waiting" ? zone.start : zone.end;
    const zoneTime = stage === "waiting" || stage === "shrinking" ? clock(Math.ceil((next - tickNow) / TICK_RATE)) : "";
    const sim = this.predictor.sim ?? me;
    const pos = sim ?? { x: 0, z: 0 };
    const outside = running && !!me?.alive && outsideZone(zone, tickNow, pos.x, pos.z);
    const c = running ? zoneAt(zone, tickNow) : null;
    const arrow = outside && c ? this.scene.screenAngle(pos.x, pos.z, c.x, c.z) : 0;
    const slots: RoyaleHud["slots"] = [];
    for (let i = 0; i < ROYALE.gunSlots; i++) {
      const w = sim ? gunAt(sim.kit, i) : NO_GUN;
      const def = w === NO_GUN ? null : weaponDef(w);
      slots.push({
        weapon: w === NO_GUN ? -1 : w,
        name: def?.name ?? "",
        ammo: sim && def ? magAt(sim, i) : 0,
        magazine: def?.magazine ?? 0,
        hand: !!sim && sim.kit.hand === i,
        reloading: !!sim && sim.kit.hand === i && sim.reloadTicks > 0,
      });
    }
    return {
      alive,
      players: s.players.size,
      zone: stage,
      zoneTime,
      shrink: running ? zoneProgress(zone, tickNow) : 0,
      outside,
      arrow,
      slots,
      grenades: sim?.kit.grenades ?? 0,
    };
  }

  /** Team score, clock and our team for the team deathmatch HUD. */
  private teamHud(s: Snapshot, me: PlayerView | null): TeamHud {
    const left = secondsLeft(s);
    const running = s.phase === "playing";
    return {
      you: me?.team ?? NO_TEAM,
      red: s.redScore,
      blue: s.blueScore,
      killsToWin: s.killsToWin,
      timeLeft: running && left !== null && !s.suddenDeath ? clock(Math.ceil(left)) : "",
      lowTime: running && left !== null && left <= 30,
      suddenDeath: s.suddenDeath,
    };
  }

  /** The kill feed: the synced last few deaths, each shown for KILL_FEED_MS from when we first saw it. */
  private feedLines(s: Snapshot, now: number): KillFeedLine[] {
    const you = this.net.sessionId;
    const out: KillFeedLine[] = [];
    for (const k of s.feed) {
      let seen = this.feedSeen.get(k.n);
      if (seen === undefined) {
        seen = now;
        this.feedSeen.set(k.n, now);
      }
      const age = now - seen;
      if (age >= KILL_FEED_MS) continue;
      out.push({
        n: k.n,
        killer: k.killer ? k.killerName : "",
        killerSlot: paintFor(k.killerSlot, k.killerTeam),
        victim: k.victimName,
        victimSlot: paintFor(k.victimSlot, k.victimTeam),
        weapon: k.weapon === KILL_GRENADE ? "Grenade" : k.weapon === KILL_ZONE ? "Zone" : (WEAPONS[k.weapon]?.name ?? ""),
        byYou: !!k.killer && k.killer === you,
        onYou: k.victim === you,
        opacity: Math.min(1, (KILL_FEED_MS - age) / KILL_FEED_FADE_MS),
      });
    }
    if (this.feedSeen.size > 32) for (const n of this.feedSeen.keys()) if (!s.feed.some((k) => k.n === n)) this.feedSeen.delete(n);
    return out;
  }

  /** Removes everything this game put in the scene and stops reacting to the network. Leave the room with `net.leave()`. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.net.onSnapshot = () => {};
    this.onDispose();
    for (const id of this.meshes.keys()) this.dropMesh(id);
    this.scene.clearProjectiles();
    this.minimap.setMap(null);
    this.buffer.clear();
    this.blasts.length = 0;
    this.remoteShots.length = 0;
  }
}

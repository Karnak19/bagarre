// The non-React side of the client: the Three.js scene, the menu's attract
// loop, the Maps page's walk around (walk.ts), the match frames, the input,
// and the one requestAnimationFrame loop that drives them all. React (ui/)
// never runs per frame: the loop publishes what the views need into small
// stores (`view`, the HUD model, `loading`, `walkUi`), and each React widget
// subscribes to just the fields it shows.

import { findMap } from "@bagarre/shared";
import { App, type GameView, type Navigator } from "./app.ts";
import { Attract } from "./attract.ts";
import { activeVoiceCount, initAudio, initAudioOnFirstGesture, musicDebug, setMusic, type MusicMood } from "./audio.ts";
import { account } from "./auth.ts";
import { loadAssets } from "./assets.ts";
import type { BootConfig } from "./config.ts";
import { Hud } from "./hud.ts";
import { Input } from "./input.ts";
import { installAppKeys } from "./keys.ts";
import { Lobby } from "./lobby.ts";
import { Match, type Bot, type SfxLogEntry } from "./match.ts";
import { Minimap } from "./minimap.ts";
import { GameScene, setAssets } from "./scene.ts";
import { installSpectatorControls } from "./spectate/controls.ts";
import { devRenders } from "./renders.ts";
import { Store, type Readable } from "./store.ts";
import { ui, type PanelName } from "./uiState.ts";
import { Walk, type WalkMode, type WalkUi } from "./walk.ts";

export interface Engine {
  app: App;
  lobby: Lobby;
  hud: Hud;
  input: Input;
  /** The FFA minimap: the HUD mounts its canvas with `minimap.attach()`, the frame loop draws it. */
  minimap: Minimap;
  /** What the game's cards show, republished every frame in a game (null elsewhere). */
  view: Store<GameView | null>;
  /** Asset loading progress, 0..1, or null once loaded. */
  loading: Store<number | null>;
  /** Call from any button: sound may start from a user gesture (autoplay rules). */
  gesture: () => void;
  /**
   * Route lifecycle of `/maps/$id`: walk around this map (no server, no room),
   * or null to stop and give the menu its attract scene back.
   */
  walk: (mapId: string | null) => void;
  /** The walk's map and camera mode, for its top bar. */
  walkUi: Readable<WalkUi>;
  /** The walk bar's Overview / Free switcher. */
  setWalkMode: (mode: WalkMode) => void;
}

export function createEngine(config: BootConfig & { nav: Navigator }): Engine {
  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  const hud = new Hud();
  const minimap = new Minimap();
  const input = new Input(canvas);
  const bot: Bot = { on: false, mx: 0, mz: 0, aim: 0, fire: false, target: null };
  const sfxLog: SfxLogEntry[] = [];
  const lobby = new Lobby(config.serverUrl);
  const view = new Store<GameView | null>(null);
  const loading = new Store<number | null>(0);
  let scene: GameScene | null = null;
  let attract: Attract | null = null;
  let walker: Walk | null = null;
  /** The map `/maps/$id` wants walked on (null: none), kept until the scene exists. */
  let walkMapId: string | null = null;
  const walkUi = new Store<WalkUi>({ mapId: null, mode: "free" });

  // Assets load while the menu is already up; a join waits for them if needed.
  const ready = loadAssets((f) => loading.set(f)).then((a) => {
    setAssets(a);
    loading.set(null);
    scene = new GameScene(canvas, undefined, { lite: config.lite });
    attract = new Attract(scene);
    walker = new Walk(scene, canvas, walkUi);
    if (app.getState().screen !== "game") {
      if (walkMapId) startWalk(walkMapId);
      else attract.start(performance.now());
    }
    document.body.classList.add("scene-ready");
    return scene;
  });

  const app = new App(
    {
      ready,
      // Never under a walk: `/maps/$id` is on the menu screen too.
      enterMenu: () => {
        if (!walkMapId) attract?.start(performance.now());
      },
      createMatch: (net) => {
        attract?.stop();
        stopWalk();
        scene!.resetView();
        hud.clear();
        // Press counters start over with each game (the server takes a new
        // seat's first counters as its baseline anyway). A resumed seat
        // lifts them back to the server's in Match.resync.
        Object.assign(input.presses, { dash: 0, grenade: 0, shield: 0, reload: 0 });
        const match = new Match({ scene: scene!, input, hud, net, bot, sfxLog, minimap });
        // The spectator's own keys (Q / E, arrows, 1-3, WASD pan), drag and
        // wheel. Installed for every match, live only while watching; the
        // game's Input is off then (the frame loop), so no key of theirs can
        // make an InputMessage. Removed with the match.
        match.onDispose = installSpectatorControls({
          canvas,
          actions: match.spectateActions,
          enabled: () => match.spectating && !ui.getState().panel && !app.getState().paused,
        });
        return match;
      },
    },
    { serverUrl: config.serverUrl, lagMs: config.lagMs, mapParam: config.mapParam, nav: config.nav },
  );

  function startWalk(id: string) {
    const map = findMap(id);
    if (!map || !walker) return;
    attract?.stop();
    walker.start(map, performance.now());
  }
  function stopWalk() {
    walkMapId = null;
    walker?.stop();
  }
  const walk = (id: string | null) => {
    if (id && !findMap(id)) id = null;
    if (id) {
      walkMapId = id;
      startWalk(id);
      return;
    }
    if (!walkMapId && !walker?.running) return;
    stopWalk();
    if (app.getState().screen === "menu") attract?.start(performance.now());
  };

  // Sound can only start after a user gesture: every menu and card button
  // calls `gesture()`, and the first click or key press anywhere does too.
  initAudioOnFirstGesture();
  const gesture = () => void initAudio();

  installAppKeys({ app, input, view });

  // Signed in for the first time, with no username yet: bring the account
  // panel (and its username form) into view, once, if the menu is free.
  let askedForUsername = false;
  account.subscribe(() => {
    const s = account.state;
    if (s.status === "signedOut") askedForUsername = false;
    if (askedForUsername || s.status !== "signedIn" || !s.account || s.account.username) return;
    askedForUsername = true;
    if (app.getState().screen === "menu" && !ui.getState().panel) ui.patch({ panel: "account" });
  });

  // Back on the menu after a game: read the account again (the match may have counted).
  let lastScreen = app.getState().screen;
  app.subscribe(() => {
    const screen = app.getState().screen;
    if (screen === lastScreen) return;
    if (screen === "menu" && lastScreen !== "joining" && account.state.status !== "signedOut") void account.refresh();
    lastScreen = screen;
  });

  // --- The one frame loop (menu and game) --------------------------------------
  let lastFrame = performance.now();
  let frames = 0;
  // Dev `?fps=`: skip drawing (never the game's own update) between frames.
  const drawGap = config.maxFps > 0 ? 1000 / config.maxFps : 0;
  let lastDraw = -Infinity;

  // Music: the menu's track everywhere but a match being played (the menu,
  // its attract scene, the Maps page's walk, joining, and a game's waiting
  // card); a match track from its warmup on; silence from its end (the win or
  // lose sting) until the next one starts or we are back on the menu.
  const musicFor = (v: GameView | null): MusicMood =>
    v?.phase === "playing" || v?.phase === "warmup" ? "match" : v?.phase === "ended" ? "off" : "menu";

  function loop(now: number) {
    frames++;
    const dtMs = Math.min(now - lastFrame, 250);
    lastFrame = now;
    let v: GameView | null = null;
    if (scene) {
      const m = app.match;
      v = app.gameView();
      view.set(v);
      const draw = now - lastDraw >= drawGap - 1;
      if (m && v) {
        m.frame(now, dtMs, draw);
        // Never while watching: a spectator's keys are spectate/controls.ts'.
        input.enabled = v.card === "none" && !ui.getState().panel && !v.spectating;
      } else {
        input.enabled = false;
        if (walker?.running) walker.frame(now, dtMs);
        else attract?.frame(now);
      }
      if (draw) {
        lastDraw = now;
        scene.render(now);
      }
    }
    setMusic(musicFor(v));
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // --- Dev handle ----------------------------------------------------------------
  // For poking at the game from the console or a test script. The match's
  // parts are getters: they change with every game joined.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __bagarre: {
        app,
        lobby,
        input,
        sfxLog,
        bot,
        account,
        hud,
        minimap,
        ui,
        /** React renders per UI widget since load (see renders.ts). */
        renders: devRenders,
        accountUi: { forceUsernameForm: () => ui.patch({ forceUsernameForm: true, panel: "account" }) },
        panels: {
          get current() {
            return ui.getState().panel;
          },
          open: (name: PanelName) => ui.patch({ panel: name }),
          close: () => ui.patch({ panel: null }),
        },
        get scene() {
          return scene;
        },
        get match() {
          return app.match;
        },
        get net() {
          return app.match?.net ?? null;
        },
        get buffer() {
          return app.match?.buffer ?? null;
        },
        /** The music: mood, the track asked for and the one heard (see audio.ts' musicDebug). */
        get music() {
          return musicDebug();
        },
        /** Walk: jump the camera over (x, z) at game scale. */
        walkLookAt: (x: number, z: number) => walker?.lookAt(x, z),
        /** The walk around a map (`/maps/$id`), while on (null otherwise). */
        get walk() {
          const s = walkUi.getState();
          return walker?.running && s.mapId ? { mapId: s.mapId, mode: s.mode } : null;
        },
        /** The spectator view, while watching (null otherwise). */
        get spectator() {
          const m = app.match;
          const s = m?.spectating ? m.spectator : null;
          return s ? { followId: s.followId, mode: s.mode(), ui: s.ui.getState() } : null;
        },
        /** The name plates: per player, whether it shows, the name drawn, HP and shield fractions, dimmed (reconnecting). */
        get plates() {
          return scene?.plates.debug() ?? [];
        },
        /** The menu's attract scene: running, and whether both characters wear their loaded skins. */
        get attract() {
          return attract ? { running: attract.running, loaded: attract.loaded } : null;
        },
        /** The current (or watched) match's players: the skin each one's mesh wears, and whether its model has loaded. */
        skins(): Record<string, { skin: string; loaded: boolean }> {
          return app.match?.skins() ?? {};
        },
        /** How smoke has each player drawn for us right now: "none", "hidden" (an enemy in or behind smoke) or "faded" (a spectator's view). */
        veils(): Record<string, string> {
          return app.match?.veils() ?? {};
        },
        /** Every heal cue (green glow) this match has shown, oldest first: who, how much HP, when. */
        get heals(): { t: number; id: string; amount: number }[] {
          return app.match?.healLog ?? [];
        },
        /** The minimap's enemy dots right now, by shooter (session id). */
        get minimapPings(): string[] {
          return minimap.pingIds();
        },
        get predictor() {
          return app.match?.predictor ?? null;
        },
        get localBullets() {
          return app.match?.localBullets ?? null;
        },
        get view() {
          return view.getState();
        },
        /** The card on screen: the game's (see GameView.card), or joining / notice. */
        get card() {
          const s = app.getState();
          if (s.screen === "joining" || s.screen === "notice") return s.screen;
          const v = view.getState();
          if (s.screen !== "game" || !v) return "none";
          return v.card === "loading" ? "joining" : v.card;
        },
        get boardOpen() {
          return app.getState().scoreboardHeld && view.getState()?.card === "none";
        },
        /** Counts for the leak check: GPU resources, scene objects, sounds, frames drawn. */
        stats() {
          let objects = 0;
          scene?.scene.traverse(() => objects++);
          const info = scene?.renderer.info;
          return {
            geometries: info?.memory.geometries ?? 0,
            textures: info?.memory.textures ?? 0,
            programs: info?.programs?.length ?? 0,
            objects,
            voices: activeVoiceCount(),
            inRoom: !!app.match,
            frames,
          };
        },
      },
    });
  }

  const setWalkMode = (mode: WalkMode) => walker?.setMode(mode);

  return { app, lobby, hud, input, minimap, view, loading, gesture, walk, walkUi, setWalkMode };
}

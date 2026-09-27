// The non-React side of the client: the Three.js scene, the menu's attract
// loop, the match frames, the input, and the one requestAnimationFrame loop
// that drives them all. React (ui/) never runs per frame: the loop publishes
// what the views need into small stores (`view`, the HUD model, `loading`),
// and each React widget subscribes to just the fields it shows.

import { App, type GameView, type Navigator } from "./app.ts";
import { Attract } from "./attract.ts";
import { activeVoiceCount, initAudio, initAudioOnFirstGesture } from "./audio.ts";
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
import { devRenders } from "./renders.ts";
import { Store } from "./store.ts";
import { ui } from "./uiState.ts";

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
}

export function createEngine(config: BootConfig & { nav: Navigator }): Engine {
  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  const hud = new Hud();
  const minimap = new Minimap();
  const input = new Input(canvas);
  const bot: Bot = { on: false, mx: 0, mz: 0, aim: 0, fire: false };
  const sfxLog: SfxLogEntry[] = [];
  const lobby = new Lobby(config.serverUrl);
  const view = new Store<GameView | null>(null);
  const loading = new Store<number | null>(0);
  let scene: GameScene | null = null;
  let attract: Attract | null = null;

  // Assets load while the menu is already up; a join waits for them if needed.
  const ready = loadAssets((f) => loading.set(f)).then((a) => {
    setAssets(a);
    loading.set(null);
    scene = new GameScene(canvas);
    attract = new Attract(scene);
    if (app.getState().screen !== "game") attract.start(performance.now());
    document.body.classList.add("scene-ready");
    return scene;
  });

  const app = new App(
    {
      ready,
      enterMenu: () => attract?.start(performance.now()),
      createMatch: (net) => {
        attract?.stop();
        scene!.resetView();
        hud.clear();
        // Press counters start over with each game (the server takes a new
        // seat's first counters as its baseline anyway). A resumed seat
        // lifts them back to the server's in Match.resync.
        Object.assign(input.presses, { dash: 0, grenade: 0, shield: 0, reload: 0 });
        return new Match({ scene: scene!, input, hud, net, bot, sfxLog, minimap });
      },
    },
    { serverUrl: config.serverUrl, lagMs: config.lagMs, mapParam: config.mapParam, nav: config.nav },
  );

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
    if (askedForUsername || s.status !== "signedIn" || !s.profileLoaded || s.profile || s.backendError) return;
    askedForUsername = true;
    if (app.getState().screen === "menu" && !ui.getState().panel) ui.patch({ panel: "account" });
  });

  // --- The one frame loop (menu and game) --------------------------------------
  let lastFrame = performance.now();
  let frames = 0;

  function loop(now: number) {
    frames++;
    const dtMs = Math.min(now - lastFrame, 250);
    lastFrame = now;
    if (scene) {
      const m = app.match;
      const v = app.gameView();
      view.set(v);
      if (m && v) {
        m.frame(now, dtMs);
        input.enabled = v.card === "none" && !ui.getState().panel;
      } else {
        input.enabled = false;
        attract?.frame(now);
      }
      scene.render(now);
    }
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
          open: (name: "howto" | "settings" | "account") => ui.patch({ panel: name }),
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

  return { app, lobby, hud, input, minimap, view, loading, gesture };
}

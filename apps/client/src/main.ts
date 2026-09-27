// Wiring: the 3D side (scene, attract loop, match frames), the app flow
// (app.ts) and the DOM views (menu.ts, overlays.ts, the HUD). The flow and
// the lobby data are plain TS stores with getState / subscribe; the views
// only read them and call their actions.

import "./style.css";
import "./menu.css";
import { SERVER_PORT } from "@bagarre/shared";
import { AccountUi } from "./accountUi.ts";
import { App, type AppState, type GameView } from "./app.ts";
import { Attract } from "./attract.ts";
import { activeVoiceCount, initAudio, initAudioOnFirstGesture, isMuted, setMuted } from "./audio.ts";
import { account } from "./auth.ts";
import { loadAssets } from "./assets.ts";
import { Hud } from "./hud.ts";
import { Input } from "./input.ts";
import { Lobby } from "./lobby.ts";
import { Match, type Bot, type SfxLogEntry } from "./match.ts";
import { Menu } from "./menu.ts";
import { Overlays } from "./overlays.ts";
import { GameScene, setAssets } from "./scene.ts";
import { Panels } from "./ui.ts";

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
/** Dev-only `?play`: skip the menu and quick-match at once (test scripts, quick testing). */
const playNow = import.meta.env.DEV && params.has("play");

// --- The 3D side ---------------------------------------------------------------
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const hud = new Hud();
const input = new Input(canvas);
const bot: Bot = { on: false, mx: 0, mz: 0, aim: 0, fire: false };
const sfxLog: SfxLogEntry[] = [];
let scene: GameScene | null = null;
let attract: Attract | null = null;

const panels = new Panels();
const accountUi = new AccountUi();
const lobby = new Lobby(serverUrl);

// Assets load while the menu is already up; a join waits for them if needed.
let menuRef: Menu | null = null;
const ready = loadAssets((f) => menuRef?.setLoading(f)).then((a) => {
  setAssets(a);
  menuRef?.setLoading(null);
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
      return new Match({ scene: scene!, input, hud, net, bot, sfxLog });
    },
  },
  { serverUrl, lagMs, mapParam },
);

// Sound can only start after a user gesture: every menu and card button
// calls `gesture()`, and the first click or key press anywhere does too.
initAudioOnFirstGesture();
const gesture = () => void initAudio();

// --- Views -----------------------------------------------------------------------
const menu = new Menu(
  lobby,
  accountUi,
  {
    quickMatch: () => app.quickMatch(),
    privateGame: () => app.privateGame(),
    join: (roomId) => app.joinListed(roomId),
    gesture,
  },
  panels,
);
menuRef = menu;
menu.setLoading(0);
accountUi.onNeedsUsername = () => {
  if (app.getState().screen === "menu" && !panels.current) panels.open("account");
};

const overlays = new Overlays({
  leave: () => app.leave(),
  retry: () => app.retry(),
  resume: () => app.setPaused(false),
  settings: () => {
    gesture();
    panels.open("settings");
  },
  rematch: () => {
    gesture();
    app.rematch();
  },
  pick: (w) => {
    gesture();
    app.pick(w);
  },
});
panels.background = [menu.root, overlays.root];

let lastScreen: AppState["screen"] | null = null;
function renderFlow(s: AppState) {
  const onMenu = s.screen === "menu";
  if (onMenu && !menu.shown) menu.show(lastScreen !== null);
  else if (!onMenu && menu.shown) menu.hide();
  lobby.watch(onMenu);
  hud.visible = s.screen === "game";
  if (s.screen !== "game") {
    input.enabled = false;
    overlays.render(s, null);
  }
  // Closing the Esc menu closes the settings panel opened from it.
  if (s.screen === "game" && !s.paused && panels.current === "settings" && lastPaused) panels.close();
  lastPaused = s.paused;
  lastScreen = s.screen;
}
let lastPaused = false;
app.subscribe(renderFlow);

// --- Keys that belong to the app, not the game ---------------------------------

/** Clerk's sign-in modal or user menu is open: its keys are its own. */
const clerkOpen = () => !!document.querySelector(".cl-modalBackdrop, .cl-userButtonPopoverCard");
const isEditable = (e: Event) => {
  const t = e.composedPath()[0] ?? e.target;
  return t instanceof HTMLElement && (t.isContentEditable || t.matches("input, textarea, select"));
};

addEventListener("keydown", (e) => {
  const s = app.getState();
  if (e.code === "Escape") {
    if (clerkOpen()) return;
    if (panels.current) {
      panels.close();
      e.preventDefault();
    } else if (s.screen === "game" && !e.repeat) {
      app.togglePause();
      e.preventDefault();
    }
    return;
  }
  if (s.screen !== "game" || isEditable(e) || clerkOpen()) return;
  // Tab holds the scoreboard, but only while the game has the input (no card,
  // no panel): everywhere else Tab moves focus as usual.
  if (e.code === "Tab" && input.enabled) {
    e.preventDefault();
    app.holdScoreboard(true);
    return;
  }
  // With a card up the game's input is off; M and 1-4 still work on the
  // waiting and result cards (they have a weapon picker).
  if (input.enabled || panels.current || e.repeat) return;
  if (e.code === "KeyM") setMuted(!isMuted());
  else if (/^Digit[1-4]$/.test(e.code) && (overlays.card === "waiting" || overlays.card === "result"))
    app.pick(Number(e.code.slice(5)) - 1);
});
addEventListener("keyup", (e) => {
  if (e.code === "Tab") app.holdScoreboard(false);
});
// Alt-Tab away with Tab held: no keyup ever comes.
addEventListener("blur", () => app.holdScoreboard(false));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") app.holdScoreboard(false);
});

input.onMute = () => setMuted(!isMuted());
input.onPick = (w) => app.pick(w);

// --- The one frame loop (menu and game) ------------------------------------------

let lastFrame = performance.now();
let frames = 0;
let view: GameView | null = null;

function loop(now: number) {
  frames++;
  const dtMs = Math.min(now - lastFrame, 250);
  lastFrame = now;
  if (scene) {
    const m = app.match;
    view = app.gameView();
    if (m && view) {
      m.frame(now, dtMs);
      const s = app.getState();
      overlays.render(s, view);
      input.enabled = view.card === "none" && !panels.current && overlays.card === "none";
    } else {
      input.enabled = false;
      attract?.frame(now);
    }
    scene.render(now);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

app.start(playNow);
renderFlow(app.getState());

// --- Dev handle ------------------------------------------------------------------
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
      accountUi,
      panels,
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
        return view;
      },
      get card() {
        return overlays.card;
      },
      get boardOpen() {
        return overlays.boardOpen;
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

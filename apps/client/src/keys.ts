// Keys that belong to the app, not the game: Esc (match menu), Tab (hold the
// scoreboard), and M / 1-7 / G on the waiting and result cards. The game's own
// keys are input.ts'. Plain DOM listeners, outside React: they must see the
// state as it is when the key goes down, before any dialog reacts to it
// (hence the capture phase).
//
// Input isolation, all in one place:
// - the game's input (input.ts) is off whenever a card or a panel is up
//   (engine.ts' frame loop) and for the whole of a spectating session, and
//   ignores keys typed in text fields; a spectator's keys (Q / E, arrows,
//   1-3, WASD) are spectate/controls.ts', which reach no InputMessage;
// - here, nothing fires while a text field has focus, Esc is left to an
//   open panel (the dialog closes itself), and Tab
//   only holds the scoreboard while the game has the input, so Tab moves
//   focus as usual everywhere else.

import type { App, GameView } from "./app.ts";
import { isMuted, setMuted } from "./audio.ts";
import type { Input } from "./input.ts";
import type { Readable } from "./store.ts";
import { ui } from "./uiState.ts";

const isEditable = (e: Event) => {
  const t = e.composedPath()[0] ?? e.target;
  return t instanceof HTMLElement && (t.isContentEditable || t.matches("input, textarea, select"));
};

export function installAppKeys({ app, input, view }: { app: App; input: Input; view: Readable<GameView | null> }) {
  addEventListener(
    "keydown",
    (e) => {
      const s = app.getState();
      const panel = ui.getState().panel;
      if (e.code === "Escape") {
        // Our panels (native dialogs) close themselves on Esc.
        if (panel) return;
        if (s.screen === "game" && !e.repeat) {
          app.togglePause();
          e.preventDefault();
        }
        return;
      }
      if (s.screen !== "game" || isEditable(e)) return;
      // Tab holds the scoreboard, but only while the game has the input (no
      // card, no panel), or while watching with no card or panel up:
      // everywhere else Tab moves focus as usual.
      const v = view.getState();
      const watching = !!v?.spectating && v.card === "none" && !panel;
      if (e.code === "Tab" && (input.enabled || watching)) {
        e.preventDefault();
        app.holdScoreboard(true);
        return;
      }
      // With a card up the game's input is off; M, 1-7 and G still work on the
      // waiting and result cards (they have a weapon picker).
      if (input.enabled || panel || e.repeat) return;
      const card = v?.card;
      if (e.code === "KeyM") setMuted(!isMuted());
      else if (/^Digit[1-7]$/.test(e.code) && (card === "waiting" || card === "result")) app.pick(Number(e.code.slice(5)) - 1);
      else if (e.code === "KeyG" && (card === "waiting" || card === "result")) app.cycleGrenade();
    },
    { capture: true },
  );
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
  input.onGrenadeCycle = () => app.cycleGrenade();
}

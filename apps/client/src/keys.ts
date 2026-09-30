// Keys that belong to the app, not the game: Esc (match menu), Tab (hold the
// scoreboard), M / the weapon number keys / G on the waiting and result cards,
// and Enter for the battle royale host's Start (the game itself has no Enter). The game's own
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

import { ROYALE_MIN_PLAYERS } from "@bagarre/shared";
import type { App, GameView } from "./app.ts";
import { isMuted, setMuted } from "./audio.ts";
import type { Input } from "./input.ts";
import { weaponOfKey } from "./items.ts";
import type { Readable } from "./store.ts";
import { ui } from "./uiState.ts";

/** A control that answers Enter itself (a button, a link, a text field...): Enter is left to it. */
const isControl = (e: Event) => {
  const t = e.composedPath()[0] ?? e.target;
  return t instanceof HTMLElement && !!t.closest("button, a[href], input, textarea, select, [role=button], [contenteditable]");
};

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
      const watching = (!!v?.spectating || !!v?.knockedOut) && v.card === "none" && !panel;
      if (e.code === "Tab" && (input.enabled || watching)) {
        e.preventDefault();
        app.holdScoreboard(true);
        return;
      }
      // With a card up the game's input is off; M, the number keys and G still work on the
      // waiting and result cards (they have a weapon picker).
      if (input.enabled || panel || e.repeat) return;
      const card = v?.card;
      const weapon = weaponOfKey(e.code);
      // Battle royale host, waiting: Enter presses Start. The card's focus is on Start already
      // (Enter on it is the button's own); this covers the focus being nowhere, and leaves
      // any other focused control its own Enter.
      if ((e.code === "Enter" || e.code === "NumpadEnter") && card === "waiting" && !isControl(e)) {
        const snap = v?.snapshot;
        if (snap?.mode === "royale" && snap.host !== "" && snap.host === v?.you && snap.players.size >= ROYALE_MIN_PLAYERS) {
          e.preventDefault();
          app.startMatch();
        }
        return;
      }
      if (e.code === "KeyM") setMuted(!isMuted());
      else if (weapon !== null && (card === "waiting" || card === "result")) app.pick(weapon);
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

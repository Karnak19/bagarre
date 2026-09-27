// The bits of UI state the game loop and the app keys need to see, outside
// React: which panel (dialog) is open. The React panels (ui/Panels.tsx) own
// it and write it here; the frame loop reads it to keep the game's input off
// while a panel is up, and the key handler to leave Esc to the dialog.

import { Store } from "./store.ts";

export type PanelName = "howto" | "settings" | "account" | "leaderboard";

export interface UiState {
  panel: PanelName | null;
  /** Dev-only: the username form without an account, for the headless checks. */
  forceUsernameForm: boolean;
}

export const ui = new Store<UiState>({ panel: null, forceUsernameForm: false });

export function openPanel(panel: PanelName) {
  ui.patch({ panel });
}

export function closePanel() {
  if (ui.getState().panel) ui.patch({ panel: null });
}

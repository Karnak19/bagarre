// Display settings, remembered in localStorage like the audio ones (audio.ts).
// Read every frame for the name plates (match.ts), so a change in the
// Settings panel shows at once.

import { readBool, write } from "./audio.ts";

const SHOW_NAMES_KEY = "bagarre.ui.showNames";

let showNames = readBool(SHOW_NAMES_KEY, true);

/** Names over the other players' heads (the health bars always show). */
export function getShowNames() {
  return showNames;
}

export function setShowNames(on: boolean) {
  showNames = on;
  write(SHOW_NAMES_KEY, on ? "1" : "0");
}

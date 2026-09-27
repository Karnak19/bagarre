// Display settings, remembered in localStorage like the audio ones (audio.ts).
// Read every frame by the name plates (plates.ts), so a change in the
// Settings panel shows at once.

const SHOW_NAMES_KEY = "bagarre.ui.showNames";

function readBool(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

let showNames = readBool(SHOW_NAMES_KEY, true);

/** Names over the other players' heads (the health bars always show). */
export function getShowNames() {
  return showNames;
}

export function setShowNames(on: boolean) {
  showNames = on;
  try {
    localStorage.setItem(SHOW_NAMES_KEY, on ? "1" : "0");
  } catch {
    // Private mode or blocked storage: the setting just won't persist.
  }
}

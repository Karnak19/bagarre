// The root layout, around every page: the theme, the page itself (<Outlet>:
// the menu on `/`, the HUD on `/game/$code`), and what can sit over any page:
// the in-game cards (joining shows up on `/` too, during a quick match), the
// Tab scoreboard and the panels (dialogs).

import { Theme } from "@astryxdesign/core/theme";
import { Outlet } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { closePanel, ui } from "../uiState.ts";
import { Cards } from "./game/Cards.tsx";
import { TabScoreboard } from "./game/Scoreboard.tsx";
import { useEngine, useSelector } from "./hooks.ts";
import { Panels } from "./Panels.tsx";
import { bagarreTheme } from "./theme/bagarre.js";

export function Shell() {
  const { app } = useEngine();
  const screen = useSelector(app, (s) => s.screen);
  const paused = useSelector(app, (s) => s.paused);

  // A panel belongs to the screen it was opened on: going to another screen
  // closes it, and closing the Esc menu closes the settings opened from it.
  const last = useRef({ screen, paused });
  useEffect(() => {
    const was = last.current;
    last.current = { screen, paused };
    if (was.screen !== screen) closePanel();
    else if (was.paused && !paused && ui.getState().panel === "settings") closePanel();
  }, [screen, paused]);

  return (
    <Theme theme={bagarreTheme} mode="dark">
      <Outlet />
      <Cards />
      <TabScoreboard />
      <Panels />
    </Theme>
  );
}

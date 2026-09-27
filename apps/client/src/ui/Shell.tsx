// The root layout, around every page: the theme, the page itself (<Outlet>:
// the menu on `/`, the HUD on `/game/$code`), and what can sit over any page:
// the in-game cards (joining shows up on `/` too, during a quick match), the
// Tab scoreboard, the panels (dialogs), and the Clerk root when sign-in is
// configured.

import { Theme } from "@astryxdesign/core/theme";
import { Outlet } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useRef, type ReactNode } from "react";
import { PUBLISHABLE_KEY, account } from "../auth.ts";
import { closePanel, ui } from "../uiState.ts";
import { Cards } from "./game/Cards.tsx";
import { TabScoreboard } from "./game/Scoreboard.tsx";
import { useEngine, useSelector } from "./hooks.ts";
import { Panels } from "./Panels.tsx";
import { bagarreTheme } from "./theme/bagarre.js";

// Its own chunk, loaded only with a Clerk key: guests without keys never
// download Clerk (nor Convex's React client).
// If the chunk itself fails to load, the menu says sign-in couldn't load.
const ClerkRoot = PUBLISHABLE_KEY
  ? lazy<() => ReactNode>(() =>
      import("./account/ClerkRoot.tsx").catch((err: unknown) => {
        console.error("[auth] Clerk failed to load", err);
        account.patch({ status: "error" });
        return { default: () => null };
      }),
    )
  : null;

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
      {ClerkRoot && (
        <Suspense fallback={null}>
          <ClerkRoot />
        </Suspense>
      )}
    </Theme>
  );
}

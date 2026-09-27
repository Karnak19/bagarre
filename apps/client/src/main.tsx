// Entry. Boots the 3D side (engine.ts: scene, attract loop, match frames,
// the one requestAnimationFrame loop), then the React UI on TanStack Router.
// The flow and data live in plain TS stores (app.ts, lobby.ts, auth.ts,
// hud.ts); React only reads them through selectors and calls their actions.

import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./ui/theme/bagarre.css";
import "./ui/global.css";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bootConfig } from "./config.ts";
import { createEngine } from "./engine.ts";
import { createAppRouter, routerNavigator, type AppRouter } from "./router.tsx";
import { EngineContext } from "./ui/hooks.ts";

const config = bootConfig();
let router: AppRouter | null = null;
const engine = createEngine({ ...config, nav: routerNavigator(() => router!) });
router = createAppRouter(engine);

// Dev-only `?play`: skip the menu and quick-match at once (on a game page,
// the page's own route joins it). The param is dropped from the address bar.
const playNow = config.playNow;
if (playNow) {
  const onMenu = location.pathname === "/";
  void router
    .navigate({ to: ".", search: (s) => ({ ...s, play: undefined }), replace: true })
    .then(() => onMenu && engine.app.quickMatch(playNow));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EngineContext value={engine}>
      <RouterProvider router={router} />
    </EngineContext>
  </StrictMode>,
);

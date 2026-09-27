// TanStack Router, file-based (src/routes/, compiled to routeTree.gen.ts by
// the Vite plugin). Two pages: `/` is the menu, `/game/$code` is one game's
// page (the code is the Colyseus room id). The query string's dev switches
// (`?lag=`, `?map=`, `?server=`) ride along on every navigation, minus the
// one-shot dev `?play`.
//
// Production hosting needs an SPA rewrite: every path serves index.html.

import { createRouter } from "@tanstack/react-router";
import type { Navigator } from "./app.ts";
import type { Engine } from "./engine.ts";
import { routeTree } from "./routeTree.gen.ts";

export interface RouterContext {
  engine: Engine;
}

export function createAppRouter(engine: Engine) {
  return createRouter({
    routeTree,
    context: { engine },
    // The page never scrolls (the menu scrolls inside itself on phones).
    scrollRestoration: false,
    defaultPreload: false,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
  interface HistoryState {
    /** This entry was pushed from the menu, so "back to the menu" is `history.back()`. */
    fromMenu?: boolean;
  }
}

/** The flow's page moves (app.ts' Navigator) on a router that is created later. */
export function routerNavigator(get: () => AppRouter): Navigator {
  return {
    toGame(code) {
      void get().navigate({ to: "/game/$code", params: { code }, state: { fromMenu: true } });
    },
    toMenu() {
      const r = get();
      if (r.state.location.pathname === "/") return;
      if (r.state.location.state.fromMenu) r.history.back();
      else void r.navigate({ to: "/", replace: true });
    },
    onGamePage() {
      return get().state.location.pathname !== "/";
    },
    inviteUrl(code) {
      // Only `?server=` rides along (the friend must reach the same game
      // server); `?lag=` and `?map=` are the sender's own dev settings.
      const server = new URLSearchParams(location.search).get("server");
      const q = server ? `?${new URLSearchParams({ server })}` : "";
      return `${location.origin}/game/${encodeURIComponent(code)}${q}`;
    },
  };
}

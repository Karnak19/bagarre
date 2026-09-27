// Two pages, with the History API: `/` is the menu, `/game/<code>` is one
// game's page (the code is the Colyseus room id). The query string (`?lag=`,
// `?map=`, `?server=`) rides along on every navigation, minus the one-shot
// dev `?play`.
//
// Production hosting needs an SPA rewrite: every path serves index.html.

export type Route = { page: "menu" } | { page: "game"; code: string };

/** Room ids are Colyseus' 9-character ids; anything else can't be a game. */
const CODE = /^[A-Za-z0-9_-]{1,32}$/;

export function parseRoute(pathname = location.pathname): Route {
  const m = /^\/game\/([^/]+)\/?$/.exec(pathname);
  if (m) {
    let code = "";
    try {
      code = decodeURIComponent(m[1]);
    } catch {
      // A malformed escape: treat it like any unknown code.
    }
    return { page: "game", code: CODE.test(code) ? code : "" };
  }
  return { page: "menu" };
}

function search(): string {
  const q = new URLSearchParams(location.search);
  q.delete("play");
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function gamePath(code: string) {
  return `/game/${encodeURIComponent(code)}`;
}

/**
 * The shareable link to a game. Only `?server=` rides along (the friend must
 * reach the same game server); `?lag=` and `?map=` are the sender's own dev
 * settings.
 */
export function inviteUrl(code: string) {
  const server = new URLSearchParams(location.search).get("server");
  const q = server ? `?${new URLSearchParams({ server })}` : "";
  return `${location.origin}${gamePath(code)}${q}`;
}

interface HistoryState {
  /** This entry was pushed from the menu, so "back" returns there. */
  fromMenu?: boolean;
}

/** Goes to a game's page from the menu (a new history entry, so Back returns to the menu). */
export function pushGame(code: string) {
  const state: HistoryState = { fromMenu: true };
  history.pushState(state, "", gamePath(code) + search());
}

/**
 * Back to the menu. If this game page was reached from the menu, that is
 * `history.back()` (so Forward can return to the game); otherwise (a link
 * opened directly) the entry is replaced by `/`. Either way `onMenu` runs
 * once the URL is `/`.
 */
export function backToMenu() {
  if (parseRoute().page === "menu") return;
  if ((history.state as HistoryState | null)?.fromMenu) history.back();
  else {
    history.replaceState(null, "", `/${search()}`);
    dispatchEvent(new PopStateEvent("popstate", { state: null }));
  }
}

/** Drops `?play` from the address bar once it has been used. */
export function stripPlayParam() {
  if (!new URLSearchParams(location.search).has("play")) return;
  history.replaceState(history.state, "", location.pathname + search());
}

/** Calls `fn` with the new route on Back / Forward (and after `backToMenu`). Returns the unsubscribe. */
export function onRouteChange(fn: (r: Route) => void): () => void {
  const handler = () => fn(parseRoute());
  addEventListener("popstate", handler);
  return () => removeEventListener("popstate", handler);
}

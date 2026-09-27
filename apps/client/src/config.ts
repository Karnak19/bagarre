// The dev switches in the query string, typed once for both the router's
// validateSearch (routes/__root.tsx) and the boot config read before the
// router exists (main.tsx): `?play`, `?map=`, `?lag=`, `?server=`.

import { SERVER_PORT } from "@bagarre/shared";

export interface DevSearch {
  /** Dev-only: skip the menu and quick-match at once (test scripts, quick testing). One-shot, dropped after use. */
  play?: boolean;
  /** Ask for this map (dev servers only; the server ignores it in production). */
  map?: string;
  /** Extra round-trip latency in ms, split half each way. */
  lag?: number;
  /** Another game server, e.g. `http://host:2567`. */
  server?: string;
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : undefined);

/** Parses the raw query object (TanStack Router's, or URLSearchParams'). Unknown keys are dropped. */
export function validateDevSearch(raw: Record<string, unknown>): DevSearch {
  const out: DevSearch = {};
  // `?play` arrives as "" (URLSearchParams) or true / "" (the router's JSON-ish parser).
  if ("play" in raw && raw.play !== false && raw.play !== undefined) out.play = true;
  const map = str(raw.map);
  if (map) out.map = map;
  const lag = Number(raw.lag);
  if (Number.isFinite(lag) && lag > 0) out.lag = lag;
  const server = str(raw.server);
  if (server) out.server = server;
  return out;
}

export interface BootConfig {
  serverUrl: string;
  lagMs: number;
  mapParam: string | null;
  playNow: boolean;
}

/** Read once at boot: the lag, map and server hold for the whole visit (like before the router). */
export function bootConfig(search = location.search): BootConfig {
  const s = validateDevSearch(Object.fromEntries(new URLSearchParams(search)));
  /**
   * `VITE_SERVER_URL` may be a path such as `/colyseus`: in production the
   * client's own web server proxies it to the game server, on the same origin.
   */
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  const serverUrl =
    s.server ??
    (configured?.startsWith("/") ? new URL(configured, location.origin).href.replace(/\/$/, "") : configured) ??
    `${location.protocol}//${location.hostname}:${SERVER_PORT}`;
  return {
    serverUrl,
    lagMs: s.lag ?? 0,
    mapParam: s.map ?? null,
    playNow: import.meta.env.DEV && !!s.play,
  };
}

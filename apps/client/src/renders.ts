// Dev-only render counters, to check that the HUD and the cards don't
// re-render every frame: each counted component calls `countRender(name)` in
// its body, and `window.__bagarre.renders` shows the totals. Compiled out of
// production builds (the call is a no-op there).

export const devRenders: Record<string, number> = {};

export function countRender(name: string) {
  if (import.meta.env.DEV) devRenders[name] = (devRenders[name] ?? 0) + 1;
}

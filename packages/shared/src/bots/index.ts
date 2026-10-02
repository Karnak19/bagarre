// Server-side bots (#48), the pure part: what a bot sees (view.ts), how it
// picks a goal (brain.ts), how a goal becomes inputs every tick (control.ts),
// and the navigation under it (grid.ts, path.ts, flow.ts). Seeded and
// deterministic: same seed, same inputs. The tuning numbers are BOT_TUNING.
export * from "./tuning.ts";
export * from "./rng.ts";
export * from "./grid.ts";
export * from "./path.ts";
export * from "./flow.ts";
export * from "./view.ts";
export * from "./brain.ts";
export * from "./control.ts";

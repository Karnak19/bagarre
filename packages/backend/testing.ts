// The Convex functions as a module map for convex-test, which runs them
// in-process on a fake database (used by apps/server/smoke-accounts.ts).
// convex-test finds the functions root from the `_generated/` key, so the keys
// only need to be relative paths that all share one prefix.

import { readdirSync } from "node:fs";

export function convexModules(): Record<string, () => Promise<unknown>> {
  const root = new URL("./convex/", import.meta.url).pathname;
  const modules: Record<string, () => Promise<unknown>> = {};
  for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (!/\.(ts|js)$/.test(file) || file.endsWith(".d.ts")) continue;
    modules[`./convex/${file}`] = () => import(`${root}${file}`);
  }
  return modules;
}

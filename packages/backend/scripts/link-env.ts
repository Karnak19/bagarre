// Makes packages/backend/.env.local a symlink to the repo root's .env.local.
//
// The Convex CLI always reads, and on (re)configuration writes, `.env.local`
// in the directory it runs from (CONVEX_DEPLOYMENT, CONVEX_URL,
// CONVEX_SITE_URL). `--env-file` only changes where it reads the deployment
// from, not where it writes. The symlink sends both to the one root file the
// client and the game server also read, so there is never a second copy.
// Runs before every `convex` script of this package; it's a no-op once the link
// is there.

import { lstatSync, readlinkSync, symlinkSync } from "node:fs";

const link = new URL("../.env.local", import.meta.url).pathname;
const target = "../../.env.local";

let stat;
try {
  stat = lstatSync(link);
} catch {
  stat = null;
}

if (stat === null) {
  symlinkSync(target, link);
  console.log(`linked packages/backend/.env.local -> ${target}`);
} else if (!stat.isSymbolicLink()) {
  console.error(
    "packages/backend/.env.local is a real file. Move its keys into the root .env.local, " +
      "delete it, and run this again: the root file is the only one.",
  );
  process.exit(1);
} else if (readlinkSync(link) !== target) {
  console.error(`packages/backend/.env.local points to ${readlinkSync(link)}, expected ${target}.`);
  process.exit(1);
}

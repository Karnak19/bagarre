// Checks every map in shared/src/maps and prints a table of stats.
// Usage: bun scripts/maps/validate.ts [mapId...]    Exits 1 on any error.

import { MAPS } from "../../shared/src/maps/index.ts";
import { check } from "./analyze.ts";

/**
 * Known, accepted deviations, by map id: an error containing one of these
 * strings is reported as a warning instead. Only for the legacy layout.
 */
const ACCEPTED: Record<string, { match: string; why: string }[]> = {
  yard: [
    { match: "spawns 0 (-12,-12) and 2 (-12,12) see each other", why: "original layout: respawn corners share a side lane" },
    { match: "spawns 0 (-12,-12) and 3 (12,-12) see each other", why: "original layout: respawn corners share a side lane" },
    { match: "spawns 1 (12,12) and 2 (-12,12) see each other", why: "original layout: respawn corners share a side lane" },
    { match: "spawns 1 (12,12) and 3 (12,-12) see each other", why: "original layout: respawn corners share a side lane" },
  ],
};

const only = process.argv.slice(2);
const maps = only.length ? MAPS.filter((m) => only.includes(m.id)) : MAPS;
const ids = new Set<string>();
let failed = false;
const rows: string[][] = [];

for (const m of maps) {
  if (ids.has(m.id)) {
    console.log(`duplicate map id ${m.id}`);
    failed = true;
  }
  ids.add(m.id);
  const r = check(m);
  const accepted = ACCEPTED[m.id] ?? [];
  const errors: string[] = [];
  for (const e of r.errors) {
    const a = accepted.find((x) => e.includes(x.match));
    if (a) r.warnings.push(`${e} (accepted: ${a.why})`);
    else errors.push(e);
  }
  const s = r.stats;
  rows.push([
    m.id,
    s.size,
    String(s.obstacles),
    `${(s.density * 100).toFixed(1)}%`,
    `${s.longest.toFixed(1)} m`,
    `${(s.longShare * 100).toFixed(0)}%`,
    `${(s.openness * 100).toFixed(0)}%`,
    `${s.path.toFixed(1)} m`,
    `${s.meet.toFixed(2)} s`,
    `${s.sight.toFixed(2)} s @${s.sightDist.toFixed(0)} m`,
    `${(s.hidden * 100).toFixed(1)}%`,
    `${(s.spawnExposure * 100).toFixed(0)}%`,
    errors.length ? `FAIL (${errors.length})` : "ok",
  ]);
  if (errors.length || r.warnings.length) console.log(`\n${m.name} (${m.id})`);
  for (const e of errors) console.log(`  error: ${e}`);
  for (const w of r.warnings) console.log(w.startsWith("note: ") ? `  note:  ${w.slice(6)}` : `  warn:  ${w}`);
  if (errors.length) failed = true;
}

const head = ["map", "size m", "boxes", "cover", "longest LOS", "LOS>18m", "open", "spawn path", "contact", "first sight", "cam-hidden", "spawn exp", "result"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");
console.log(`\n${line(head)}\n${widths.map((w) => "-".repeat(w)).join("  ")}`);
for (const r of rows) console.log(line(r));
console.log(`
cover: share of the floor under boxes. LOS>18m: of the point pairs farther apart than rifle range, how many have a clear shot.
open: share of all point pairs with a clear shot. contact: both walk the shortest path from spawns 0/1 toward each other, time until
they meet. first sight: when they first get a clear shot on that walk, and at what distance. cam-hidden: floor where a chest (1 m)
is hidden from the iso camera. spawn exp: the most exposed spawn, share of the floor with a clear shot at it.`);
process.exit(failed ? 1 : 0);

// Checks every map in packages/shared/src/maps and prints a table of stats.
// Usage: bun run maps:validate [-- mapId...]   (or bun scripts/validate.ts from packages/shared)    Exits 1 on any error.

import { MAPS } from "../src/maps/index.ts";
import { check, MAX_MIRROR_SHARE, FAIR, fairValue, RESPAWN_SLACK, type PairFairness } from "./analyze.ts";

/** Side-by-side fairness of every spawn pair: both values, the gap, the allowed gap, and the gap as a share of it. */
function fairTable(fair: PairFairness[]): string {
  const head = ["pair", "metric", "side A", "side B", "gap", "allowed", "score"];
  const rows: string[][] = [];
  for (const p of fair)
    for (const x of p.metrics) {
      const d = FAIR[x.key];
      rows.push([
        `${2 * p.k}/${2 * p.k + 1}`,
        d.label,
        fairValue(d.unit, x.a),
        fairValue(d.unit, x.b),
        fairValue(d.unit, x.gap),
        fairValue(d.unit, x.tol),
        `${Math.round(x.score * 100)}%${x.score > 1 ? " FAIL" : ""}`,
      ]);
    }
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => "  " + r.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

const worstOf = (fair: PairFairness[]) =>
  fair.reduce((w, p) => (p.worst.score > w.score ? p.worst : w), fair[0]?.worst ?? { key: "exposure" as const, score: 0 }).key;

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
  const errors = r.errors;
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
    `${(s.mirror * 100).toFixed(0)}%`,
    `${Math.round(r.worstFair * 100)}% ${FAIR[worstOf(r.fair)].label}`,
    errors.length ? `FAIL (${errors.length})` : "ok",
  ]);
  console.log(`\n${m.name} (${m.id})`);
  console.log(fairTable(r.fair));
  for (const e of errors) console.log(`  error: ${e}`);
  for (const w of r.warnings) console.log(w.startsWith("note: ") ? `  note:  ${w.slice(6)}` : `  warn:  ${w}`);
  if (errors.length) failed = true;
}

const head = ["map", "size m", "boxes", "cover", "longest LOS", "LOS>18m", "open", "spawn path", "contact", "first sight", "cam-hidden", "spawn exp", "mirror", "worst gap", "result"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");
console.log(`\n${line(head)}\n${widths.map((w) => "-".repeat(w)).join("  ")}`);
for (const r of rows) console.log(line(r));
console.log(`
cover: share of the floor under boxes. LOS>18m: of the point pairs farther apart than rifle range, how many have a clear shot.
open: share of all point pairs with a clear shot. contact: both walk the shortest path from spawns 0/1 toward each other, time until
they meet. first sight: when they first get a clear shot on that walk, and at what distance. cam-hidden: floor where a chest (1 m)
is hidden from the iso camera. spawn exp: the most exposed spawn, share of the floor with a clear shot at it.
mirror: the most any one mirror (point, x/z axes, diagonals) maps the box footprint onto itself; over ${MAX_MIRROR_SHARE * 100} % the map reads as mirrored and fails.
worst gap: the fairness metric closest to failing, its side A / side B gap as a share of the allowed gap (over 100 % fails).

Fairness, per spawn pair (side A = spawn 2k, side B = spawn 2k + 1). Allowed gap = max(abs, rel x the larger value);
pairs after 0/1 are respawn spots, allowed ${RESPAWN_SLACK}x more:
${Object.values(FAIR)
  .map((d) => `  ${d.label.padEnd(24)} abs ${fairValue(d.unit, d.tol.abs).padEnd(7)} rel ${String(Math.round(d.tol.rel * 100)).padStart(2)}%  ${d.what}`)
  .join("\n")}`);
process.exit(failed ? 1 : 0);

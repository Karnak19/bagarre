// Checks every free-for-all map (src/maps/ffa) and prints a table per map.
// Usage (from packages/shared): bun scripts/ffa/validate.ts [mapId...]   Exits 1 on any error.

import { FFA_MAPS } from "../../src/maps/ffa/index.ts";
import {
  checkFfa,
  CONTACT_MEDIAN,
  CONTACT_P90,
  MAX_BOXES,
  MAX_CAMP,
  MAX_COVER_DIST,
  MAX_COVER_RATIO,
  MAX_EXPOSURE_RATIO,
  MAX_SPAWN_EXPOSURE,
  MAX_SPAWN_REACH,
  MIN_HIDDEN_RESPAWN,
  MIN_OPEN_SHARE,
  MIN_SPAWN_SPACING,
  MIN_TIGHT_SHARE,
  SHOT_RANGE,
} from "./analyze.ts";
import { checkTeams, MAX_HUB_GAP, MIN_ENEMY_SPAWN_DIST, MIN_TEAM_SPAWNS } from "./teams.ts";

const only = process.argv.slice(2);
const maps = only.length ? FFA_MAPS.filter((m) => only.includes(m.id)) : FFA_MAPS;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const ids = new Set<string>();
let failed = false;

const table = (head: string[], rows: string[][]) => {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
};

const summary: string[][] = [];
for (const m of maps) {
  if (ids.has(m.id)) {
    console.log(`duplicate map id ${m.id}`);
    failed = true;
  }
  ids.add(m.id);
  const t0 = performance.now();
  const r = checkFfa(m);
  const s = r.stats;
  const ok = !r.errors.length;
  if (!ok) failed = true;
  const ratio = s.expMax / Math.max(s.expMin, 0.02);
  const rows: [string, string, string][] = [
    ["size", `${s.size} m`, "50..64 m"],
    ["boxes", String(s.boxes), `<= ${MAX_BOXES}`],
    ["cover (floor under boxes)", pct(s.density), ""],
    ["spawns", String(m.spawns.length), ">= 16"],
    ["spawn spacing (min pair)", `${s.minSpawnGap.toFixed(1)} m`, `>= ${MIN_SPAWN_SPACING} m`],
    ["spawn reach (farthest floor)", `${s.spawnReach.toFixed(1)} m`, `<= ${MAX_SPAWN_REACH} m`],
    ["spawn exposure min..max", `${pct(s.expMin)} .. ${pct(s.expMax)}`, `max <= ${MAX_SPAWN_EXPOSURE * 100}%`],
    ["spawn exposure ratio", ratio.toFixed(2), `<= ${MAX_EXPOSURE_RATIO}`],
    ["nearest cover min..max", `${s.coverMin.toFixed(2)} .. ${s.coverMax.toFixed(2)} m`, `<= ${MAX_COVER_DIST} m, ratio <= ${MAX_COVER_RATIO}`],
    ["best camping spot", `${pct(s.camp)} @(${s.campAt.x.toFixed(1)},${s.campAt.z.toFixed(1)})`, `<= ${MAX_CAMP * 100}% of floor within ${SHOT_RANGE} m`],
    ["tight floor / open floor", `${pct(s.tight)} / ${pct(s.open)}`, `>= ${MIN_TIGHT_SHARE * 100}% / >= ${MIN_OPEN_SHARE * 100}%`],
    ["longest sightline", `${s.longest.toFixed(1)} m`, "report (warn > 45 m)"],
    ["LOS>18m / open pairs", `${pct(s.longShare)} / ${pct(s.openness)}`, "report"],
    ["first contact, 4 players p10/med/p90", `${s.c4[0].toFixed(2)} / ${s.c4[1].toFixed(2)} / ${s.c4[2].toFixed(2)} s`, `med ${CONTACT_MEDIAN.join("..")} s, p90 <= ${CONTACT_P90} s`],
    ["first contact median, 3 / 6 players", `${s.c3.toFixed(2)} / ${s.c6.toFixed(2)} s`, "report"],
    ["uniform 4-spawn draws with a pair in sight", pct(s.uniformInSight), "report (why starts use the rule)"],
    ["respawn hidden (5 opponents)", pct(s.hiddenRespawn), `>= ${MIN_HIDDEN_RESPAWN * 100}%`],
    ["respawn to nearest opponent, median", `${s.respawnDist.toFixed(1)} m`, "report"],
    ["cam-hidden floor", pct(s.hidden), "warn > 5%"],
  ];
  console.log(`\n=== ${m.name} (${m.id}) ${ok ? "ok" : `FAIL (${r.errors.length})`}  [${((performance.now() - t0) / 1000).toFixed(1)} s]`);
  console.log(table(["metric", "value", "rule"], rows));
  console.log(
    "\n" +
      table(
        ["spawn", "at", "zone", "exposure", "cover", "sees"],
        m.spawns.map((p, i) => [String(i), `(${p.x},${p.z})`, r.spawns[i].zone, pct(r.spawns[i].exposure), `${r.spawns[i].cover.toFixed(2)} m`, String(r.spawns[i].sees)]),
      ),
  );
  // Team deathmatch sides (red / blue), when the map has them.
  const team = checkTeams(m);
  if (team.errors.length) failed = true;
  if (team.stats) {
    const t = team.stats;
    const sides = m.teams!.map((sd) => sd.name).join(" / ");
    console.log(
      "\n" +
        table(
          ["team sides: " + sides, "value", "rule"],
          [
            ["spawns per side", t.counts.join(" / "), `>= ${MIN_TEAM_SPAWNS} each`],
            ["mean distance to the hub", t.hubMean.map((d) => `${d.toFixed(1)} m`).join(" / "), `gap <= ${MAX_HUB_GAP} m`],
            ["closest spawn to the hub", t.hubNearest.map((d) => `${d.toFixed(1)} m`).join(" / "), `gap <= ${MAX_HUB_GAP} m`],
            ["closest enemy spawn", `${t.enemyGap.toFixed(1)} m`, `>= ${MIN_ENEMY_SPAWN_DIST} m`],
            ["opposite spawn pairs in sight", String(t.pairsInSight), "report"],
          ],
        ),
    );
  }
  for (const e of team.errors) console.log(`  error: [teams] ${e}`);
  for (const e of r.errors) console.log(`  error: ${e}`);
  for (const w of r.warnings) console.log(`  warn:  ${w}`);
  const teamsOk = team.errors.length === 0;
  summary.push([m.id, s.size, String(s.boxes), pct(s.camp), ratio.toFixed(2), `${s.c4[1].toFixed(2)} / ${s.c4[2].toFixed(2)} s`, `${s.longest.toFixed(1)} m`, pct(s.hiddenRespawn), m.teams ? (teamsOk ? "ok" : "FAIL") : "none", ok && teamsOk ? "ok" : "FAIL"]);
}

console.log(`\n${table(["map", "size", "boxes", "camp", "exp ratio", "contact med/p90", "longest", "hidden resp", "teams", "result"], summary)}`);
console.log(`
exposure: share of the floor (1 m samples) with a clear shot at the spawn within ${SHOT_RANGE} m. camp: the most the best spot sees.
tight: floor that sees < 250 m² within 30 m; open: floor that sees >= 150 m² at 18..30 m (sniper only). first contact: players start on spawns picked by the FFA rule, all walk to the hub; first clear shot
between any two within 20 m (on screen, rifle range), 300 seeded starts. respawn hidden: 5 opponents on random floor, the FFA respawn rule
finds a spawn none of them sees. sees: other spawns in sight within ${SHOT_RANGE} m.`);
process.exit(failed ? 1 : 0);

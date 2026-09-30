// Renders every battle royale map to PNG: a top-down plan (districts, boxes
// by kind with their heights, start spots, crate spots, the final zone's
// rectangle, landmarks, and the endgame cover of each final circle centre)
// and an isometric view at the game's camera angle (ffa/preview.ts's).
// SVG first, then `sips` (macOS).
//
// Usage (from packages/shared): bun scripts/royale.preview.ts [outDir] [mapId...]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROYALE_MAPS, type RoyaleMapDef } from "../src/maps/royale/index.ts";
import { bodiesSee, circleHitsBox, R } from "./analyze.ts";
import { esc, hex, iso, KIND_COLOR, shade, toPng } from "./ffa/preview.ts";
import { FINAL_CIRCLE_RADIUS, tightOpen } from "./royale.check.ts";

/** Git-ignored folder at the repo root. */
const DEFAULT_OUT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..", ".previews", "royale-maps");

const cache = new Map<string, ReturnType<typeof tightOpen>>();
function to0(m: RoyaleMapDef) {
  if (!cache.has(m.id)) cache.set(m.id, tightOpen(m));
  return cache.get(m.id)!;
}

function topDown(m: RoyaleMapDef, S = 10): string {
  const pad = 30;
  const headH = 80;
  const W = 2 * m.halfX * S + 2 * pad + 220;
  const H = 2 * m.halfZ * S + 2 * pad + headH;
  const X = (x: number) => pad + (x + m.halfX) * S;
  const Z = (z: number) => headH + pad + (z + m.halfZ) * S;
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Helvetica, Arial">`);
  o.push(`<rect width="${W}" height="${H}" fill="#15171c"/>`);
  o.push(`<text x="${pad}" y="30" font-size="22" font-weight="bold" fill="#fff">${esc(m.name)}  <tspan font-size="14" fill="#aaa">(${m.id}, royale ${m.players.min}-${m.players.max}, favours ${m.favours.join(" / ")})</tspan></text>`);
  o.push(`<text x="${pad}" y="52" font-size="13" fill="#ccc">${esc(m.blurb)}</text>`);
  o.push(`<text x="${pad}" y="70" font-size="12" fill="#9ab">${2 * m.halfX}x${2 * m.halfZ} m, ${m.obstacles.length} boxes, ${m.spawns.length} starts, ${m.crates.length} crates, final circle r ${FINAL_CIRCLE_RADIUS} m (placeholder), tight floor ${(to0(m).tightShare * 100).toFixed(0)}%, open ${(to0(m).openShare * 100).toFixed(0)}%</text>`);
  o.push(`<rect x="${X(-m.halfX) - 8}" y="${Z(-m.halfZ) - 8}" width="${2 * m.halfX * S + 16}" height="${2 * m.halfZ * S + 16}" fill="${shade(hex(m.theme.wall === "brick" ? 0x9a5a45 : 0xa7a9a3), 0.8)}"/>`);
  o.push(`<rect x="${X(-m.halfX)}" y="${Z(-m.halfZ)}" width="${2 * m.halfX * S}" height="${2 * m.halfZ * S}" fill="${shade(hex(m.theme.floor), 0.45)}"/>`);
  for (const z of m.zones) o.push(`<rect x="${X(z.x0)}" y="${Z(z.z0)}" width="${(z.x1 - z.x0) * S}" height="${(z.z1 - z.z0) * S}" fill="${hex(z.tint)}" fill-opacity="0.14" stroke="${hex(z.tint)}" stroke-opacity="0.6" stroke-dasharray="6 4"/>`);
  for (let x = -m.halfX; x <= m.halfX + 1e-6; x += 5) o.push(`<line x1="${X(x)}" y1="${Z(-m.halfZ)}" x2="${X(x)}" y2="${Z(m.halfZ)}" stroke="#fff" stroke-opacity="${x === 0 ? 0.3 : 0.06}"/>`);
  for (let z = -m.halfZ; z <= m.halfZ + 1e-6; z += 5) o.push(`<line x1="${X(-m.halfX)}" y1="${Z(z)}" x2="${X(m.halfX)}" y2="${Z(z)}" stroke="#fff" stroke-opacity="${z === 0 ? 0.3 : 0.06}"/>`);
  // Tight floor (shotgun and SMG ground): hatched in violet.
  const to = to0(m);
  to.sl.pts.forEach((p, i) => {
    if (to.tight[i]) o.push(`<rect x="${X(p.x - 1)}" y="${Z(p.z - 1)}" width="${2 * S}" height="${2 * S}" fill="#b36bff" opacity="0.35"/>`);
  });
  // Endgame cover: each final circle centre, red where it has too few boxes.
  const f = m.finalZone;
  for (let cz = Math.ceil(f.z0); cz <= f.z1; cz++)
    for (let cx = Math.ceil(f.x0); cx <= f.x1; cx++) {
      let n = 0;
      for (const b of m.obstacles) if (circleHitsBox(cx, cz, FINAL_CIRCLE_RADIUS, b)) n++;
      const c = n < 2 ? "#ff3b1f" : n < 4 ? "#ffb13b" : "#5fd08a";
      o.push(`<rect x="${X(cx - 0.5)}" y="${Z(cz - 0.5)}" width="${S}" height="${S}" fill="${c}" opacity="${n < 2 ? 0.55 : 0.16}"/>`);
    }
  o.push(`<rect x="${X(f.x0)}" y="${Z(f.z0)}" width="${(f.x1 - f.x0) * S}" height="${(f.z1 - f.z0) * S}" fill="none" stroke="#7ad7ff" stroke-width="2.5" stroke-dasharray="10 5"/>`);
  o.push(`<text x="${X(f.x0) + 4}" y="${Z(f.z1) - 6}" font-size="12" font-weight="bold" fill="#7ad7ff">final zone centres</text>`);
  for (const z of m.zones) o.push(`<text x="${X(z.x0) + 4}" y="${Z(z.z0) + 13}" font-size="11" fill="${shade(hex(z.tint), 1.4)}" fill-opacity="0.9">${esc(z.name)}</text>`);
  // Boxes.
  for (const b of m.obstacles) {
    o.push(`<rect x="${X(b.x - b.w / 2)}" y="${Z(b.z - b.d / 2)}" width="${b.w * S}" height="${b.d * S}" fill="${KIND_COLOR[b.kind]}" stroke="#111" stroke-width="1"/>`);
    if (Math.min(b.w, b.d) >= 1.4) o.push(`<text x="${X(b.x)}" y="${Z(b.z) + 3.5}" font-size="9" text-anchor="middle" fill="#111">${b.h}</text>`);
  }
  // Starts that see each other (should be none).
  for (let i = 0; i < m.spawns.length; i++)
    for (let j = i + 1; j < m.spawns.length; j++)
      if (bodiesSee(m, m.spawns[i], m.spawns[j]))
        o.push(`<line x1="${X(m.spawns[i].x)}" y1="${Z(m.spawns[i].z)}" x2="${X(m.spawns[j].x)}" y2="${Z(m.spawns[j].z)}" stroke="#ff3b1f" stroke-width="2"/>`);
  // Landmarks.
  for (const l of m.landmarks) {
    o.push(`<path d="M ${X(l.x)} ${Z(l.z) - 7} L ${X(l.x) + 6} ${Z(l.z) + 5} L ${X(l.x) - 6} ${Z(l.z) + 5} Z" fill="#fff" stroke="#000"/>`);
    o.push(`<text x="${X(l.x) + 8}" y="${Z(l.z) - 6}" font-size="12" font-weight="bold" fill="#fff">${esc(l.name)}</text>`);
  }
  // Crates and starts.
  for (const c of m.crates) o.push(`<rect x="${X(c.x) - 5}" y="${Z(c.z) - 5}" width="10" height="10" fill="#ffd84a" stroke="#000" stroke-width="1.5" transform="rotate(45 ${X(c.x)} ${Z(c.z)})"/>`);
  m.spawns.forEach((p, i) => {
    o.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${R * S + 2}" fill="#ff8a3d" stroke="#fff" stroke-width="1.5"/>`);
    o.push(`<text x="${X(p.x)}" y="${Z(p.z) - R * S - 5}" font-size="11" font-weight="bold" text-anchor="middle" fill="#fff">${i}</text>`);
  });
  // Legend.
  const lx = X(m.halfX) + 24;
  let ly = Z(-m.halfZ) + 10;
  o.push(`<text x="${lx}" y="${ly}" font-size="13" font-weight="bold" fill="#fff">Legend</text>`);
  for (const [k, c] of Object.entries(KIND_COLOR)) {
    ly += 20;
    o.push(`<rect x="${lx}" y="${ly - 10}" width="12" height="12" fill="${c}"/><text x="${lx + 18}" y="${ly}" font-size="12" fill="#ccc">${k}</text>`);
  }
  ly += 26;
  o.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="6" fill="#ff8a3d" stroke="#fff"/><text x="${lx + 18}" y="${ly}" font-size="12" fill="#ccc">start spot (index)</text>`);
  ly += 22;
  o.push(`<rect x="${lx + 1}" y="${ly - 9}" width="10" height="10" fill="#ffd84a" stroke="#000" transform="rotate(45 ${lx + 6} ${ly - 4})"/><text x="${lx + 18}" y="${ly}" font-size="12" fill="#ccc">crate spot</text>`);
  const notes = [
    "blue dashes: where the final",
    "  zone's centre may land",
    `cells: boxes in a r ${FINAL_CIRCLE_RADIUS} m circle`,
    "  green 4+, orange 2-3, red < 2",
    "red line: starts in sight",
    "violet: tight floor (sees < 250 m²",
    "  within 30 m)",
    "numbers on boxes: height (m)",
    "triangles: landmarks",
    "north (-z) is up",
    "screen-up = top-left (-x,-z)",
  ];
  ly += 10;
  for (const n of notes) {
    ly += 17;
    o.push(`<text x="${lx}" y="${ly}" font-size="11" fill="#aaa">${esc(n)}</text>`);
  }
  o.push(`<line x1="${lx}" y1="${ly + 30}" x2="${lx + 10 * S}" y2="${ly + 30}" stroke="#fff" stroke-width="3"/><text x="${lx}" y="${ly + 46}" font-size="11" fill="#fff">10 m</text>`);
  o.push(`</svg>`);
  return o.join("\n");
}

const args = process.argv.slice(2);
const out = args[0] && !ROYALE_MAPS.some((m) => m.id === args[0]) ? args.shift()! : DEFAULT_OUT;
mkdirSync(out, { recursive: true });
const maps = args.length ? ROYALE_MAPS.filter((m) => args.includes(m.id)) : ROYALE_MAPS;
for (const m of maps) {
  for (const [suffix, svg] of [["top", topDown(m)], ["iso", iso(m, 9)]] as const) {
    const p = join(out, `${m.id}-${suffix}.svg`);
    writeFileSync(p, svg);
    console.log(toPng(p));
  }
}

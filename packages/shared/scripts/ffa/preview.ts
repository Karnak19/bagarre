// Renders every FFA map to PNG: a top-down plan (zones, obstacles by kind,
// spawns with their exposure, "sees" heat, longest sightlines, the walks to the
// hub, the best camping spot, landmarks), an isometric view at the game's
// camera angle, and a sheet with all the maps. SVG first, then `sips` (macOS).
//
// Usage (from packages/shared): bun scripts/ffa/preview.ts [outDir] [mapId...]

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FFA_MAPS, type FfaMapDef } from "../../src/maps/ffa/index.ts";
import { FLAT_DECOR, type ObstacleKind } from "../../src/maps/types.ts";
import { R } from "../analyze.ts";
import { checkFfa, MAX_CAMP, type FfaReport } from "./analyze.ts";

/** Git-ignored folder at the repo root. */
const DEFAULT_OUT = join(import.meta.dir, "../../../..", ".previews", "ffa-maps");
const args = process.argv.slice(2);
const out = args[0] && !FFA_MAPS.some((m) => m.id === args[0]) ? args.shift()! : DEFAULT_OUT;
const only = args;
mkdirSync(out, { recursive: true });

const KIND_COLOR: Record<ObstacleKind, string> = {
  crate: "#b9823f",
  barrier: "#a7a9a3",
  sandbags: "#cdb57a",
  container: "#4f7fb3",
  wall: "#a2503c",
  barrels: "#c8453a",
};
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

function shade(color: string, k: number): string {
  const n = parseInt(color.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function toPng(svgPath: string) {
  const png = svgPath.replace(/\.svg$/, ".png");
  execFileSync("sips", ["-s", "format", "png", svgPath, "--out", png], { stdio: "ignore" });
  return png;
}

/** Spawn colour from green (sheltered) to red (exposed), relative to the map's own range. */
function spawnColor(r: FfaReport, i: number): string {
  const lo = r.stats.expMin;
  const hi = Math.max(r.stats.expMax, lo + 1e-6);
  const k = (r.spawns[i].exposure - lo) / (hi - lo);
  const c = [Math.round(80 + 175 * k), Math.round(220 - 140 * k), 90];
  return `rgb(${c.join(",")})`;
}

// --- Top-down plan -------------------------------------------------------------

function topDown(m: FfaMapDef, r: FfaReport, S = 14): string {
  const pad = 30;
  const headH = 110;
  const W = 2 * m.halfX * S + 2 * pad + 220;
  const H = Math.max(2 * m.halfZ * S + 2 * pad + headH + 40, 700);
  const X = (x: number) => pad + (x + m.halfX) * S;
  const Z = (z: number) => headH + pad + (z + m.halfZ) * S;
  const o: string[] = [];
  const s = r.stats;
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Helvetica, Arial">`);
  o.push(`<rect width="${W}" height="${H}" fill="#15171c"/>`);
  o.push(`<text x="${pad}" y="30" font-size="22" font-weight="bold" fill="#fff">${esc(m.name)}  <tspan font-size="14" fill="#aaa">(${m.id}, FFA ${m.players.min}-${m.players.max}, favours ${m.favours.join(" / ")})</tspan></text>`);
  o.push(`<text x="${pad}" y="52" font-size="13" fill="#ccc">${esc(m.blurb)}</text>`);
  o.push(`<text x="${pad}" y="72" font-size="12" fill="#9ab">${s.size} m, ${s.boxes} boxes, cover ${(s.density * 100).toFixed(1)}%, longest LOS ${s.longest.toFixed(1)} m, best camp ${pct(s.camp)} (max ${pct(MAX_CAMP)}), tight ${pct(s.tight)} / open ${pct(s.open)}</text>`);
  o.push(`<text x="${pad}" y="88" font-size="12" fill="#9ab">spawns ${m.spawns.length}, exposure ${pct(s.expMin)}..${pct(s.expMax)}, cover ${s.coverMin.toFixed(1)}..${s.coverMax.toFixed(1)} m, first contact (4p) median ${s.c4[1].toFixed(1)} s, p90 ${s.c4[2].toFixed(1)} s, respawn hidden ${pct(s.hiddenRespawn)}</text>`);
  // Floor, zones, heat.
  o.push(`<rect x="${X(-m.halfX) - 8}" y="${Z(-m.halfZ) - 8}" width="${2 * m.halfX * S + 16}" height="${2 * m.halfZ * S + 16}" fill="${shade(hex(m.theme.floor), 0.55)}"/>`);
  o.push(`<rect x="${X(-m.halfX)}" y="${Z(-m.halfZ)}" width="${2 * m.halfX * S}" height="${2 * m.halfZ * S}" fill="${hex(m.theme.floor)}"/>`);
  for (const z of m.zones) o.push(`<rect x="${X(z.x0)}" y="${Z(z.z0)}" width="${(z.x1 - z.x0) * S}" height="${(z.z1 - z.z0) * S}" fill="${hex(z.tint)}" fill-opacity="0.16" stroke="${hex(z.tint)}" stroke-opacity="0.6" stroke-dasharray="6 4"/>`);
  r.sl.pts.forEach((p, i) => {
    const k = Math.min(1, r.sl.camp[i] / MAX_CAMP);
    o.push(`<rect x="${X(p.x - 0.5)}" y="${Z(p.z - 0.5)}" width="${S}" height="${S}" fill="#ff3b1f" opacity="${(k * k * 0.4).toFixed(3)}"/>`);
  });
  for (let x = -m.halfX; x <= m.halfX + 1e-6; x += 4) o.push(`<line x1="${X(x)}" y1="${Z(-m.halfZ)}" x2="${X(x)}" y2="${Z(m.halfZ)}" stroke="#fff" stroke-opacity="${x === 0 ? 0.3 : 0.06}"/>`);
  for (let z = -m.halfZ; z <= m.halfZ + 1e-6; z += 4) o.push(`<line x1="${X(-m.halfX)}" y1="${Z(z)}" x2="${X(m.halfX)}" y2="${Z(z)}" stroke="#fff" stroke-opacity="${z === 0 ? 0.3 : 0.06}"/>`);
  for (const z of m.zones) o.push(`<text x="${X(z.x0) + 4}" y="${Z(z.z0) + 13}" font-size="11" fill="${shade(hex(z.tint), 1.3)}" fill-opacity="0.9">${esc(z.name)}</text>`);
  // Decor.
  for (const d of m.decor) {
    const flat = (FLAT_DECOR as readonly string[]).includes(d.prop);
    if (flat) o.push(`<rect x="${X(d.x) - 0.6 * S}" y="${Z(d.z) - 0.4 * S}" width="${1.2 * S}" height="${0.8 * S}" fill="none" stroke="#e8e0c8" stroke-opacity="0.35" stroke-dasharray="2 2" transform="rotate(${((d.yaw * 180) / Math.PI).toFixed(0)} ${X(d.x)} ${Z(d.z)})"/>`);
    else o.push(`<circle cx="${X(d.x)}" cy="${Z(d.z)}" r="${0.35 * S}" fill="#777" stroke="#bbb"/>`);
  }
  // Walks to the hub.
  for (const p of r.contact.paths) o.push(`<polyline points="${p.map((q) => `${X(q.x)},${Z(q.z)}`).join(" ")}" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="1.2" stroke-dasharray="1 4" stroke-linecap="round"/>`);
  // Obstacles.
  for (const b of m.obstacles) {
    o.push(`<rect x="${X(b.x - b.w / 2)}" y="${Z(b.z - b.d / 2)}" width="${b.w * S}" height="${b.d * S}" fill="${KIND_COLOR[b.kind]}" stroke="#111" stroke-width="1"/>`);
    if (Math.min(b.w, b.d) >= 1.4) o.push(`<text x="${X(b.x)}" y="${Z(b.z) + 3.5}" font-size="9" text-anchor="middle" fill="#111">${b.h}</text>`);
  }
  // Longest sightlines.
  r.sl.longest.slice(0, 4).forEach((l, i) => {
    o.push(`<line x1="${X(l.a.x)}" y1="${Z(l.a.z)}" x2="${X(l.b.x)}" y2="${Z(l.b.z)}" stroke="#ffe14a" stroke-width="${i === 0 ? 2.5 : 1.5}" stroke-opacity="${i === 0 ? 0.95 : 0.6}" stroke-dasharray="8 4"/>`);
    o.push(`<text x="${(X(l.a.x) + X(l.b.x)) / 2 + 4}" y="${(Z(l.a.z) + Z(l.b.z)) / 2 - 4}" font-size="11" fill="#ffe14a">${l.len.toFixed(1)} m</text>`);
  });
  // Hub, best camping spot, landmarks.
  o.push(`<circle cx="${X(m.hub.x)}" cy="${Z(m.hub.z)}" r="${1.2 * S}" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="3 3"/>`);
  o.push(`<g transform="translate(${X(s.campAt.x)} ${Z(s.campAt.z)})"><line x1="-7" y1="-7" x2="7" y2="7" stroke="#ff3b1f" stroke-width="3"/><line x1="-7" y1="7" x2="7" y2="-7" stroke="#ff3b1f" stroke-width="3"/></g>`);
  o.push(`<text x="${X(s.campAt.x) + 9}" y="${Z(s.campAt.z) + 14}" font-size="11" font-weight="bold" fill="#ff7a5f">camp ${pct(s.camp)}</text>`);
  for (const l of m.landmarks) {
    o.push(`<path d="M ${X(l.x)} ${Z(l.z) - 7} L ${X(l.x) + 6} ${Z(l.z) + 5} L ${X(l.x) - 6} ${Z(l.z) + 5} Z" fill="#fff" stroke="#000"/>`);
    o.push(`<text x="${X(l.x) + 8}" y="${Z(l.z) - 6}" font-size="11" font-weight="bold" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${esc(l.name)}</text>`);
  }
  // Spawns.
  m.spawns.forEach((p, i) => {
    const c = spawnColor(r, i);
    o.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${R * S + 1}" fill="${c}" stroke="#fff" stroke-width="1.5"/>`);
    o.push(`<text x="${X(p.x)}" y="${Z(p.z) - R * S - 4}" font-size="10" font-weight="bold" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">${i} · ${pct(r.spawns[i].exposure)}</text>`);
  });
  // Side legend.
  const lx = X(m.halfX) + 24;
  let ly = Z(-m.halfZ) + 10;
  o.push(`<text x="${lx}" y="${ly}" font-size="13" font-weight="bold" fill="#fff">Legend</text>`);
  for (const [k, c] of Object.entries(KIND_COLOR)) {
    ly += 20;
    o.push(`<rect x="${lx}" y="${ly - 10}" width="12" height="12" fill="${c}"/><text x="${lx + 18}" y="${ly}" font-size="12" fill="#ccc">${k}</text>`);
  }
  const notes = [
    "numbers on boxes: height (m)",
    "red heat: floor seen within 30 m",
    `  (full red = ${pct(MAX_CAMP)}, the camp limit)`,
    "red X: best camping spot",
    "yellow: longest sightlines",
    "dots: each spawn's walk to the hub",
    "dashed ring: hub",
    "spawn label: index · exposure",
    "  green = sheltered, red = exposed",
    "triangles: landmarks",
    "screen-up = top-left (-x,-z)",
  ];
  ly += 16;
  for (const n of notes) {
    ly += 17;
    o.push(`<text x="${lx}" y="${ly}" font-size="11" fill="#aaa">${esc(n)}</text>`);
  }
  o.push(`<line x1="${lx}" y1="${ly + 30}" x2="${lx + 5 * S}" y2="${ly + 30}" stroke="#fff" stroke-width="3"/><text x="${lx}" y="${ly + 46}" font-size="11" fill="#fff">5 m (one dash)</text>`);
  o.push(`</svg>`);
  return o.join("\n");
}

// --- Isometric view -------------------------------------------------------------

interface Solid {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  h: number;
  color: string;
  label?: string;
}

function iso(m: FfaMapDef, S = 13): string {
  const P = (x: number, y: number, z: number): [number, number] => [((x - z) / Math.SQRT2) * S, ((x + z - 2 * y) / Math.sqrt(6)) * S];
  const T = m.theme;
  const th = 0.6;
  const wallH = 1.4;
  const wallColor = T.wall === "brick" ? "#9a5a45" : T.wall === "barrier" ? "#a7a9a3" : "#cdb57a";
  const ex = m.halfX + th;
  const ez = m.halfZ + th;
  const solids: Solid[] = [
    { minX: -ex, maxX: ex, minZ: -ez, maxZ: -m.halfZ, h: wallH, color: wallColor },
    { minX: -ex, maxX: -m.halfX, minZ: -m.halfZ, maxZ: ez, h: wallH, color: wallColor },
    { minX: -ex, maxX: ex, minZ: m.halfZ, maxZ: ez, h: wallH, color: wallColor },
    { minX: m.halfX, maxX: ex, minZ: -m.halfZ, maxZ: m.halfZ, h: wallH, color: wallColor },
  ];
  for (const b of m.obstacles) solids.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: b.h, color: KIND_COLOR[b.kind] });
  m.spawns.forEach((p, i) => solids.push({ minX: p.x - 0.35, maxX: p.x + 0.35, minZ: p.z - 0.35, maxZ: p.z + 0.35, h: 1.8, color: "#ff8a3d", label: String(i) }));

  // Painter's order: a solid is drawn before every solid it is behind.
  const behind = (a: Solid, b: Solid) => a !== b && (a.maxX <= b.minX + 1e-6 || a.maxZ <= b.minZ + 1e-6) && !(b.maxX <= a.minX + 1e-6 || b.maxZ <= a.minZ + 1e-6);
  const order: Solid[] = [];
  const left = new Set(solids);
  while (left.size) {
    let pick: Solid | undefined;
    for (const s of left)
      if (![...left].some((t) => behind(t, s))) {
        pick = s;
        break;
      }
    pick ??= [...left].sort((a, b) => a.minX + a.minZ - (b.minX + b.minZ))[0];
    order.push(pick);
    left.delete(pick);
  }

  const corners = [P(-ex, 0, -ez), P(ex, 0, -ez), P(ex, 0, ez), P(-ex, 0, ez), P(-ex, 3, -ez)];
  const minSX = Math.min(...corners.map((c) => c[0])) - 20;
  const maxSX = Math.max(...corners.map((c) => c[0])) + 20;
  const minSY = Math.min(...corners.map((c) => c[1])) - 50;
  const maxSY = Math.max(...corners.map((c) => c[1])) + 20;
  const W = maxSX - minSX;
  const H = maxSY - minSY;
  const pt = (x: number, y: number, z: number) => {
    const [a, b] = P(x, y, z);
    return `${(a - minSX).toFixed(1)},${(b - minSY).toFixed(1)}`;
  };
  const quad = (x0: number, z0: number, x1: number, z1: number) => `${pt(x0, 0, z0)} ${pt(x1, 0, z0)} ${pt(x1, 0, z1)} ${pt(x0, 0, z1)}`;
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" font-family="Helvetica, Arial">`);
  o.push(`<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="${hex(T.background)}"/>`);
  o.push(`<polygon points="${quad(-ex - 4, -ez - 4, ex + 4, ez + 4)}" fill="${hex(T.outerFloor)}"/>`);
  o.push(`<polygon points="${quad(-m.halfX, -m.halfZ, m.halfX, m.halfZ)}" fill="${hex(T.floor)}"/>`);
  for (const z of m.zones) o.push(`<polygon points="${quad(z.x0, z.z0, z.x1, z.z1)}" fill="${hex(z.tint)}" fill-opacity="0.13"/>`);
  for (let x = -m.halfX; x <= m.halfX + 1e-6; x += 2) {
    const [a, b] = [pt(x, 0, -m.halfZ).split(","), pt(x, 0, m.halfZ).split(",")];
    o.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${hex(T.grid)}" stroke-opacity="0.3"/>`);
  }
  for (let z = -m.halfZ; z <= m.halfZ + 1e-6; z += 2) {
    const [a, b] = [pt(-m.halfX, 0, z).split(","), pt(m.halfX, 0, z).split(",")];
    o.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${hex(T.grid)}" stroke-opacity="0.3"/>`);
  }
  for (const d of m.decor) {
    if (Math.abs(d.x) > m.halfX || Math.abs(d.z) > m.halfZ) continue;
    o.push(`<polygon points="${quad(d.x - 0.5, d.z - 0.4, d.x + 0.5, d.z + 0.4)}" fill="#e8e0c8" opacity="0.25"/>`);
  }
  for (const s of order) {
    const { minX: x0, maxX: x1, minZ: z0, maxZ: z1, h } = s;
    o.push(`<polygon points="${pt(x0, 0, z1)} ${pt(x1, 0, z1)} ${pt(x1, h, z1)} ${pt(x0, h, z1)}" fill="${shade(s.color, 0.72)}" stroke="#000" stroke-opacity="0.35"/>`);
    o.push(`<polygon points="${pt(x1, 0, z0)} ${pt(x1, 0, z1)} ${pt(x1, h, z1)} ${pt(x1, h, z0)}" fill="${shade(s.color, 0.55)}" stroke="#000" stroke-opacity="0.35"/>`);
    o.push(`<polygon points="${pt(x0, h, z0)} ${pt(x1, h, z0)} ${pt(x1, h, z1)} ${pt(x0, h, z1)}" fill="${shade(s.color, 1.08)}" stroke="#000" stroke-opacity="0.35"/>`);
    if (s.label) {
      const [a, b] = pt((x0 + x1) / 2, h + 0.4, (z0 + z1) / 2).split(",").map(Number);
      o.push(`<text x="${a}" y="${b}" font-size="10" font-weight="bold" text-anchor="middle" fill="#fff">${s.label}</text>`);
    }
  }
  for (const l of m.landmarks) {
    const [a, b] = pt(l.x, 3, l.z).split(",").map(Number);
    o.push(`<text x="${a}" y="${b}" font-size="12" font-weight="bold" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${esc(l.name)}</text>`);
  }
  o.push(`<text x="12" y="24" font-size="18" font-weight="bold" fill="#fff">${esc(m.name)}  <tspan font-size="12" fill="#bbb">iso preview (game camera angle; heights as drawn, players 1.8 m)</tspan></text>`);
  o.push(`</svg>`);
  return o.join("\n");
}

// --- Sheet ------------------------------------------------------------------------

function sheet(maps: readonly FfaMapDef[], reports: FfaReport[]): string {
  const cell = 480;
  const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${maps.length * cell}" height="${cell + 30}" font-family="Helvetica, Arial"><rect width="${maps.length * cell}" height="${cell + 30}" fill="#15171c"/>`];
  maps.forEach((m, i) => {
    const S = (cell - 40) / (2 * Math.max(m.halfX, m.halfZ));
    const ox = i * cell + 20 + (cell - 40 - 2 * m.halfX * S) / 2;
    const oz = 40 + (cell - 40 - 2 * m.halfZ * S) / 2;
    const X = (x: number) => ox + (x + m.halfX) * S;
    const Z = (z: number) => oz + (z + m.halfZ) * S;
    const s = reports[i].stats;
    o.push(`<text x="${i * cell + 14}" y="24" font-size="16" font-weight="bold" fill="#fff">${esc(m.name)} <tspan font-size="11" fill="#aaa">${s.size} m, ${s.boxes} boxes, contact ${s.c4[1].toFixed(1)} s, camp ${pct(s.camp)}</tspan></text>`);
    o.push(`<rect x="${X(-m.halfX)}" y="${Z(-m.halfZ)}" width="${2 * m.halfX * S}" height="${2 * m.halfZ * S}" fill="${hex(m.theme.floor)}"/>`);
    for (const z of m.zones) o.push(`<rect x="${X(z.x0)}" y="${Z(z.z0)}" width="${(z.x1 - z.x0) * S}" height="${(z.z1 - z.z0) * S}" fill="${hex(z.tint)}" fill-opacity="0.18"/>`);
    for (const b of m.obstacles) o.push(`<rect x="${X(b.x - b.w / 2)}" y="${Z(b.z - b.d / 2)}" width="${b.w * S}" height="${b.d * S}" fill="${KIND_COLOR[b.kind]}" stroke="#111" stroke-width="0.6"/>`);
    m.spawns.forEach((p) => o.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${Math.max(3, R * S)}" fill="#ff8a3d" stroke="#fff" stroke-width="0.8"/>`));
  });
  o.push(`</svg>`);
  return o.join("\n");
}

const maps = only.length ? FFA_MAPS.filter((m) => only.includes(m.id)) : FFA_MAPS;
const reports: FfaReport[] = [];
for (const m of maps) {
  const r = checkFfa(m);
  reports.push(r);
  for (const [suffix, svg] of [["top", topDown(m, r)], ["iso", iso(m)]] as const) {
    const p = join(out, `${m.id}-${suffix}.svg`);
    writeFileSync(p, svg);
    console.log(toPng(p));
  }
}
if (!only.length) {
  const p = join(out, `all-ffa-maps.svg`);
  writeFileSync(p, sheet(maps, reports));
  console.log(toPng(p));
}

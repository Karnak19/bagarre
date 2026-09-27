// Renders every map to PNG: a top-down plan (obstacles by kind, spawns, decor,
// exposure heat, longest sightlines, spawn path) and a projected isometric view
// matching the game camera. SVG is written first, then rasterised with `sips`.
//
// Usage: bun scripts/maps/preview.ts [outDir] [mapId...]

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAPS, type MapDef, type Obstacle, type ObstacleKind } from "../../shared/src/maps/index.ts";
import { FLAT_DECOR } from "../../shared/src/maps/types.ts";
import { check, R, type Report } from "./analyze.ts";

const DEFAULT_OUT = "/private/tmp/claude-501/-Users-basilevernouillet-work-perso-bagarre/241d3516-9eb3-43a0-a023-cb57b791d78d/scratchpad/maps";
const args = process.argv.slice(2);
const out = args[0] && !MAPS.some((m) => m.id === args[0]) ? args.shift()! : DEFAULT_OUT;
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
const SLOT_COLOR = ["#ff8a3d", "#3fa2ff"];
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

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

// --- Top-down plan -------------------------------------------------------------

function topDown(m: MapDef, r: Report, S = 20): string {
  const pad = 30;
  const headH = 100;
  const W = 2 * m.halfX * S + 2 * pad;
  const H = 2 * m.halfZ * S + 2 * pad + headH + 50;
  const X = (x: number) => pad + (x + m.halfX) * S;
  const Z = (z: number) => headH + pad + (z + m.halfZ) * S;
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Helvetica, Arial" >`);
  o.push(`<rect width="${W}" height="${H}" fill="#15171c"/>`);
  const s = r.stats;
  o.push(`<text x="${pad}" y="30" font-size="22" font-weight="bold" fill="#fff">${esc(m.name)}  <tspan font-size="14" fill="#aaa">(${m.id}, ${m.symmetry}, favours ${m.favours.join(" / ")})</tspan></text>`);
  o.push(`<text x="${pad}" y="52" font-size="13" fill="#ccc">${esc(m.blurb)}</text>`);
  o.push(`<text x="${pad}" y="72" font-size="12" fill="#9ab">${s.size} m, ${s.obstacles} boxes, cover ${(s.density * 100).toFixed(1)}%, longest LOS ${s.longest.toFixed(1)} m, LOS&gt;18m ${(s.longShare * 100).toFixed(0)}%, open ${(s.openness * 100).toFixed(0)}%</text>`);
  o.push(`<text x="${pad}" y="88" font-size="12" fill="#9ab">spawn path ${s.path.toFixed(1)} m, contact ${s.meet.toFixed(2)} s, first sight ${s.sight.toFixed(2)} s @${s.sightDist.toFixed(0)} m, cam-hidden ${(s.hidden * 100).toFixed(1)}%</text>`);
  // Floor + exposure heat.
  o.push(`<rect x="${X(-m.halfX) - 8}" y="${Z(-m.halfZ) - 8}" width="${2 * m.halfX * S + 16}" height="${2 * m.halfZ * S + 16}" fill="${shade(hex(m.theme.floor), 0.6)}"/>`);
  o.push(`<rect x="${X(-m.halfX)}" y="${Z(-m.halfZ)}" width="${2 * m.halfX * S}" height="${2 * m.halfZ * S}" fill="${hex(m.theme.floor)}"/>`);
  let maxE = 1;
  for (const e of r.sl.exposure) maxE = Math.max(maxE, e);
  r.sl.pts.forEach((p, i) => {
    const k = r.sl.exposure[i] / maxE;
    o.push(`<rect x="${X(p.x - 0.5)}" y="${Z(p.z - 0.5)}" width="${S}" height="${S}" fill="#ff3b1f" opacity="${(k * k * 0.32).toFixed(3)}"/>`);
  });
  for (let x = -m.halfX; x <= m.halfX + 1e-6; x += 2) o.push(`<line x1="${X(x)}" y1="${Z(-m.halfZ)}" x2="${X(x)}" y2="${Z(m.halfZ)}" stroke="#fff" stroke-opacity="${x === 0 ? 0.35 : 0.08}"/>`);
  for (let z = -m.halfZ; z <= m.halfZ + 1e-6; z += 2) o.push(`<line x1="${X(-m.halfX)}" y1="${Z(z)}" x2="${X(m.halfX)}" y2="${Z(z)}" stroke="#fff" stroke-opacity="${z === 0 ? 0.35 : 0.08}"/>`);
  // Decor.
  for (const d of m.decor) {
    const flat = (FLAT_DECOR as readonly string[]).includes(d.prop);
    const sc = d.scale ?? 1;
    if (flat) o.push(`<rect x="${X(d.x) - 0.6 * S * sc}" y="${Z(d.z) - 0.4 * S * sc}" width="${1.2 * S * sc}" height="${0.8 * S * sc}" fill="none" stroke="#e8e0c8" stroke-opacity="0.45" stroke-dasharray="2 2" transform="rotate(${((d.yaw * 180) / Math.PI).toFixed(0)} ${X(d.x)} ${Z(d.z)})"/>`);
    else o.push(`<circle cx="${X(d.x)}" cy="${Z(d.z)}" r="${0.35 * S}" fill="#777" stroke="#bbb"/>`);
  }
  // Obstacles.
  for (const b of m.obstacles) {
    o.push(`<rect x="${X(b.x - b.w / 2)}" y="${Z(b.z - b.d / 2)}" width="${b.w * S}" height="${b.d * S}" fill="${KIND_COLOR[b.kind]}" stroke="#111" stroke-width="1.2"/>`);
    if (Math.min(b.w, b.d) >= 0.9) o.push(`<text x="${X(b.x)}" y="${Z(b.z) + 4}" font-size="10" text-anchor="middle" fill="#111">${b.h}</text>`);
  }
  // Spawn path and sightlines.
  if (r.pathPts.length) o.push(`<polyline points="${r.pathPts.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ")}" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/>`);
  r.sl.longest.slice(0, 4).forEach((l, i) => {
    o.push(`<line x1="${X(l.a.x)}" y1="${Z(l.a.z)}" x2="${X(l.b.x)}" y2="${Z(l.b.z)}" stroke="#ffe14a" stroke-width="${i === 0 ? 2.5 : 1.5}" stroke-opacity="${i === 0 ? 0.95 : 0.6}" stroke-dasharray="8 4"/>`);
    o.push(`<text x="${(X(l.a.x) + X(l.b.x)) / 2 + 4}" y="${(Z(l.a.z) + Z(l.b.z)) / 2 - 4}" font-size="11" fill="#ffe14a">${l.len.toFixed(1)} m</text>`);
  });
  // Spawns.
  m.spawns.forEach((p, i) => {
    const c = SLOT_COLOR[i % 2];
    o.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${R * S}" fill="${c}" stroke="#fff" stroke-width="${i < 2 ? 3 : 1}"/>`);
    o.push(`<text x="${X(p.x)}" y="${Z(p.z) - R * S - 4}" font-size="12" font-weight="bold" text-anchor="middle" fill="${c}">S${i}</text>`);
  });
  // Legend.
  const ly = H - 30;
  let lx = pad;
  for (const [k, c] of Object.entries(KIND_COLOR)) {
    o.push(`<rect x="${lx}" y="${ly - 10}" width="12" height="12" fill="${c}"/><text x="${lx + 16}" y="${ly}" font-size="12" fill="#ccc">${k}</text>`);
    lx += 30 + k.length * 7;
  }
  o.push(`<text x="${pad}" y="${ly + 18}" font-size="12" fill="#ccc">red = exposure, yellow = longest sightlines, dots = spawn path; screen-up is the top-left corner (-x,-z); +x right, +z down</text>`);
  // 5 m scale bar.
  o.push(`<line x1="${W - pad - 5 * S}" y1="${headH + 12}" x2="${W - pad}" y2="${headH + 12}" stroke="#fff" stroke-width="3"/><text x="${W - pad - 2.5 * S}" y="${headH + 6}" font-size="11" text-anchor="middle" fill="#fff">5 m (one dash)</text>`);
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
  player?: string;
}

function iso(m: MapDef, S = 16): string {
  const P = (x: number, y: number, z: number): [number, number] => [((x - z) / Math.SQRT2) * S, ((x + z - 2 * y) / Math.sqrt(6)) * S];
  const T = m.theme;
  const th = 0.6;
  const wallH = 1.4;
  const wallColor = T.wall === "brick" ? "#9a5a45" : T.wall === "barrier" ? "#a7a9a3" : "#cdb57a";
  const solids: Solid[] = [];
  const ex = m.halfX + th;
  const ez = m.halfZ + th;
  solids.push({ minX: -ex, maxX: ex, minZ: -ez, maxZ: -m.halfZ, h: wallH, color: wallColor });
  solids.push({ minX: -ex, maxX: -m.halfX, minZ: -m.halfZ, maxZ: ez, h: wallH, color: wallColor });
  solids.push({ minX: -ex, maxX: ex, minZ: m.halfZ, maxZ: ez, h: wallH, color: wallColor });
  solids.push({ minX: m.halfX, maxX: ex, minZ: -m.halfZ, maxZ: m.halfZ, h: wallH, color: wallColor });
  for (const b of m.obstacles as Obstacle[])
    solids.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: b.h, color: KIND_COLOR[b.kind] });
  m.spawns.forEach((p, i) => solids.push({ minX: p.x - 0.35, maxX: p.x + 0.35, minZ: p.z - 0.35, maxZ: p.z + 0.35, h: 1.8, color: SLOT_COLOR[i % 2], player: `S${i}` }));

  // Painter's order: a solid is drawn before every solid it is behind.
  const behind = (a: Solid, b: Solid) => a !== b && (a.maxX <= b.minX + 1e-6 || a.maxZ <= b.minZ + 1e-6) && !(b.maxX <= a.minX + 1e-6 || b.maxZ <= a.minZ + 1e-6);
  const order: Solid[] = [];
  const left = new Set(solids);
  while (left.size) {
    let pick: Solid | undefined;
    for (const s of left) if (![...left].some((t) => behind(t, s))) { pick = s; break; }
    if (!pick) pick = [...left].sort((a, b) => a.minX + a.minZ - (b.minX + b.minZ))[0];
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
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" font-family="Helvetica, Arial">`);
  o.push(`<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="${hex(T.background)}"/>`);
  o.push(`<polygon points="${pt(-ex - 4, 0, -ez - 4)} ${pt(ex + 4, 0, -ez - 4)} ${pt(ex + 4, 0, ez + 4)} ${pt(-ex - 4, 0, ez + 4)}" fill="${hex(T.outerFloor)}"/>`);
  o.push(`<polygon points="${pt(-m.halfX, 0, -m.halfZ)} ${pt(m.halfX, 0, -m.halfZ)} ${pt(m.halfX, 0, m.halfZ)} ${pt(-m.halfX, 0, m.halfZ)}" fill="${hex(T.floor)}"/>`);
  for (let x = -m.halfX; x <= m.halfX + 1e-6; x += 2) o.push(`<line x1="${pt(x, 0, -m.halfZ).split(",")[0]}" y1="${pt(x, 0, -m.halfZ).split(",")[1]}" x2="${pt(x, 0, m.halfZ).split(",")[0]}" y2="${pt(x, 0, m.halfZ).split(",")[1]}" stroke="${hex(T.grid)}" stroke-opacity="0.35"/>`);
  for (let z = -m.halfZ; z <= m.halfZ + 1e-6; z += 2) o.push(`<line x1="${pt(-m.halfX, 0, z).split(",")[0]}" y1="${pt(-m.halfX, 0, z).split(",")[1]}" x2="${pt(m.halfX, 0, z).split(",")[0]}" y2="${pt(m.halfX, 0, z).split(",")[1]}" stroke="${hex(T.grid)}" stroke-opacity="0.35"/>`);
  for (const d of m.decor) {
    if (Math.abs(d.x) > m.halfX || Math.abs(d.z) > m.halfZ) continue;
    o.push(`<polygon points="${pt(d.x - 0.5, 0, d.z - 0.4)} ${pt(d.x + 0.5, 0, d.z - 0.4)} ${pt(d.x + 0.5, 0, d.z + 0.4)} ${pt(d.x - 0.5, 0, d.z + 0.4)}" fill="#e8e0c8" opacity="0.25"/>`);
  }
  for (const s of order) {
    const { minX: x0, maxX: x1, minZ: z0, maxZ: z1, h } = s;
    // Visible faces: +z (front-left), +x (front-right), top.
    o.push(`<polygon points="${pt(x0, 0, z1)} ${pt(x1, 0, z1)} ${pt(x1, h, z1)} ${pt(x0, h, z1)}" fill="${shade(s.color, 0.72)}" stroke="#000" stroke-opacity="0.35"/>`);
    o.push(`<polygon points="${pt(x1, 0, z0)} ${pt(x1, 0, z1)} ${pt(x1, h, z1)} ${pt(x1, h, z0)}" fill="${shade(s.color, 0.55)}" stroke="#000" stroke-opacity="0.35"/>`);
    o.push(`<polygon points="${pt(x0, h, z0)} ${pt(x1, h, z0)} ${pt(x1, h, z1)} ${pt(x0, h, z1)}" fill="${shade(s.color, 1.08)}" stroke="#000" stroke-opacity="0.35"/>`);
    if (s.player) {
      const [a, b] = pt((x0 + x1) / 2, h + 0.4, (z0 + z1) / 2).split(",").map(Number);
      o.push(`<text x="${a}" y="${b}" font-size="12" font-weight="bold" text-anchor="middle" fill="#fff">${s.player}</text>`);
    }
  }
  o.push(`<text x="12" y="24" font-size="18" font-weight="bold" fill="#fff">${esc(m.name)}  <tspan font-size="12" fill="#bbb">iso preview (game camera angle; heights as drawn, players 1.8 m)</tspan></text>`);
  o.push(`</svg>`);
  return o.join("\n");
}

// --- Contact sheet ----------------------------------------------------------------

function sheet(maps: MapDef[], reports: Report[]): string {
  const cell = 330;
  const cols = 4;
  const rows = Math.ceil(maps.length / cols);
  const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}" font-family="Helvetica, Arial"><rect width="${cols * cell}" height="${rows * cell}" fill="#15171c"/>`];
  maps.forEach((m, i) => {
    const S = (cell - 50) / (2 * Math.max(m.halfX, m.halfZ));
    const ox = (i % cols) * cell + 25 + (cell - 50 - 2 * m.halfX * S) / 2;
    const oz = Math.floor(i / cols) * cell + 35 + (cell - 50 - 2 * m.halfZ * S) / 2;
    const X = (x: number) => ox + (x + m.halfX) * S;
    const Z = (z: number) => oz + (z + m.halfZ) * S;
    o.push(`<text x="${(i % cols) * cell + 12}" y="${Math.floor(i / cols) * cell + 22}" font-size="15" font-weight="bold" fill="#fff">${esc(m.name)} <tspan font-size="11" fill="#aaa">${reports[i].stats.size} m, ${reports[i].stats.meet.toFixed(1)} s</tspan></text>`);
    o.push(`<rect x="${X(-m.halfX)}" y="${Z(-m.halfZ)}" width="${2 * m.halfX * S}" height="${2 * m.halfZ * S}" fill="${hex(m.theme.floor)}"/>`);
    for (const b of m.obstacles) o.push(`<rect x="${X(b.x - b.w / 2)}" y="${Z(b.z - b.d / 2)}" width="${b.w * S}" height="${b.d * S}" fill="${KIND_COLOR[b.kind]}" stroke="#111" stroke-width="0.6"/>`);
    m.spawns.forEach((p, j) => o.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${Math.max(3, R * S)}" fill="${SLOT_COLOR[j % 2]}" stroke="#fff" stroke-width="${j < 2 ? 1.5 : 0.5}"/>`));
  });
  o.push(`</svg>`);
  return o.join("\n");
}

const maps = only.length ? MAPS.filter((m) => only.includes(m.id)) : [...MAPS];
const reports: Report[] = [];
for (const m of maps) {
  const r = check(m);
  reports.push(r);
  for (const [suffix, svg] of [["top", topDown(m, r)], ["iso", iso(m)]] as const) {
    const p = join(out, `${m.id}-${suffix}.svg`);
    writeFileSync(p, svg);
    console.log(toPng(p));
  }
}
if (!only.length) {
  const p = join(out, `all-maps.svg`);
  writeFileSync(p, sheet(maps, reports));
  console.log(toPng(p));
}

// The link preview images (1200 × 630): public/og/og.png for the site, and
// public/og/maps/<id>.png for each map's page (seo/meta.ts points at them).
// Drawn by the game itself: this boots the client (Vite dev) in headless
// Chromium, hides the UI, frames the scene, lays the BAGARRE logo over it in
// the game's own font and colours, and takes a screenshot.
//
//   bun run og:render                  every image
//   bun run og:render -- site          only og.png
//   bun run og:render -- yard runway   only these maps
//
// Math.random is seeded, and the page runs with reduced motion (no camera
// orbit), so a run draws the same shots again. The PNGs are then shrunk to
// 256 colours with ImageMagick (`magick`, needed on the PATH) to stay well
// under 300 KB each.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { ALL_MAPS, IMAGE_HEIGHT, IMAGE_WIDTH, mapTagline } from "../../seo/meta.ts";

const CLIENT = join(import.meta.dir, "../..");
const OUT = join(CLIENT, "public/og");
const PORT = 5690;
const BASE = `http://localhost:${PORT}`;
/** Seed of the site shot: picks the attract scene's map and the two skins. */
const SITE_SEED = 7;
const MAX_BYTES = 300 * 1024;

// WebGL in headless Chromium: the real GPU through Metal on a Mac, SwiftShader (CPU) elsewhere.
const GL_ARGS =
  process.platform === "darwin"
    ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

const args = process.argv.slice(2);
const wantSite = args.length === 0 || args.includes("site");
const maps = ALL_MAPS.filter((m) => args.length === 0 || args.includes(m.id));
for (const a of args) if (a !== "site" && !ALL_MAPS.some((m) => m.id === a)) throw new Error(`unknown map: ${a}`);

if (spawnSync("magick", ["-version"]).status !== 0) {
  throw new Error("ImageMagick's `magick` is needed to compress the PNGs (brew install imagemagick / apt install imagemagick)");
}

// --- The client ------------------------------------------------------------------

const vite = spawn("bunx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: CLIENT, stdio: ["ignore", "ignore", "inherit"] });
const stopVite = () => vite.kill();
process.on("exit", stopVite);

async function waitForVite() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Vite didn't start on ${BASE}`);
}

/** A seeded Math.random (mulberry32), installed before the page's own scripts. */
function seedRandom(seed: number) {
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hides the game's UI (menu, walk bar) and the canvas fade-in: the scene alone. */
const HIDE_UI = `#root { display: none !important; } #game { transition: none !important; opacity: 1 !important; }`;

// oxlint-disable-next-line typescript/no-explicit-any
type Handle = any;

/**
 * The logo layer, over the scene: the BAGARRE wordmark as the menu draws it
 * (Black Ops One, sand with a burnt orange extrusion), a dark wash behind it
 * so it reads on any map, and an optional line under it.
 */
function overlay(opts: { title: string; sub: string; small: boolean }) {
  const layer = document.createElement("div");
  layer.id = "og";
  layer.innerHTML = `
    <style>
      #og { position: fixed; inset: 0; z-index: 99; pointer-events: none;
        background: linear-gradient(90deg, rgba(10,11,16,0.82) 0%, rgba(10,11,16,0.55) 34%, rgba(10,11,16,0) 60%),
                    linear-gradient(0deg, rgba(10,11,16,0.55) 0%, rgba(10,11,16,0) 30%); }
      #og .box { position: absolute; left: 64px; bottom: 64px; display: flex; flex-direction: column; gap: 14px; }
      #og .kicker { font: 400 30px/1 "Black Ops One", sans-serif; letter-spacing: 0.04em; color: #ffd98a;
        text-transform: uppercase; text-shadow: 0 1px 0 #e0853a, 0 2px 0 #bd5d1d, 0 3px 0 #8c3e0f, 0 8px 14px rgba(0,0,0,0.6); }
      #og h1 { margin: 0; font: 400 ${opts.small ? 104 : 148}px/0.9 "Black Ops One", sans-serif; letter-spacing: 0.01em;
        color: #ffd98a; text-transform: uppercase;
        text-shadow: 0 1px 0 #e0853a, 0 2px 0 #d0702a, 0 3px 0 #bd5d1d, 0 4px 0 #a64c14, 0 5px 0 #8c3e0f, 0 6px 0 #6e300b,
          0 7px 0 #6e300b, 0 8px 0 #5a270a, 0 22px 34px rgba(0,0,0,0.6); }
      #og p { margin: 6px 0 0; max-width: 30ch; font: 700 28px/1.25 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        color: #f2f2f2; text-shadow: 0 2px 8px rgba(0,0,0,0.8); }
    </style>
    <div class="box">
      ${opts.small ? `<div class="kicker">Bagarre</div>` : ""}
      <h1></h1>
      <p></p>
    </div>`;
  layer.querySelector("h1")!.textContent = opts.title;
  layer.querySelector("p")!.textContent = opts.sub;
  document.body.append(layer);
  return document.fonts.load('400 100px "Black Ops One"').then(() => document.fonts.ready);
}

/** A few frames drawn after the camera settled, so the screenshot is a finished frame. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((r) => {
      let n = 0;
      const tick = () => (++n >= 30 ? r() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );

async function shoot(page: Page, file: string) {
  mkdirSync(dirname(file), { recursive: true });
  const raw = `${file}.raw.png`;
  await page.screenshot({ path: raw, type: "png" });
  // 256 colours, dithered, max zlib: a 3D frame's ~1 MB down to ~150-250 KB.
  const r = spawnSync("magick", [raw, "-dither", "FloydSteinberg", "-colors", "256", "-strip", "-define", "png:compression-level=9", `PNG8:${file}`]);
  if (r.status !== 0) throw new Error(`magick failed: ${r.stderr}`);
  spawnSync("rm", [raw]);
  const size = statSync(file).size;
  console.log(`${file.replace(`${CLIENT}/`, "")}: ${Math.round(size / 1024)} KB`);
  if (size > MAX_BYTES) console.warn(`  over ${MAX_BYTES / 1024} KB`);
}

async function newPage(seed: number) {
  const page = await browser.newPage({ viewport: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.addInitScript(seedRandom, seed);
  await page.addInitScript((css) => {
    addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = css;
      document.head.append(s);
    });
  }, HIDE_UI);
  return page;
}

/** The site image: the menu's attract scene, two soldiers in a stand-off, the logo on the left. */
async function siteShot() {
  const page = await newPage(SITE_SEED);
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => (window as Handle).__bagarre?.attract?.loaded === true, null, { timeout: 60_000 });
  await page.evaluate(overlay, { title: "Bagarre", sub: "Duels, free for all, teams and battle royale. In your browser.", small: false });
  await settle(page);
  await shoot(page, join(OUT, "og.png"));
  await page.close();
}

/** A map's image: the walk around it (`/maps/<id>`), the whole map in view, its name under the logo. */
async function mapShot(id: string, name: string, sub: string) {
  const page = await newPage(1);
  await page.goto(`${BASE}/maps/${id}`);
  await page.waitForFunction((mapId) => (window as Handle).__bagarre?.walk?.mapId === mapId, id, { timeout: 60_000 });
  await page.evaluate(() => (window as Handle).__bagarre.walkLookAt(0, 0));
  await page.keyboard.press("2"); // Overview: the whole map.
  await page.evaluate(overlay, { title: name, sub, small: true });
  await settle(page);
  await shoot(page, join(OUT, "maps", `${id}.png`));
  await page.close();
}

await waitForVite();
const browser = await chromium.launch({ args: GL_ARGS });
try {
  if (wantSite) await siteShot();
  for (const m of maps) await mapShot(m.id, m.name, mapTagline(m));
} finally {
  await browser.close();
  stopVite();
}

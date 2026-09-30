// What a page says about itself to search engines and link previews
// (Discord, Slack, X, iMessage...): the <head> tags of every route, the
// robots.txt and the sitemap. All the text lives here.
//
// Link preview bots don't run JavaScript, so these tags have to be in the
// HTML the server sends. The Vite plugin next to this file (plugin.ts) puts
// them there: in dev and `vite preview` per request, and at build time as one
// HTML file per page (dist/maps/<id>.html, dist/game.html...), which the
// Caddyfile serves for those paths. Both go through `pageFor()` below, so dev,
// preview, e2e and production send the same tags.
//
// Pure: no file system, no DOM. Game codes never reach the output: every
// `/game/<code>` gets the same generic invite, so nothing from the URL is
// echoed into the page.

import {
  FFA_MAPS,
  FFA_MAX_PLAYERS,
  MAPS,
  RESET_PASSWORD_PAGE,
  ROYALE_MAPS,
  ROYALE_MAX_PLAYERS,
  TEAM_MAPS,
  TEAM_SIZE,
  findMap,
  type MapDef,
  type WeaponTag,
} from "@bagarre/shared";

/** The production site. Every absolute URL (canonical, og:url, og:image, sitemap) starts with it. */
export const SITE_ORIGIN = "https://bagarre.basilevernouillet.com";

export const SITE_NAME = "Bagarre";

/** The share image every page uses unless it has its own. `bun run og:render` makes them all. */
export const SITE_IMAGE = "/og/og.png";
/** One share image per map (a shot of that map). */
export const mapImage = (id: string) => `/og/maps/${id}.png`;
/** Size of every share image (the size Discord, Slack and X show large). */
export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 630;

export interface PageMeta {
  title: string;
  description: string;
  /**
   * Path of the page's own URL (canonical, og:url), from the site root. Null
   * for the game pages: their URL holds a game code, which is never echoed.
   */
  path: string | null;
  /** Path of the share image, from the site root. */
  image: string;
  imageAlt: string;
  /** Kept out of search results (game links, the password reset page). */
  noindex: boolean;
}

/** A page with its tags, and the HTML file the build writes it to (relative to dist). */
export interface Page {
  file: string;
  meta: PageMeta;
}

const WEAPON_LABELS: Record<WeaponTag, string> = { rifle: "rifle", shotgun: "shotgun", sniper: "sniper", smg: "SMG" };

const HOME_DESCRIPTION =
  `A fast top-down shooter you play in the browser, free and with nothing to install. ` +
  `1v1 duels, free for all up to ${FFA_MAX_PLAYERS} players, team deathmatch up to ${TEAM_SIZE}v${TEAM_SIZE} ` +
  `and battle royale for ${ROYALE_MAX_PLAYERS}. Keyboard and mouse.`;

const HOME: PageMeta = {
  title: "Bagarre: a free twin-stick shooter in your browser",
  description: HOME_DESCRIPTION,
  path: "/",
  image: SITE_IMAGE,
  imageAlt: "Two soldiers facing off in an isometric arena, under the Bagarre logo",
  noindex: false,
};

const MAPS_PAGE: PageMeta = {
  title: "Maps | Bagarre",
  description:
    `Every Bagarre map: ${MAPS.length} for 1v1 duels, ${FFA_MAPS.length} bigger ones for free for all and team deathmatch, ` +
    `and ${ROYALE_MAPS.length} for battle royale. Walk around any of them in your browser before you play.`,
  path: "/maps",
  image: SITE_IMAGE,
  imageAlt: HOME.imageAlt,
  noindex: false,
};

const INVITE: PageMeta = {
  title: "You've been invited to a Bagarre match",
  description:
    "Someone wants to play Bagarre with you. Open the link to join their match, right in your browser: " +
    "no download and no account needed. Keyboard and mouse.",
  path: null,
  image: SITE_IMAGE,
  imageAlt: HOME.imageAlt,
  noindex: true,
};

const WATCH: PageMeta = {
  title: "Watch a live Bagarre match",
  description: "A Bagarre match is being played right now. Open the link to watch it live in your browser, nothing to install.",
  path: null,
  image: SITE_IMAGE,
  imageAlt: HOME.imageAlt,
  noindex: true,
};

const RESET_PASSWORD: PageMeta = {
  title: "Reset your password | Bagarre",
  description: "Choose a new password for your Bagarre account.",
  path: RESET_PASSWORD_PAGE,
  image: SITE_IMAGE,
  imageAlt: HOME.imageAlt,
  noindex: true,
};

/** Every map, in the Maps page's order: duels, free for all, battle royale. */
export const ALL_MAPS: readonly MapDef[] = [...MAPS, ...FFA_MAPS, ...ROYALE_MAPS];

const list = (words: string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

/** What a map is played in, in words: "1v1 duels", "free for all (3 to 6 players) and team deathmatch"... */
function modesOf(map: MapDef): string {
  const royale = ROYALE_MAPS.find((m) => m.id === map.id);
  if (royale) return `battle royale (${royale.players.min} to ${royale.players.max} players)`;
  const ffa = FFA_MAPS.find((m) => m.id === map.id);
  if (ffa) {
    const modes = [`free for all (${ffa.players.min} to ${ffa.players.max} players)`];
    if (TEAM_MAPS.some((m) => m.id === map.id)) modes.push(`team deathmatch (up to ${TEAM_SIZE}v${TEAM_SIZE})`);
    return list(modes);
  }
  return "1v1 duels";
}

/** The kind of map, for the title: "a duel map", "a battle royale map". */
function kindOf(map: MapDef): string {
  if (ROYALE_MAPS.some((m) => m.id === map.id)) return "a battle royale map";
  if (FFA_MAPS.some((m) => m.id === map.id)) return "a free for all map";
  return "a duel map";
}

/** The line under a map's name on its share image: "Duel map · 30 × 30 m". */
export function mapTagline(map: MapDef): string {
  const kind = kindOf(map).replace(/^an? /, "");
  return `${kind[0].toUpperCase()}${kind.slice(1)} · ${map.halfX * 2} × ${map.halfZ * 2} m`;
}

/**
 * A map's page. `hasImage`: whether that map's own share image exists (it
 * falls back to the site's while a new map has none yet).
 */
export function mapMeta(map: MapDef, hasImage: (id: string) => boolean = () => true): PageMeta {
  const size = `${map.halfX * 2} × ${map.halfZ * 2} m`;
  const favours = map.favours.length ? ` Good for the ${list(map.favours.map((w) => WEAPON_LABELS[w]))}.` : "";
  const own = hasImage(map.id);
  return {
    title: `${map.name}, ${kindOf(map)} | Bagarre`,
    description: `${map.blurb} ${size}, for ${modesOf(map)}.${favours} Walk around it in your browser before you play.`,
    path: `/maps/${map.id}`,
    image: own ? mapImage(map.id) : SITE_IMAGE,
    imageAlt: own ? `The ${map.name} map in Bagarre, seen from above` : HOME.imageAlt,
    noindex: false,
  };
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/**
 * The page for a request path: its tags and the HTML file the build wrote
 * them to. Unknown paths get the home page's tags (the SPA sends them there,
 * or to its "this game doesn't exist" notice).
 */
export function pageFor(pathname: string, hasImage?: (id: string) => boolean): Page {
  const path = trimSlash(pathname.split(/[?#]/)[0] || "/");
  if (path === "/maps") return { file: "maps.html", meta: MAPS_PAGE };
  if (path === RESET_PASSWORD_PAGE) return { file: "reset-password.html", meta: RESET_PASSWORD };
  const map = /^\/maps\/([^/]+)$/.exec(path);
  if (map) {
    const def = findMap(map[1]);
    if (def) return { file: `maps/${def.id}.html`, meta: mapMeta(def, hasImage) };
  }
  if (/^\/game\/[^/]+\/watch$/.test(path)) return { file: "watch.html", meta: WATCH };
  if (path.startsWith("/game/")) return { file: "game.html", meta: INVITE };
  return { file: "index.html", meta: HOME };
}

/** Every page the build writes, the home page first. */
export function allPages(hasImage?: (id: string) => boolean): Page[] {
  return [
    pageFor("/"),
    pageFor("/maps"),
    ...ALL_MAPS.map((m) => pageFor(`/maps/${m.id}`, hasImage)),
    pageFor("/game/code"),
    pageFor("/game/code/watch"),
    pageFor(RESET_PASSWORD_PAGE),
  ];
}

const abs = (path: string) => SITE_ORIGIN + path;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The game, as schema.org structured data (search results can show it as a game). */
function jsonLd(): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: SITE_NAME,
    description: HOME_DESCRIPTION,
    url: abs("/"),
    image: abs(SITE_IMAGE),
    genre: ["Shooter", "Twin-stick shooter", "Battle royale"],
    gamePlatform: "Web browser",
    playMode: "MultiPlayer",
    applicationCategory: "Game",
    operatingSystem: "Any (web browser)",
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  };
  // `<` escaped, so no string in it can close the script tag.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** The tags between the `<!-- seo -->` markers of index.html, for one page. */
export function headTags(meta: PageMeta): string {
  const t = (s: string) => escapeHtml(s);
  const url = meta.path === null ? null : abs(meta.path);
  const image = abs(meta.image);
  const lines = [
    `<title>${t(meta.title)}</title>`,
    `<meta name="description" content="${t(meta.description)}" />`,
    ...(meta.noindex ? [`<meta name="robots" content="noindex" />`] : []),
    ...(url && !meta.noindex ? [`<link rel="canonical" href="${t(url)}" />`] : []),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${t(meta.title)}" />`,
    `<meta property="og:description" content="${t(meta.description)}" />`,
    ...(url ? [`<meta property="og:url" content="${t(url)}" />`] : []),
    `<meta property="og:image" content="${t(image)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${IMAGE_WIDTH}" />`,
    `<meta property="og:image:height" content="${IMAGE_HEIGHT}" />`,
    `<meta property="og:image:alt" content="${t(meta.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t(meta.title)}" />`,
    `<meta name="twitter:description" content="${t(meta.description)}" />`,
    `<meta name="twitter:image" content="${t(image)}" />`,
    `<meta name="twitter:image:alt" content="${t(meta.imageAlt)}" />`,
  ];
  if (!meta.noindex) lines.push(`<script type="application/ld+json">${jsonLd()}</script>`);
  return lines.join("\n    ");
}

/** The marker in index.html that the tags replace. */
export const SEO_MARKER = "<!-- seo -->";

/** index.html (source or built) with one page's tags in place of the marker. */
export function withHeadTags(html: string, meta: PageMeta): string {
  if (!html.includes(SEO_MARKER)) throw new Error(`index.html has no ${SEO_MARKER} marker for the SEO tags`);
  return html.replace(SEO_MARKER, () => headTags(meta));
}

export function robotsTxt(): string {
  return ["User-agent: *", "Allow: /", "Disallow: /game/", `Disallow: ${RESET_PASSWORD_PAGE}`, "", `Sitemap: ${abs("/sitemap.xml")}`, ""].join("\n");
}

export function sitemapXml(): string {
  const urls = ["/", "/maps", ...ALL_MAPS.map((m) => `/maps/${m.id}`)];
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls.map((u) => `  <url><loc>${escapeHtml(abs(u))}</loc></url>`),
    `</urlset>`,
    ``,
  ].join("\n");
}

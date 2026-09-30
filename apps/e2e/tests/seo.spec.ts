// Link previews and search tags: the HTML the server sends, before any
// JavaScript runs (what Discord, Slack or X's bots read), has each page's own
// title, description, Open Graph and Twitter tags. Map pages name their map
// and show its image, game links get one generic invite with no game code in
// it and stay out of search results, and robots.txt / sitemap.xml are there.
// Everything is fetched with `request`, never rendered in a page.

import type { APIRequestContext } from "@playwright/test";
import { ALL_MAPS, SITE_ORIGIN } from "../../client/seo/meta.ts";
import { expect, test } from "./fixtures.ts";

/** The raw HTML of a path, as a bot gets it. */
async function html(request: APIRequestContext, path: string): Promise<string> {
  const res = await request.get(path, { headers: { Accept: "text/html" } });
  expect(res.status(), path).toBe(200);
  return res.text();
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The `content` of `<meta property|name="key">`, or null. */
function meta(page: string, key: string): string | null {
  const tag = page.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`));
  return tag ? unescape(tag[1]) : null;
}

const title = (page: string) => unescape(page.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
const canonical = (page: string) => page.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null;

/** A share image: served at its path, a PNG, 1200 × 630 (read from its header). */
async function expectImage(request: APIRequestContext, url: string) {
  expect(url.startsWith(`${SITE_ORIGIN}/`), url).toBe(true);
  const res = await request.get(url.slice(SITE_ORIGIN.length));
  expect(res.status(), url).toBe(200);
  const png = await res.body();
  expect(png.subarray(1, 4).toString("latin1"), url).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)], url).toEqual([1200, 630]);
}

test("the home page has its title, description, canonical URL, Open Graph, Twitter and JSON-LD tags", async ({ request }) => {
  const page = await html(request, "/");
  expect(title(page)).toContain("Bagarre");
  const description = meta(page, "description");
  expect(description).toContain("battle royale");
  expect(canonical(page)).toBe(`${SITE_ORIGIN}/`);
  expect(meta(page, "og:type")).toBe("website");
  expect(meta(page, "og:site_name")).toBe("Bagarre");
  expect(meta(page, "og:title")).toBe(title(page));
  expect(meta(page, "og:description")).toBe(description);
  expect(meta(page, "og:url")).toBe(`${SITE_ORIGIN}/`);
  expect(meta(page, "og:image")).toBe(`${SITE_ORIGIN}/og/og.png`);
  expect(meta(page, "og:image:width")).toBe("1200");
  expect(meta(page, "og:image:height")).toBe("630");
  expect(meta(page, "twitter:card")).toBe("summary_large_image");
  expect(meta(page, "twitter:image")).toBe(meta(page, "og:image"));
  expect(meta(page, "robots")).toBeNull();
  // One title, one description: the tags replaced the old ones, they weren't added next to them.
  expect(page.match(/<title>/g)).toHaveLength(1);
  expect(page.match(/<meta name="description"/g)).toHaveLength(1);
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)?.[1] ?? "null");
  expect(ld).toMatchObject({
    "@type": "VideoGame",
    name: "Bagarre",
    url: `${SITE_ORIGIN}/`,
    gamePlatform: "Web browser",
    playMode: "MultiPlayer",
    applicationCategory: "Game",
    offers: { "@type": "Offer", price: "0" },
  });
  // The page itself still boots: the built bundle's script tag is there.
  expect(page).toMatch(/<script type="module" crossorigin src="\/assets\/[^"]+\.js">/);
  await expectImage(request, meta(page, "og:image")!);
});

test("every map page names its map and shows its own image", async ({ request }) => {
  for (const m of ALL_MAPS) {
    const page = await html(request, `/maps/${m.id}`);
    expect(title(page), m.id).toContain(m.name);
    expect(meta(page, "og:title"), m.id).toContain(m.name);
    expect(meta(page, "description"), m.id).toContain(`${m.halfX * 2} × ${m.halfZ * 2} m`);
    expect(canonical(page), m.id).toBe(`${SITE_ORIGIN}/maps/${m.id}`);
    expect(meta(page, "og:url"), m.id).toBe(`${SITE_ORIGIN}/maps/${m.id}`);
    expect(meta(page, "og:image"), m.id).toBe(`${SITE_ORIGIN}/og/maps/${m.id}.png`);
    expect(meta(page, "robots"), m.id).toBeNull();
    await expectImage(request, meta(page, "og:image")!);
  }
  // The Maps list has its own too.
  const list = await html(request, "/maps");
  expect(title(list)).toMatch(/^Maps/);
  expect(canonical(list)).toBe(`${SITE_ORIGIN}/maps`);
});

test("game links get a generic invite, never the game code, and stay out of search results", async ({ request }) => {
  const invite = await html(request, "/game/ABCD");
  expect(title(invite)).toBe("You've been invited to a Bagarre match");
  expect(meta(invite, "og:title")).toBe(title(invite));
  expect(meta(invite, "robots")).toBe("noindex");
  expect(canonical(invite)).toBeNull();
  expect(meta(invite, "og:image")).toBe(`${SITE_ORIGIN}/og/og.png`);
  expect(invite).not.toContain("ABCD");
  // Same page whatever the code, even one that looks like markup.
  expect(await html(request, "/game/zzzz")).toBe(invite);
  const odd = await html(request, `/game/${encodeURIComponent('"><script>x</script>')}`);
  expect(odd).toBe(invite);

  const watch = await html(request, "/game/ABCD/watch");
  expect(title(watch)).toBe("Watch a live Bagarre match");
  expect(meta(watch, "robots")).toBe("noindex");
  expect(watch).not.toContain("ABCD");

  const reset = await html(request, "/reset-password?token=abc");
  expect(meta(reset, "robots")).toBe("noindex");
});

test("robots.txt keeps game links out and points to the sitemap, which lists every map", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const rules = await robots.text();
  expect(rules).toContain("Allow: /");
  expect(rules).toContain("Disallow: /game/");
  expect(rules).toContain("Disallow: /reset-password");
  expect(rules).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((l) => l[1]);
  expect(locs).toEqual([`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/maps`, ...ALL_MAPS.map((m) => `${SITE_ORIGIN}/maps/${m.id}`)]);
});

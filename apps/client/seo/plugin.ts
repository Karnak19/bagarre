// The Vite side of meta.ts: puts each page's <head> tags into the HTML the
// server sends, so link preview bots (which don't run JavaScript) see them.
//
// - Build: index.html keeps its `<!-- seo -->` marker through the bundle; once
//   it is written, one copy per page replaces the marker with that page's
//   tags (dist/index.html, dist/maps.html, dist/maps/<id>.html, dist/game.html,
//   dist/watch.html, dist/reset-password.html), next to robots.txt and
//   sitemap.xml. The copies share the built file's hashed asset tags. The
//   Caddyfile serves each path its copy.
// - `vite dev`: the tags of the requested path, straight into index.html
//   (transformIndexHtml sees the URL asked for), and robots.txt / sitemap.xml
//   served from memory.
// - `vite preview` (the e2e suite): each path is served the copy the build
//   wrote for it, like Caddy does.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { SEO_MARKER, SITE_IMAGE, allPages, mapImage, pageFor, robotsTxt, sitemapXml, withHeadTags } from "./meta.ts";

/** A navigation to a page (not a module, an asset or a file with an extension). */
const isPageRequest = (method: string | undefined, pathname: string) =>
  (method === "GET" || method === "HEAD") && !pathname.startsWith("/@") && !/\.[a-z0-9]+$/i.test(pathname);

export function seo(): Plugin {
  let config: ResolvedConfig;
  const hasImage = (id: string) => !!config.publicDir && existsSync(join(config.publicDir, mapImage(id)));

  return {
    name: "bagarre:seo",
    configResolved(c) {
      config = c;
    },

    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        // The build fills the marker in writeBundle, once per page.
        if (config.command === "build") return html;
        const pathname = new URL(ctx.originalUrl ?? ctx.path, "http://localhost").pathname;
        return withHeadTags(html, pageFor(pathname, hasImage).meta);
      },
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "/").split("?")[0];
        const body = pathname === "/robots.txt" ? robotsTxt() : pathname === "/sitemap.xml" ? sitemapXml() : null;
        if (body === null) return next();
        res.setHeader("Content-Type", pathname.endsWith(".xml") ? "application/xml" : "text/plain; charset=utf-8");
        res.end(body);
      });
    },

    configurePreviewServer(server) {
      // Before the static files: point a page's path at the HTML file written for it.
      server.middlewares.use((req, _res, next) => {
        const [pathname, query] = (req.url ?? "/").split("?");
        if (isPageRequest(req.method, pathname)) {
          const file = pageFor(pathname).file;
          if (file !== "index.html") req.url = `/${file}${query ? `?${query}` : ""}`;
        }
        next();
      });
    },

    writeBundle(options) {
      const dir = options.dir ?? config.build.outDir;
      const indexPath = join(dir, "index.html");
      const built = readFileSync(indexPath, "utf8");
      if (!built.includes(SEO_MARKER)) return; // Already filled (a second write of the same bundle).
      if (config.publicDir && !existsSync(join(config.publicDir, SITE_IMAGE))) {
        this.warn(`${SITE_IMAGE} is missing: run \`bun run og:render\` in apps/client`);
      }
      for (const page of allPages(hasImage)) {
        const out = join(dir, page.file);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, withHeadTags(built, page.meta));
      }
      writeFileSync(join(dir, "robots.txt"), robotsTxt());
      writeFileSync(join(dir, "sitemap.xml"), sitemapXml());
    },
  };
}

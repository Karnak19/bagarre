import { execSync } from "node:child_process";
import stylex from "@stylexjs/unplugin/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { seo } from "./seo/plugin.ts";

// The Rustrak release (Sentry protocol), resolved at build time and inlined
// into the bundle (main.tsx passes it to Sentry.init). Precedence: an explicit
// SENTRY_RELEASE, the deploy's commit sha (Vercel's, then Coolify's), the git
// sha here, else a stable fallback. docker-compose.yaml passes SENTRY_RELEASE
// from SENTRY_RELEASE/SOURCE_COMMIT; a bare `docker build` has neither and,
// with .git excluded from the build context (.dockerignore), no git metadata
// either, so it falls back to "dev".
const release =
  process.env.SENTRY_RELEASE?.trim() ||
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.SOURCE_COMMIT?.trim() ||
  (() => {
    try {
      return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  })() ||
  "dev";

export default defineConfig({
  define: {
    __SENTRY_RELEASE__: JSON.stringify(release),
  },
  plugins: [
    // File-based routes: src/routes/ -> src/routeTree.gen.ts. Must run before react().
    tanstackRouter({ target: "react", quoteStyle: "double", semicolons: true }),
    // StyleX compiles at build time: stylex.create() calls become atomic
    // classes, collected into one stylesheet (in dev, the plugin injects
    // /virtual:stylex.css itself). `debug: false` keeps the compiled property
    // keys identical to Astryx's precompiled ones in dev too: with debug keys
    // ("boxShadow-kGVxlE") an `xstyle` override doesn't replace the
    // component's own value, both classes land and the wrong one can win.
    stylex({ devMode: "full", debug: false }),
    react(),
    // Each page's title, description and link preview tags, in the HTML itself (seo/).
    seo(),
  ],
  // .env.local lives at the repo root, shared with the game server.
  // Only VITE_* variables reach the browser.
  envDir: "../..",
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", chunkSizeWarningLimit: 1024 },
});

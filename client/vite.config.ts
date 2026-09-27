import { defineConfig } from "vite";

export default defineConfig({
  // .env.local lives at the repo root, shared with the server and Convex.
  // Only VITE_* variables reach the browser.
  envDir: "..",
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", chunkSizeWarningLimit: 1024 },
});

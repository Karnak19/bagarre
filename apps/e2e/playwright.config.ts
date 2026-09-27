import { defineConfig, devices } from "@playwright/test";

// Dedicated ports, so the suite never meets `bun run dev` (2567 / 5173).
export const SERVER_PORT = 2610;
export const CLIENT_PORT = 5610;
/** Where the e2e build of the client goes (relative to apps/client), never the real dist/. */
const CLIENT_DIST = "../e2e/.client-dist";
const CI = !!process.env.CI;

/**
 * WebGL in headless Chromium. On a Mac, the real GPU through Metal (fast);
 * elsewhere (CI's Linux runners have no GPU) SwiftShader, which renders on
 * the CPU. `E2E_GL=swiftshader` forces the software path locally.
 */
export const GL = process.env.E2E_GL ?? (process.platform === "darwin" ? "metal" : "swiftshader");
const GL_ARGS =
  GL === "metal"
    ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

export default defineConfig({
  testDir: "./tests",
  // SwiftShader (CI) is several times slower than a real GPU.
  timeout: CI ? 90_000 : 45_000,
  expect: { timeout: CI ? 20_000 : 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 4,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    // Small on purpose: every player is a page drawing the game, and SwiftShader does it on the CPU.
    viewport: { width: 800, height: 500 },
    launchOptions: { args: [...GL_ARGS, "--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      // The real game server with short rules and a test-only control API (server.ts).
      command: "bun server.ts",
      env: { PORT: String(SERVER_PORT), NODE_ENV: "development" },
      url: `http://localhost:${SERVER_PORT}/games`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // The client, built in development mode (NODE_ENV=development keeps the
      // `__bagarre` dev handle) and served by `vite preview`: a page loads a
      // few bundled files instead of Vite dev's hundreds of modules, which a
      // dozen fresh browser contexts fetching at once made slow and flaky.
      // Pointed at the e2e game server. No Clerk key: guests only, sign-in
      // shows as not configured (a real sign-in can't be done headless).
      command: `bunx vite build --mode development --outDir ${CLIENT_DIST} --emptyOutDir --logLevel error && bunx vite preview --outDir ${CLIENT_DIST} --port ${CLIENT_PORT} --strictPort`,
      cwd: "../client",
      env: {
        NODE_ENV: "development",
        VITE_SERVER_URL: `http://localhost:${SERVER_PORT}`,
        VITE_CLERK_PUBLISHABLE_KEY: "",
        VITE_CONVEX_URL: "",
      },
      url: `http://localhost:${CLIENT_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});

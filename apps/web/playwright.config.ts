import { defineConfig } from "@playwright/test";

// E2E_PORT reuses a dev server that is already running.
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // One browser at a time: the tests decode and encode real video.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Real Chrome, not Playwright's Chromium, which ships without H.264 and AAC.
    channel: "chrome",
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
  },
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}/editor`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

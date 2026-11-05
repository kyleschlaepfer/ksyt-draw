import { defineConfig, devices } from "@playwright/test";

// Runs against the production build served by `vite preview`, so the tests see the same bundle
// that deploys. PLAYWRIGHT_CHANNEL=chrome uses an installed Chrome instead of Playwright's Chromium
// (handy where the Playwright CDN is unreachable).
export default defineConfig({
  testDir: "test/e2e",
  outputDir: "test-results/artifacts",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  projects: [
    { name: "chromium", grepInvert: /a large diagram/, use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL || undefined } },
    // frame timings mean something only when nothing else is drawing: these run once the rest are done
    { name: "timing", grep: /a large diagram/, dependencies: ["chromium"], use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL || undefined } },
  ],
  webServer: [
    {
      command: "npm run build && npx vite preview --port 4173 --strictPort",
      url: "http://localhost:4173/embed/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // the host pages for host.spec.ts, on a second loopback origin
      command: "node test/e2e/host-server.mjs",
      url: "http://localhost:4174/host?f=%5B%5D",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});

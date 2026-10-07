import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.E2E_FLEET_PORT ?? 4797)

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    trace: "retain-on-failure",
    launchOptions: {
      // Lets environments with a preinstalled Chromium skip `playwright install`.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: ["--no-proxy-server"],
    },
  },
  webServer: {
    command: "npm run build && node test/e2e-server.mjs",
    url: `http://127.0.0.1:${port}/oc/global/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
})

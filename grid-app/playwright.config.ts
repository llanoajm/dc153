import { defineConfig, devices } from "@playwright/test"
import path from "node:path"
import fs from "node:fs"

// Best-effort .env.local loader so STEINMETZ_TEST_ACCOUNT_* and Supabase URL
// reach the test process without pulling in dotenv as a dep.
const envFile = path.join(__dirname, ".env.local")
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (!m) continue
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"

const authState = path.join(__dirname, "test-results", "auth-state.json")

export default defineConfig({
  testDir: "./tests/flows",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: require.resolve("./tests/fixtures/global-setup.ts"),
  use: {
    baseURL,
    headless: true,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-anon",
      testMatch: /\.anon\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], storageState: undefined },
    },
    {
      name: "chromium-auth",
      testMatch: /(?<!\.anon)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], storageState: authState },
    },
  ],
})

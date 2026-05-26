import { defineConfig, devices } from "@playwright/test"
import path from "node:path"
import fs from "node:fs"

// Demos recording config — produces a .webm per validated flow into
// `public/demos/`. Separate from `playwright.config.ts` so the regular test
// run is not weighed down by video capture and the recording outputs land in
// a deterministic location.
//
// Reuses the auth-state.json captured by `playwright.config.ts`'s global
// setup; run the regular suite once first (or `npx playwright test
// --config=playwright.config.ts tests/flows/auth.anon.spec.ts --grep
// "login → /app round-trip"`) to seed it.

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
  testDir: "./tests/demos",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  globalSetup: require.resolve("./tests/fixtures/global-setup.ts"),
  outputDir: "./tests/demos/_artifacts",
  use: {
    baseURL,
    headless: true,
    ignoreHTTPSErrors: true,
    video: {
      mode: "on",
      size: { width: 1024, height: 700 },
    },
    viewport: { width: 1024, height: 700 },
  },
  projects: [
    {
      name: "demos-anon",
      testMatch: /\.anon\.demo\.ts$/,
      use: { ...devices["Desktop Chrome"], storageState: undefined },
    },
    {
      name: "demos-auth",
      testMatch: /(?<!\.anon)\.demo\.ts$/,
      use: { ...devices["Desktop Chrome"], storageState: authState },
    },
  ],
})

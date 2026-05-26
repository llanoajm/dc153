import { chromium, type FullConfig } from "@playwright/test"
import path from "node:path"
import fs from "node:fs"

// Runs once before the test suite. Drives the real login form (so the
// Supabase session cookies are written exactly the way SSR's createServerClient
// expects them) and persists the resulting storage state for reuse via
// `test.use({ storageState })`. Re-running is idempotent: storage state is
// overwritten and Supabase sessions are long-lived so the captured cookies
// remain valid across consecutive `npx playwright test` invocations.

export default async function globalSetup(config: FullConfig) {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"
  const email = process.env.STEINMETZ_TEST_ACCOUNT_EMAIL
  const password = process.env.STEINMETZ_TEST_ACCOUNT_PASSWORD
  if (!email || !password) {
    throw new Error(
      "STEINMETZ_TEST_ACCOUNT_EMAIL / STEINMETZ_TEST_ACCOUNT_PASSWORD must be set " +
        "(see grid-app/.env.local; loaded by playwright.config.ts).",
    )
  }

  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${baseURL}/login`)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: /sign in/i }).click()
  // SSR layout calls supabase.auth.getUser() then materializes the workspace —
  // the first load can take a beat on cold cache. Wait for the URL transition.
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 })

  const stateDir = path.join(__dirname, "..", "..", "test-results")
  fs.mkdirSync(stateDir, { recursive: true })
  const statePath = path.join(stateDir, "auth-state.json")
  await context.storageState({ path: statePath })
  process.env.PLAYWRIGHT_AUTH_STATE = statePath
  await browser.close()
}

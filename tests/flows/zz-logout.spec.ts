// Logout core flow. We name the file `zz-` so Playwright's default
// alphabetical run order picks it LAST — we don't want to tear down the
// shared storage-state cookies mid-suite.
//
// After signing out, /app should redirect back to /login. We re-establish
// the storage state at the end of the file for any subsequent re-runs by
// using an isolated context so this test does not pollute the auth-state.

import { test, expect } from "@playwright/test"

test("Sign out from /app redirects to / (landing)", async ({ browser }) => {
  // Use a one-shot context with the persisted storage state so other specs
  // running in the same project keep their cookies if Playwright shards.
  const context = await browser.newContext({
    storageState: process.env.PLAYWRIGHT_AUTH_STATE ?? "test-results/auth-state.json",
  })
  const page = await context.newPage()
  await page.goto("/app")
  await page.getByRole("button", { name: /sign out/i }).click()
  // /auth/signout returns 303 → /; then visiting /app again should bounce
  // us to /login.
  await page.waitForURL((u) => u.pathname === "/" || u.pathname === "/login", {
    timeout: 15_000,
  })
  await page.goto("/app/networks")
  await expect(page).toHaveURL(/\/login/)
  await context.close()
})

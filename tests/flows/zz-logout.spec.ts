// Logout core flow. We name the file `zz-` so Playwright's default
// alphabetical run order picks it LAST — we don't want to tear down the
// shared storage-state cookies mid-suite.
//
// After signing out, /app should redirect back to /login. We re-establish
// the storage state at the end of the file for any subsequent re-runs by
// using an isolated context so this test does not pollute the auth-state.

import { test, expect } from "@playwright/test"

// Redesign §5 (LOOP_QUEUE item 5): logout moved off the top-right header into a
// profile menu pinned at the BOTTOM-LEFT of the rail. This spec asserts both
// halves of that contract — Sign out is reachable from the profile menu and is
// absent from the header — then exercises the actual sign-out redirect.
test("Sign out lives in the bottom-left profile menu, not the header", async ({
  browser,
}) => {
  // Use a one-shot context with the persisted storage state so other specs
  // running in the same project keep their cookies if Playwright shards.
  const context = await browser.newContext({
    storageState: process.env.PLAYWRIGHT_AUTH_STATE ?? "test-results/auth-state.json",
  })
  const page = await context.newPage()
  await page.goto("/app")

  // The header carries the lockup + org switcher only — no Sign out anymore.
  const header = page.locator("header").first()
  await expect(header.getByRole("button", { name: /sign out/i })).toHaveCount(0)

  // Sign out is hidden until the bottom-left profile circle is opened.
  await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0)
  await page.getByRole("button", { name: /account menu/i }).click()
  const signOut = page.getByRole("button", { name: /sign out/i })
  await expect(signOut).toBeVisible()

  await signOut.click()
  // /auth/signout returns 303 → /; then visiting /app again should bounce
  // us to /login.
  await page.waitForURL((u) => u.pathname === "/" || u.pathname === "/login", {
    timeout: 15_000,
  })
  await page.goto("/app/networks")
  await expect(page).toHaveURL(/\/login/)
  await context.close()
})

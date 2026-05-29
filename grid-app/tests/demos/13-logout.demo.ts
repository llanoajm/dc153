// Records the Sign out flow — opening the bottom-left profile menu and clicking
// Sign out returns the user to the public landing page (redesign §5 moved
// logout off the header). Runs last so we don't disturb the storageState other
// demos depend on (Playwright issues each test its own context, so the
// signed-out side effect is scoped to this test only).
import { test, expect } from "@playwright/test"
import { saveVideoAs, slugFor, beat } from "./_helpers"

test("logout [demo:logout]", async ({ page }, testInfo) => {
  await page.goto("/app")
  await page.getByRole("button", { name: /account menu/i }).click()
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 15_000 })
  await beat(page, 600)
  await page.getByRole("button", { name: /sign out/i }).click()
  // POST /auth/signout redirects to /
  await page.waitForURL(/\/$|\/login/, { timeout: 15_000 })
  await beat(page, 800)
  await page.close()
  await saveVideoAs(page, slugFor(testInfo))
})

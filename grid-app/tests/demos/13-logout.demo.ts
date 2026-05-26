// Records the Sign out flow — clicking the header button returns the user to
// the public landing page. Runs last so we don't disturb the storageState
// other demos depend on (Playwright issues each test its own context, so the
// signed-out side effect is scoped to this test only).
import { test, expect } from "@playwright/test"
import { saveVideoAs, slugFor, beat } from "./_helpers"

test("logout [demo:logout]", async ({ page }, testInfo) => {
  await page.goto("/app")
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 15_000 })
  await beat(page, 600)
  await page.getByRole("button", { name: /sign out/i }).click()
  // POST /auth/signout redirects to /
  await page.waitForURL(/\/$|\/login/, { timeout: 15_000 })
  await beat(page, 800)
  await page.close()
  await saveVideoAs(page, slugFor(testInfo))
})

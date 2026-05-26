// Records /app/settings — the user-settings panel.
import { test, expect } from "@playwright/test"
import { saveVideoAs, slugFor, beat } from "./_helpers"

test("settings page [demo:settings]", async ({ page }, testInfo) => {
  await page.goto("/app/settings")
  await expect(page.getByText(/settings/i).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForLoadState("networkidle")
  await beat(page, 1200)
  await page.close()
  await saveVideoAs(page, slugFor(testInfo))
})

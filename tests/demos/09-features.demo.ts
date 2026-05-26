// Records /app/features — drafted features awaiting approval.
import { test, expect } from "@playwright/test"
import { saveVideoAs, slugFor, beat } from "./_helpers"

test("features panel [demo:features]", async ({ page }, testInfo) => {
  await page.goto("/app/features")
  await expect(page.getByText(/features/i).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForLoadState("networkidle")
  await beat(page, 1200)
  await page.close()
  await saveVideoAs(page, slugFor(testInfo))
})

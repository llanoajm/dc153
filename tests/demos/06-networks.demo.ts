// Records /app/networks — the panel either lists seeded canonical networks
// (ieee-30, pypsa-eur-slice, pypsa-usa) or its empty-state copy. Either is a
// valid demo of the surface; we don't assert which.
import { test, expect } from "@playwright/test"
import { saveVideoAs, slugFor, beat } from "./_helpers"

test("networks list [demo:networks]", async ({ page }, testInfo) => {
  await page.goto("/app/networks")
  await expect(page.getByText(/networks/i).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForLoadState("networkidle")
  await beat(page, 1500)
  await page.close()
  await saveVideoAs(page, slugFor(testInfo))
})

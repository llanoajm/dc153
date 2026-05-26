// Records LeftRail navigation across several routes — the workspace shell
// stays mounted as the user clicks through.
import { test, expect } from "@playwright/test"
import { saveVideoAs, slugFor, beat } from "./_helpers"

test("rail navigation [demo:rail-nav]", async ({ page }, testInfo) => {
  await page.goto("/app")
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 15_000 })
  await beat(page, 500)

  for (const label of [/^networks$/i, /^runs$/i, /^dashboards$/i, /^orgs$/i, /^settings$/i]) {
    await page.getByRole("button", { name: label }).first().click()
    await beat(page, 700)
  }

  await page.close()
  await saveVideoAs(page, slugFor(testInfo))
})

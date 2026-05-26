// Records the workspace shell mounting on /app — header + LeftRail + chat
// textarea. Covers the "workspace materialization" + shell entries.
import { test, expect } from "@playwright/test"
import { saveVideoAs, slugFor, beat } from "./_helpers"

test("app shell mounts [demo:app-shell]", async ({ page }, testInfo) => {
  await page.goto("/app")
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("button", { name: /^networks$/i }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: /^runs$/i }).first()).toBeVisible()
  await expect(page.getByPlaceholder(/describe a feature|loading/i).first()).toBeVisible({
    timeout: 15_000,
  })
  await beat(page, 1000)
  await page.close()
  await saveVideoAs(page, slugFor(testInfo))
})

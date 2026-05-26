// Records the signed-out deep-link → /login redirect (validated by
// tests/flows/auth.anon.spec.ts).
import { test, expect } from "@playwright/test"
import { saveVideoAs, slugFor, beat } from "./_helpers"

test("signed-out deep link redirects [demo:signed-out-redirect]", async ({ page }, testInfo) => {
  await page.goto("/")
  await beat(page, 800)
  const resp = await page.goto("/app/networks")
  expect(resp?.url()).toContain("/login")
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible({ timeout: 15_000 })
  await beat(page, 600)
  await page.close()
  await saveVideoAs(page, slugFor(testInfo))
})

// Records a real login → /app round-trip with the test account. We type the
// password slowly enough that the recording is legible.
import { test, expect } from "@playwright/test"
import { saveVideoAs, slugFor, beat } from "./_helpers"

test("login round-trip [demo:login]", async ({ page }, testInfo) => {
  const email = process.env.STEINMETZ_TEST_ACCOUNT_EMAIL!
  const password = process.env.STEINMETZ_TEST_ACCOUNT_PASSWORD!
  await page.goto("/login")
  await beat(page, 500)
  await page.getByLabel("Email").type(email, { delay: 25 })
  await page.getByLabel("Password").type(password, { delay: 25 })
  await beat(page, 400)
  await page.getByRole("button", { name: /sign in/i }).click()
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 })
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 15_000 })
  await beat(page, 800)
  await page.close()
  await saveVideoAs(page, slugFor(testInfo))
})

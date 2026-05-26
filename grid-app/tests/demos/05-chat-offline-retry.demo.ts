// Records the inline error banner + Retry affordance from item 10.2 — what
// the user sees when /api/opencode/session 500s during bootstrap.
import { test, expect } from "@playwright/test"
import { saveVideoAs, slugFor, beat } from "./_helpers"

test("chat-offline error + retry [demo:chat-offline-retry]", async ({ page }, testInfo) => {
  let hits = 0
  await page.route("**/api/opencode/session", (route, request) => {
    if (request.method() !== "POST") return route.continue()
    hits += 1
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "simulated bootstrap failure (demo fixture)" }),
    })
  })

  await page.goto("/app")
  const banner = page.getByRole("alert").filter({ hasText: /chat is offline/i })
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await expect(banner.getByText(/simulated bootstrap failure/i)).toBeVisible()
  await expect(page.getByPlaceholder(/chat is offline/i)).toBeVisible()
  await beat(page, 800)
  const retry = page.getByRole("button", { name: /^Retry$/ })
  await expect(retry).toBeVisible()
  const before = hits
  await retry.click()
  await expect.poll(() => hits, { timeout: 5_000 }).toBeGreaterThan(before)
  await beat(page, 800)
  await page.close()
  await saveVideoAs(page, slugFor(testInfo))
})

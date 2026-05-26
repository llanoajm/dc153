// Chat input behaviour. We deliberately do NOT exercise the OpenRouter
// round-trip here — it costs money and adds flakiness — instead we cover the
// form's empty / disabled / large-input / mid-flight edge cases visible from
// the client.

import { test, expect } from "@playwright/test"

const PLACEHOLDER = /describe a feature|loading/i

test.describe("chat input edge cases (logged in)", () => {
  test("textarea + Send button mount on /app", async ({ page }) => {
    await page.goto("/app")
    const textarea = page.getByPlaceholder(PLACEHOLDER)
    await expect(textarea).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: /^send$/i })).toBeVisible()
  })

  test("Send is disabled while input is empty or whitespace", async ({ page }) => {
    await page.goto("/app")
    const textarea = page.getByPlaceholder(PLACEHOLDER)
    await expect(textarea).toBeEnabled({ timeout: 15_000 })
    const send = page.getByRole("button", { name: /^send$/i })
    await expect(send).toBeDisabled()
    await textarea.fill("   \n\t  ")
    await expect(send).toBeDisabled()
    await textarea.fill("hello")
    await expect(send).toBeEnabled()
  })

  test("textarea accepts a 10kb paste without freezing the UI", async ({ page }) => {
    await page.goto("/app")
    const textarea = page.getByPlaceholder(PLACEHOLDER)
    await expect(textarea).toBeEnabled({ timeout: 15_000 })
    const big = "lorem ipsum ".repeat(900) // ~10800 chars
    await textarea.fill(big)
    // Page must remain interactive: the Send button is still queryable.
    await expect(page.getByRole("button", { name: /^send$/i })).toBeEnabled()
    // Clear so the next test starts clean.
    await textarea.fill("")
  })

  test("Cmd+Enter binding is documented in the input footer", async ({ page }) => {
    await page.goto("/app")
    await expect(page.getByText(/Ctrl\+Enter to send/i)).toBeVisible({ timeout: 15_000 })
  })

  // Item 10.2: when POST /api/opencode/session 500s, the textarea was getting
  // stuck on placeholder "Loading…" with no visible explanation. Verify the
  // inline error banner + Retry button + offline placeholder render instead.
  test("session bootstrap failure surfaces inline error + Retry above textarea", async ({
    page,
  }) => {
    let hits = 0
    await page.route("**/api/opencode/session", (route, request) => {
      if (request.method() !== "POST") return route.continue()
      hits += 1
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "simulated bootstrap failure (test fixture)" }),
      })
    })

    await page.goto("/app")

    // Banner with the captured error text is visible (regardless of empty
    // message list). Filtering by text disambiguates the banner from
    // Next.js's built-in route announcer, which also exposes role=alert.
    const banner = page.getByRole("alert").filter({ hasText: /chat is offline/i })
    await expect(banner).toBeVisible({ timeout: 15_000 })
    await expect(banner.getByText(/simulated bootstrap failure/i)).toBeVisible()

    // Textarea placeholder swaps to the offline message so the disabled
    // state has a stated reason.
    await expect(page.getByPlaceholder(/chat is offline/i)).toBeVisible()
    await expect(page.getByPlaceholder(/^Loading…$/)).toHaveCount(0)

    // Retry button is present and re-invokes the POST.
    const retry = page.getByRole("button", { name: /^Retry$/ })
    await expect(retry).toBeVisible()
    const before = hits
    await retry.click()
    await expect.poll(() => hits, { timeout: 5_000 }).toBeGreaterThan(before)
  })
})

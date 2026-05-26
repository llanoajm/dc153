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
})

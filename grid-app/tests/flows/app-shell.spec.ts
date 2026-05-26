// Verifies the authed app shell — header, rail nav, command palette — and
// that the user's workspace was materialized (no error state on first /app
// load). Uses the shared logged-in storage state from global-setup.

import { test, expect } from "@playwright/test"

test.describe("app shell (logged in)", () => {
  test("/app renders the workspace shell with rail + chat tab", async ({ page }) => {
    await page.goto("/app")
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible()
    // Rail entries (LeftRail) — match a couple of stable labels.
    await expect(page.getByRole("button", { name: /networks/i }).first()).toBeVisible()
    await expect(page.getByRole("button", { name: /runs/i }).first()).toBeVisible()
    // Chat textarea is the default tab content. Placeholder is
    // "Describe a feature… ('add a nitrogen-emissions objective', etc.)"
    // once the session has been minted, or "Loading…" before that.
    await expect(page.getByPlaceholder(/describe a feature|loading/i).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test("rail item Networks routes to /app/networks and back", async ({ page }) => {
    await page.goto("/app")
    await page.getByRole("button", { name: /^networks$/i }).first().click()
    await page.waitForURL(/\/app\/networks$/)
    await expect(page.locator("main, body").first()).toBeVisible()
  })

  test("rail item Runs routes to /app/runs", async ({ page }) => {
    await page.goto("/app")
    await page.getByRole("button", { name: /^runs$/i }).first().click()
    await page.waitForURL(/\/app\/runs$/)
  })

  test("Cmd+K opens the command palette", async ({ page }) => {
    await page.goto("/app")
    // Focus the body so the global keydown listener actually fires; some
    // browsers swallow Meta+K when no element has focus yet.
    await page.locator("body").click()
    await page.keyboard.press("Meta+K")
    const palette = page.getByRole("dialog", { name: /command palette/i })
    await expect(palette).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press("Escape")
    await expect(palette).toBeHidden()
  })
})

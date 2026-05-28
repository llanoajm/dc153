// Verifies the authed app shell — header, rail nav, command palette — and
// that the user's workspace was materialized (no error state on first /app
// load). Uses the shared logged-in storage state from global-setup.

import { test, expect } from "@playwright/test"

test.describe("app shell (logged in)", () => {
  test("/app renders the workspace shell with rail + chat tab", async ({ page }) => {
    await page.goto("/app")
    // Redesign §5: the rail leads with the single Network + a Chats history;
    // the account/Sign out live behind the bottom-left profile menu.
    await expect(page.getByRole("button", { name: /account menu/i })).toBeVisible()
    await expect(page.getByText(/^network$/i).first()).toBeVisible()
    await expect(page.getByText(/^chats$/i).first()).toBeVisible()
    // Chat textarea is the default tab content; placeholder is the agent prompt
    // once the session is minted, or "Loading…" before that.
    await expect(page.getByPlaceholder(/ask the agent|loading/i).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test("rail item Networks routes to /app/networks and back", async ({ page }) => {
    await page.goto("/app")
    // Secondary sections live under the collapsed "More" group now.
    await page.getByRole("button", { name: /^more$/i }).click()
    await page.getByRole("button", { name: /^networks$/i }).first().click()
    await page.waitForURL(/\/app\/networks$/)
    await expect(page.locator("main, body").first()).toBeVisible()
  })

  test("rail item Runs routes to /app/runs", async ({ page }) => {
    await page.goto("/app")
    await page.getByRole("button", { name: /^more$/i }).click()
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

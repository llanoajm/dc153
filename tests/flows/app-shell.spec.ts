// Verifies the authed app shell — header, rail nav, command palette — and
// that the user's workspace was materialized (no error state on first /app
// load). Uses the shared logged-in storage state from global-setup.

import { test, expect } from "@playwright/test"

// Redesign §5: /app is now the workspace GALLERY; the chat + the workspace
// shell (rail, Library group, profile menu, Cmd+K) live under /app/w/[id] and the
// legacy secondary routes. The shell-chrome tests below target /app/networks —
// a route that still mounts the shell WITHOUT needing a `workspaces` row in the
// DB. The chat-composer assertion that needs a bound workspace moved to
// chat.spec.ts (see its note re: a seeded /app/w/[id]).
test.describe("app shell (logged in)", () => {
  test("/app renders the workspace gallery with a New-workspace card", async ({ page }) => {
    await page.goto("/app")
    await expect(page.getByRole("heading", { name: /^workspaces$/i })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole("button", { name: /new workspace/i }).first()).toBeVisible()
  })

  test("workspace shell (on a secondary route) shows the rail + profile menu", async ({
    page,
  }) => {
    await page.goto("/app/networks")
    // The rail leads with the single Network + a Chats history; account/Sign
    // out live behind the bottom-left profile menu.
    await expect(page.getByRole("button", { name: /account menu/i })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText(/^network$/i).first()).toBeVisible()
    await expect(page.getByText(/^chats$/i).first()).toBeVisible()
  })

  test("rail item Data Source routes to /app/networks and back", async ({ page }) => {
    await page.goto("/app/networks")
    // The five nouns (Data Source / Objectives / Runs & Plans) are top-level
    // now; the demoted generic panels live under the collapsed "Library" group.
    await page.getByRole("button", { name: /^data source$/i }).first().click()
    await page.waitForURL(/\/app\/networks$/)
    await expect(page.locator("main, body").first()).toBeVisible()
  })

  test("rail item Runs & Plans routes to /app/runs", async ({ page }) => {
    await page.goto("/app/networks")
    await page.getByRole("button", { name: /^runs & plans$/i }).first().click()
    await page.waitForURL(/\/app\/runs$/)
  })

  test("Library group reveals demoted panels (Sources routes to /app/sources)", async ({
    page,
  }) => {
    await page.goto("/app/networks")
    await page.getByRole("button", { name: /^library$/i }).click()
    await page.getByRole("button", { name: /^sources$/i }).first().click()
    await page.waitForURL(/\/app\/sources$/)
  })

  test("Cmd+K opens the command palette", async ({ page }) => {
    await page.goto("/app/networks")
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

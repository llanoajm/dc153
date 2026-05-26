// Auth-shaped probes that must run WITHOUT a logged-in storage state.
// Covers: signed-out deep-link redirect, signup landing page (closed beta),
// invalid login, login → /app round-trip.
//
// Dev stack assumption: Next.js on :3000, Supabase reachable (the login form
// does a real `signInWithPassword` against the configured project). See
// AGENTS.md "Quick start" for the launch incantation.

import { test, expect } from "@playwright/test"

test.describe("auth (signed out)", () => {
  test("landing page renders the lockup and a Try Curie OS CTA", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("nav").first()).toBeVisible()
    await expect(page.getByRole("link", { name: /try curie os/i })).toBeVisible()
  })

  test("signed-out deep link to /app/* redirects to /login with ?next", async ({ page }) => {
    const resp = await page.goto("/app/networks")
    // The proxy issues a 307 to /login?next=/app/networks; Playwright follows
    // it so we end up on /login.
    expect(resp?.url()).toMatch(/\/login\?next=%2Fapp%2Fnetworks$/)
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible()
  })

  test("signup page surfaces closed-beta copy, not a form", async ({ page }) => {
    await page.goto("/signup")
    await expect(page.getByText(/closed beta/i).first()).toBeVisible()
    // No password input on this page (signup is invitation-only).
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible()
  })

  test("wrong password surfaces an inline error and stays on /login", async ({ page }) => {
    await page.goto("/login")
    await page.getByLabel("Email").fill("claude@steinmetz.ai")
    await page.getByLabel("Password").fill("definitely-not-the-password-XYZ")
    await page.getByRole("button", { name: /sign in/i }).click()
    // Supabase returns "Invalid login credentials"; we don't care about the
    // exact wording, only that some red error text appears and the URL didn't
    // change.
    await expect(page.locator("p.text-red-600")).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test("malformed email triggers native email validation (form does not submit)", async ({ page }) => {
    await page.goto("/login")
    await page.getByLabel("Email").fill("not-an-email")
    await page.getByLabel("Password").fill("anything-here-1234")
    await page.getByRole("button", { name: /sign in/i }).click()
    // Browser keeps us on /login because input[type=email] failed validation.
    await expect(page).toHaveURL(/\/login$/)
  })

  test("login page first focus is the email input (after autoFocus)", async ({ page }) => {
    await page.goto("/login")
    // autoFocus runs inside a Suspense boundary; give the next tick a moment.
    await page.waitForTimeout(100)
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("type"))
    expect(focused).toBe("email")
  })

  test("login → /app round-trip works with the test account", async ({ page }) => {
    const email = process.env.STEINMETZ_TEST_ACCOUNT_EMAIL!
    const password = process.env.STEINMETZ_TEST_ACCOUNT_PASSWORD!
    await page.goto("/login")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password").fill(password)
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 })
    // The authed header includes a Sign out button.
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible()
  })
})

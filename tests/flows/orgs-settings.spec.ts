// Orgs panel + Settings panel — light smoke. Validates the form scaffolding
// renders, the "Create a new org" button is wired (we don't actually create
// an org to keep the test idempotent), and the provider-keys panel surfaces
// the OpenRouter row.

import { test, expect } from "@playwright/test"

test.describe("orgs (logged in)", () => {
  test("/app/orgs renders 'Create a new org' + 'Your orgs' sections", async ({ page }) => {
    await page.goto("/app/orgs")
    await expect(page.getByRole("heading", { name: /^orgs$/i })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/your orgs/i)).toBeVisible()
    await expect(page.getByText(/create a new org/i)).toBeVisible()
  })

  test("Create button is disabled when the org name input is empty", async ({ page }) => {
    await page.goto("/app/orgs")
    const submit = page.getByRole("button", { name: /^create$/i })
    await expect(submit).toBeVisible({ timeout: 15_000 })
    await expect(submit).toBeDisabled()
  })
})

test.describe("settings (logged in)", () => {
  test("/app/settings lists OpenRouter as a provider row", async ({ page }) => {
    await page.goto("/app/settings")
    await expect(page.getByText(/openrouter/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test("Save button is disabled when the OpenRouter key input is empty", async ({ page }) => {
    await page.goto("/app/settings")
    const save = page.getByRole("button", { name: /^save$/i }).first()
    await expect(save).toBeVisible({ timeout: 15_000 })
    await expect(save).toBeDisabled()
  })
})

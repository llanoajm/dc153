// Smoke each rail page that has its own route. We're not asserting deep
// behaviour — just that the page mounts without an error overlay, which is
// the dumb-but-effective bar for "did anyone break the workspace shell".

import { test, expect } from "@playwright/test"

const ROUTES = [
  "/app/sources",
  "/app/networks",
  "/app/runs",
  "/app/dashboards",
  "/app/features",
  "/app/glossary",
  "/app/orgs",
  "/app/panels",
  "/app/settings",
]

for (const route of ROUTES) {
  test(`${route} mounts without an error boundary`, async ({ page }) => {
    const resp = await page.goto(route)
    expect(resp?.status() ?? 200).toBeLessThan(500)
    await expect(page.getByText(/application error|something went wrong/i)).toHaveCount(0)
    // Side rail must still be present (the shell didn't crash).
    await expect(page.getByText(/workspace/i).first()).toBeVisible({ timeout: 15_000 })
  })
}

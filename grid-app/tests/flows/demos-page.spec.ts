// Validates that /app/demos (Phase F.99) mounts behind the auth gate, lists
// the recorded clips that exist on disk, and each <video src=/demos/*.webm>
// resolves 200 against the live server.

import { test, expect } from "@playwright/test"

test.describe("/app/demos (logged in)", () => {
  test("page mounts and lists recordings", async ({ page }) => {
    await page.goto("/app/demos")
    await expect(page.getByText(/validated-flow walkthroughs/i)).toBeVisible({ timeout: 15_000 })

    // At least one <video> renders (the recordings exist on disk after
    // running `npx playwright test --config=playwright.demos.config.ts`).
    const videos = page.locator("video")
    const count = await videos.count()
    expect(count).toBeGreaterThan(0)
  })

  test("each rendered video src resolves to 200", async ({ page }) => {
    await page.goto("/app/demos")
    await expect(page.locator("video").first()).toBeVisible({ timeout: 15_000 })
    const srcs = await page.locator("video").evaluateAll((els) =>
      (els as HTMLVideoElement[]).map((v) => v.getAttribute("src") ?? ""),
    )
    expect(srcs.length).toBeGreaterThan(0)
    for (const src of srcs) {
      expect(src).toMatch(/^\/demos\/[a-z0-9-]+\.webm$/)
      const r = await page.request.get(src)
      expect(r.status(), `expected 200 for ${src}`).toBe(200)
    }
  })
})

// Signed-out redirect to /login is covered by the generic /app/** probe in
// tests/flows/auth.anon.spec.ts ("signed-out deep link to /app/* redirects
// to /login with ?next") — proxy.ts has no demos-specific branch, so the
// generic case is sufficient.

// Validates that /demos is public (no auth gate), lists the recorded clips
// that exist on disk, and each <video src=/demos/*.webm> resolves 200
// against the live server.

import { test, expect } from "@playwright/test"

test.describe("/demos (public)", () => {
  test("does not redirect to /login", async ({ page }) => {
    const resp = await page.goto("/demos")
    expect(resp?.status() ?? 200).toBeLessThan(400)
    expect(new URL(page.url()).pathname).toBe("/demos")
  })

  test("page mounts and lists recordings", async ({ page }) => {
    await page.goto("/demos")
    await expect(page.getByText(/validated-flow walkthroughs/i)).toBeVisible({ timeout: 15_000 })
    const videos = page.locator("video")
    expect(await videos.count()).toBeGreaterThan(0)
  })

  test("each rendered video src resolves to 200", async ({ page }) => {
    await page.goto("/demos")
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

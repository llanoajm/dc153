// Networks listing + artifact view + invalid-id behaviour.
//
// The seeded canonical networks (ieee-30, pypsa-eur-slice, pypsa-usa) are
// expected to be present in `public.artifacts` (see scripts/seed_networks.py).
// If the user hasn't seeded them yet the list may be empty — we still validate
// the empty-state copy renders rather than crashing.

import { test, expect } from "@playwright/test"

test.describe("networks + artifacts (logged in)", () => {
  test("/app/networks renders the panel (either with rows or an empty state)", async ({ page }) => {
    await page.goto("/app/networks")
    // The panel always renders a heading region; we accept either some rows
    // or the empty state copy.
    await expect(page.getByText(/networks/i).first()).toBeVisible({ timeout: 15_000 })
    // Wait out the initial fetch.
    await page.waitForLoadState("networkidle")
    // No untrapped Error overlays.
    await expect(page.getByText(/application error|something went wrong/i)).toHaveCount(0)
  })

  test("a random non-existent artifact id renders a clean error, not a 500", async ({ page }) => {
    const bogus = "00000000-0000-4000-8000-000000000000"
    const resp = await page.goto(`/app/artifacts/${bogus}`)
    // Either the page is reachable and shows a not-found UI, or Next.js
    // returns a 404 page. Either is acceptable; what we DON'T want is a 500.
    expect(resp?.status() ?? 200).toBeLessThan(500)
  })

  test("a malformed (non-uuid) artifact id does not 500 the route", async ({ page }) => {
    const resp = await page.goto("/app/artifacts/not-a-uuid")
    expect(resp?.status() ?? 200).toBeLessThan(500)
  })

  test("seeded canonical network — if present — has a clickable list item", async ({ page }) => {
    await page.goto("/app/networks")
    await page.waitForLoadState("networkidle")
    const ieee = page.getByText(/ieee-30/i).first()
    test.skip(
      (await ieee.count()) === 0,
      "ieee-30 not seeded; run `npm --silent run seed:networks` to enable this test",
    )
    await ieee.click()
    await page.waitForURL(/\/app\/artifacts\/[0-9a-f-]+/i, { timeout: 15_000 })
  })

  test("GET /api/artifacts?kind=network returns 200 with an array body", async ({ request }) => {
    const r = await request.get("/api/artifacts?kind=network&limit=10")
    expect(r.status()).toBe(200)
    const json = await r.json()
    expect(Array.isArray(json)).toBeTruthy()
  })
})

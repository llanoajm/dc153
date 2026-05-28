// In-chat file upload (LOOP_QUEUE.md item 7). Exercises the composer's attach
// control: a `+` button opens a hidden file input; selecting a file POSTs to
// /api/upload/source and renders an attachment chip. The upload route is mocked
// so the test costs nothing and doesn't depend on the ingestion pipeline.
//
// Run via the regular Playwright config against a dev stack — NOT run in the
// autonomous loop (guardrails forbid driving a browser against prod :3000);
// this is the deliverable for human/CI review.

import { test, expect } from "@playwright/test"

const COMPOSER = /ask the agent|loading/i

test.describe("in-chat file upload (logged in)", () => {
  test("attach button uploads a file and shows a chip in the composer", async ({
    page,
  }) => {
    // Mock the upload route so no real file is ingested.
    await page.route("**/api/upload/source", (route, request) => {
      if (request.method() !== "POST") return route.continue()
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "11111111-1111-1111-1111-111111111111",
          kind: "source_document",
          name: "report.pdf",
        }),
      })
    })

    await page.goto("/app")
    // Composer is ready.
    await expect(page.getByPlaceholder(COMPOSER)).toBeVisible({ timeout: 15_000 })

    const attach = page.getByRole("button", { name: /attach a file/i })
    await expect(attach).toBeVisible()

    // Set the file directly on the hidden input (clicking it would open the OS
    // dialog, which Playwright can't drive).
    const input = page.locator('input[type="file"]')
    await input.setInputFiles({
      name: "report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 test fixture"),
    })

    // The chip appears with the filename and a remove control.
    const chip = page.getByTitle("report.pdf").first()
    await expect(chip).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("button", { name: /remove report\.pdf/i })).toBeVisible()
  })

  test("an unsupported file type is rejected with an inline error", async ({
    page,
  }) => {
    await page.goto("/app")
    await expect(page.getByPlaceholder(COMPOSER)).toBeVisible({ timeout: 15_000 })

    const input = page.locator('input[type="file"]')
    await input.setInputFiles({
      name: "data.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("a,b,c\n1,2,3"),
    })

    await expect(page.getByText(/unsupported file type/i)).toBeVisible({
      timeout: 5_000,
    })
  })
})

// Records chat textarea enable/disable behaviour. Does NOT exercise the
// OpenRouter round-trip — that's flaky and costs money.
import { test, expect } from "@playwright/test"
import { saveVideoAs, slugFor, beat } from "./_helpers"

test("chat textarea behaviour [demo:chat-input]", async ({ page }, testInfo) => {
  await page.goto("/app")
  const textarea = page.getByPlaceholder(/describe a feature|loading/i).first()
  await expect(textarea).toBeEnabled({ timeout: 15_000 })
  const send = page.getByRole("button", { name: /^send$/i })
  await expect(send).toBeDisabled()
  await beat(page, 500)
  await textarea.type("   ", { delay: 60 })
  await expect(send).toBeDisabled()
  await beat(page, 400)
  await textarea.fill("")
  await textarea.type("explore the IEEE-30 network", { delay: 30 })
  await expect(send).toBeEnabled()
  await beat(page, 900)
  await textarea.fill("")
  await beat(page, 300)
  await page.close()
  await saveVideoAs(page, slugFor(testInfo))
})

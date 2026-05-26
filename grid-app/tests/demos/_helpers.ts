import path from "node:path"
import fs from "node:fs"
import type { Page, TestInfo } from "@playwright/test"

// Where the per-demo .webm clips land. `public/demos/` is served as static
// content by Next.js (URL: /demos/<slug>.webm), so the /app/demos page can
// embed them directly. Total size stays under ~5MB at 1024×700 with the short
// scripts in this directory.
const DEMOS_DIR = path.join(__dirname, "..", "..", "public", "demos")

export function demosDir(): string {
  return DEMOS_DIR
}

export function ensureDemosDir(): string {
  fs.mkdirSync(DEMOS_DIR, { recursive: true })
  return DEMOS_DIR
}

// Slugify a demo's slug from the test title's `[demo:<slug>]` tag if present,
// otherwise from the title itself. Slugs are stable filenames — keep them
// matched to `lib/demos.ts`.
export function slugFor(testInfo: TestInfo): string {
  const m = /\[demo:([a-z0-9-]+)\]/.exec(testInfo.title)
  if (m) return m[1]
  return testInfo.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

// Save the page's video at `public/demos/<slug>.webm` and discard the
// Playwright-managed copy. Must be called AFTER `page.close()` so the codec
// has flushed.
export async function saveVideoAs(page: Page, slug: string): Promise<void> {
  const video = page.video()
  if (!video) return
  ensureDemosDir()
  const target = path.join(DEMOS_DIR, `${slug}.webm`)
  // Overwrite if it already exists so re-running the script refreshes the
  // clip rather than appending to a junk pile.
  try {
    fs.unlinkSync(target)
  } catch {
    // missing is fine
  }
  await video.saveAs(target)
  // Drop Playwright's copy in test-results so the dir doesn't accumulate
  // duplicates across runs.
  try {
    await video.delete()
  } catch {
    // best-effort cleanup
  }
}

// Briefly pause so the recording shows the change instead of blinking past
// it. Keep these short — clips are throwaway training material, not docs.
export async function beat(page: Page, ms = 600): Promise<void> {
  await page.waitForTimeout(ms)
}

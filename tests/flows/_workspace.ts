import type { Page } from "@playwright/test"

// Redesign §5: the chat now lives at /app/w/[id], bound to a workspace row.
// Composer/chat specs need a real workspace to navigate into. This helper
// creates one through the API (idempotent enough for a test account — it just
// makes a fresh "Test workspace" each run) and returns the chat path.
//
// Requires the `workspaces` migration (supabase/migrations/0001_workspaces.sql)
// applied to the DB the dev stack points at. Until then the POST 500s and this
// throws — the calling spec should be run only against a migrated DB. (The
// autonomous loop never runs Playwright; this is a human/CI deliverable.)
export async function ensureTestWorkspaceChatPath(page: Page): Promise<string> {
  const res = await page.request.post("/api/workspaces", {
    data: { name: "Test workspace", focus: ["Operations"] },
  })
  if (!res.ok()) {
    throw new Error(
      `could not create a test workspace (HTTP ${res.status()}). ` +
        "Is supabase/migrations/0001_workspaces.sql applied to the dev DB?",
    )
  }
  const ws = (await res.json()) as { id: string }
  return `/app/w/${ws.id}`
}

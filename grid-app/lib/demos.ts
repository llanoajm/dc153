import fs from "node:fs"
import path from "node:path"

// Per ROADMAP §Phase F.99 / LOOP_QUEUE item 99. Each entry corresponds to one
// recorded clip under `public/demos/<slug>.webm`. The recording script lives
// at `tests/demos/*.demo.ts`; the entries here are the source of truth for
// titles + descriptions, so the page renders predictably whether or not the
// physical .webm has been produced yet.
export interface DemoClip {
  slug: string
  title: string
  flow: string
  description: string
}

export const DEMO_CLIPS: DemoClip[] = [
  {
    slug: "signed-out-redirect",
    title: "Signed-out users land on the login page",
    flow: "Auth — proxy.ts deep-link redirect",
    description:
      "Visiting /app/* while signed out triggers a 307 to /login with the original path captured as ?next.",
  },
  {
    slug: "login",
    title: "Login round-trip",
    flow: "Auth — email + password sign-in via Supabase",
    description:
      "Email and password go through Supabase's signInWithPassword; on success the user lands on /app with the workspace materialized.",
  },
  {
    slug: "app-shell",
    title: "Workspace shell mounts on /app",
    flow: "Shell — header, LeftRail, chat tab",
    description:
      "Header carries the Steinmetz lockup + Sign out. The LeftRail enumerates the workspace sections. Chat is the default center tab.",
  },
  {
    slug: "chat-input",
    title: "Chat textarea enable / disable",
    flow: "Chat — input edge cases",
    description:
      "Send stays disabled while the input is empty or whitespace, enables on real content, and accepts large pastes without freezing the UI.",
  },
  {
    slug: "chat-offline-retry",
    title: "Chat-offline error banner + Retry",
    flow: "Chat — session bootstrap failure (item 10.2)",
    description:
      "When POST /api/opencode/session 500s, the page renders an inline error banner above the textarea and a Retry button that re-invokes the POST. Placeholder swaps to 'Chat is offline — see error above'.",
  },
  {
    slug: "networks",
    title: "Networks list",
    flow: "Artifacts — network listing",
    description:
      "The /app/networks panel either lists seeded canonical networks (ieee-30, pypsa-eur-slice, pypsa-usa) or shows the empty-state copy. Either render is a clean shell — no 500s, no error overlays.",
  },
  {
    slug: "rail-nav",
    title: "Rail navigation across the workspace",
    flow: "Shell — LeftRail routing",
    description:
      "Clicking through Networks, Runs, Dashboards, Orgs, and Settings: the workspace shell stays mounted; only the center tab swaps.",
  },
  {
    slug: "dashboards",
    title: "Dashboards index",
    flow: "Artifacts — agent-authored layouts",
    description:
      "/app/dashboards lists the saved layouts the agent has composed. Each row links to the artifact and exposes a Pin toggle that promotes it to the LeftRail.",
  },
  {
    slug: "features",
    title: "Features panel",
    flow: "Features — drafted user-space Python",
    description:
      "/app/features shows the Python features drafted by the source ingest pipeline. Each card surfaces approve / reject / edit so the user controls what the per-user MCP server exposes.",
  },
  {
    slug: "glossary",
    title: "Glossary + company-context",
    flow: "Sources — extracted glossary",
    description:
      "/app/glossary renders the live workspace `glossary.md` + `company-context.md` side-by-side. Both are auto-loaded into every chat session via opencode's `instructions:` list.",
  },
  {
    slug: "orgs",
    title: "Organizations panel",
    flow: "Orgs — membership + invites",
    description:
      "/app/orgs shows the caller's memberships, exposes a create-org form, and lets owners/admins edit the org-scoped glossary + company-context overlay.",
  },
  {
    slug: "settings",
    title: "Settings panel",
    flow: "Settings — user preferences",
    description: "/app/settings exposes the per-user settings surface (model / agent / review policy).",
  },
  {
    slug: "logout",
    title: "Sign out",
    flow: "Auth — POST /auth/signout",
    description:
      "Clicking Sign out posts to /auth/signout, clears the Supabase session cookies, and bounces the user back to the public landing page.",
  },
]

// Filter to clips whose .webm actually exists on disk. Used by the page so
// missing recordings don't show up as broken <video> tags.
export function listExistingDemos(): (DemoClip & { available: boolean; sizeBytes: number })[] {
  const root = path.join(process.cwd(), "public", "demos")
  return DEMO_CLIPS.map((c) => {
    const file = path.join(root, `${c.slug}.webm`)
    let available = false
    let sizeBytes = 0
    try {
      const st = fs.statSync(file)
      available = st.isFile() && st.size > 0
      sizeBytes = st.size
    } catch {
      // file not present
    }
    return { ...c, available, sizeBytes }
  })
}

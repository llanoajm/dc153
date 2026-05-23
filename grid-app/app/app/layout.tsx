import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ensureUserWorkspace } from "@/lib/user-workspace"
import { syncOrgContextOverlays } from "@/lib/orgs"
import { listPinnedDashboards } from "@/lib/dashboards"
import { Lockup } from "@/components/lockup"
import { WorkspaceShell, type PinnedDashboard } from "@/components/shell/WorkspaceShell"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Materialize the user's workspace if it doesn't exist yet, then layer in
  // any org overlays so the agent sees the user's org glossary/context before
  // personal content (ROADMAP §10). syncOrgContextOverlays is a best-effort
  // refresh — if Supabase is unreachable, fall back to the workspace as-is
  // so chat still works.
  const workspaceDir = await ensureUserWorkspace(user.id)
  try {
    await syncOrgContextOverlays(workspaceDir)
  } catch (e) {
    console.warn("syncOrgContextOverlays failed", e)
  }

  // Pinned dashboards surface in the left rail under their own section so a
  // user (or the agent) can promote a composed layout to one-click access.
  const pinnedDashboards: PinnedDashboard[] = (await listPinnedDashboards()).map((a) => ({
    id: a.id,
    name: a.name,
  }))

  return (
    <div className="flex-1 flex flex-col bg-white text-black min-h-0">
      <header className="border-b border-black/10 px-6 py-3 flex items-center justify-between shrink-0">
        <Lockup size="sm" />
        <form action="/auth/signout" method="POST">
          <button
            type="submit"
            className="text-xs font-mark tracking-wider text-black/60 hover:text-black"
          >
            Sign out
          </button>
        </form>
      </header>
      <WorkspaceShell pinnedDashboards={pinnedDashboards}>{children}</WorkspaceShell>
    </div>
  )
}

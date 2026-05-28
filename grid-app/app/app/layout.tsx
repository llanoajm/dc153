import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ensureUserWorkspace } from "@/lib/user-workspace"
import { getActiveOrgId, listMyOrgs, syncOrgContextOverlays } from "@/lib/orgs"
import { listPinnedDashboards } from "@/lib/dashboards"
import { Lockup } from "@/components/lockup"
import { OrgSwitcher } from "@/components/orgs/OrgSwitcher"
import { WorkspaceShell, type PinnedDashboard } from "@/components/shell/WorkspaceShell"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Materialize the user's workspace if it doesn't exist yet, then layer in
  // the active org's overlays so the agent sees that one org's
  // glossary/context before personal content (ROADMAP §10, HARDENING §1.3 —
  // overlays must NOT stack across every membership). syncOrgContextOverlays
  // is a best-effort refresh — if Supabase is unreachable, fall back to the
  // workspace as-is so chat still works.
  const workspaceDir = await ensureUserWorkspace(user.id)
  const [memberships, activeOrgId] = await Promise.all([
    listMyOrgs().catch(() => []),
    getActiveOrgId().catch(() => null),
  ])
  try {
    await syncOrgContextOverlays(workspaceDir, { activeOrgId })
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
    <div
      className="flex-1 flex flex-col text-black min-h-0"
      style={{ background: "var(--bg-app)" }}
    >
      <header
        className="px-6 py-3 flex items-center justify-between shrink-0"
        style={{
          background: "var(--bg-card)",
          borderBottom: "1px solid var(--bor-1)",
        }}
      >
        <Lockup size="sm" />
        <div className="flex items-center gap-6">
          <OrgSwitcher memberships={memberships} activeOrgId={activeOrgId} />
          <form action="/auth/signout" method="POST">
            <button type="submit" className="nav-signout">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <WorkspaceShell pinnedDashboards={pinnedDashboards}>{children}</WorkspaceShell>
    </div>
  )
}

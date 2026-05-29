import { listMyWorkspaceCards } from "@/lib/workspaces"
import { WorkspaceGallery } from "@/components/workspaces/WorkspaceGallery"

// Workspace gallery (WORKSPACE_REDESIGN.md §5). The top-level surface after
// sign-in: the user's workspaces as cards plus a "New workspace" card. A card
// opens /app/w/[id] (the workspace chat); "+" opens the creation wizard
// (/app/new — item 10). Workspaces are loaded server-side (RLS-scoped); if the
// `workspaces` table isn't applied to the live DB yet the list degrades to
// empty rather than erroring the page.
export default async function WorkspacesPage() {
  const workspaces = await listMyWorkspaceCards().catch(() => [])
  return <WorkspaceGallery workspaces={workspaces} />
}

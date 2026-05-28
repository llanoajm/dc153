import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getWorkspaceCard } from "@/lib/workspaces"

// GET /api/workspaces/[id] — one workspace (RLS-scoped) with its primary
// network name resolved. The shell reads this to render the workspace's single
// anchored grid at the top of the rail (WORKSPACE_REDESIGN.md §5).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  try {
    const workspace = await getWorkspaceCard(id)
    if (!workspace) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json(workspace)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

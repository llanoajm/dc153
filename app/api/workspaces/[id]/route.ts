import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getWorkspaceCard, updatePrimaryNetwork } from "@/lib/workspaces"

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

// PATCH /api/workspaces/[id] — swap (or clear) the workspace's anchored grid.
// Body: { primary_network_id: string | null }. The Data Source tab calls this
// to change the one network the study is about (WORKSPACE_REDESIGN.md §5). RLS's
// update policy enforces who may write; a missing/non-visible row 404s.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: { primary_network_id?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  if (!("primary_network_id" in body)) {
    return NextResponse.json({ error: "missing primary_network_id" }, { status: 400 })
  }
  const next = body.primary_network_id
  if (next !== null && typeof next !== "string") {
    return NextResponse.json({ error: "primary_network_id must be a string or null" }, { status: 400 })
  }

  const { id } = await params
  try {
    const workspace = await updatePrimaryNetwork(id, next)
    if (!workspace) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json(workspace)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

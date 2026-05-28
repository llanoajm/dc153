import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createWorkspace, listMyWorkspaceCards } from "@/lib/workspaces"

// GET /api/workspaces — lists the caller's visible workspaces (RLS-scoped),
// most-recently-active first, each with its primary network name resolved for
// the gallery cards (WORKSPACE_REDESIGN.md §5).
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const workspaces = await listMyWorkspaceCards()
    return NextResponse.json(workspaces)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// POST /api/workspaces — creates a workspace. body: { name, focus?,
// primary_network_id?, cover_image_url?, org_id? }. Used by the creation wizard
// (item 10); kept here so the resource is complete.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: {
    name?: string
    focus?: string[]
    primary_network_id?: string | null
    cover_image_url?: string | null
    org_id?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "missing name" }, { status: 400 })
  }
  try {
    const workspace = await createWorkspace({
      name: body.name,
      focus: Array.isArray(body.focus) ? body.focus : [],
      primary_network_id: body.primary_network_id ?? null,
      cover_image_url: body.cover_image_url ?? null,
      org_id: body.org_id ?? null,
    })
    return NextResponse.json(workspace)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

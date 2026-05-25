import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  getActiveOrgId,
  getMyRoleIn,
  setActiveOrgId,
  syncOrgContextOverlays,
} from "@/lib/orgs"
import { ensureUserWorkspace } from "@/lib/user-workspace"

// GET /api/orgs/active — returns `{ active_org_id: string|null }`.
// PUT /api/orgs/active { active_org_id: string|null } — switches the
// caller's active org (HARDENING §1.3). Membership is validated via
// `org_members`; non-members get 403. After the switch, the workspace's
// org overlay files are re-synced so the next session boots with the right
// context. Pass `null` to opt back into personal mode.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const active = await getActiveOrgId()
    return NextResponse.json({ active_org_id: active })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: { active_org_id?: string | null }
  try {
    body = (await req.json()) as { active_org_id?: string | null }
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  if (!Object.prototype.hasOwnProperty.call(body, "active_org_id")) {
    return NextResponse.json({ error: "active_org_id required" }, { status: 400 })
  }
  const requested = body.active_org_id ?? null
  if (requested !== null && typeof requested !== "string") {
    return NextResponse.json({ error: "active_org_id must be uuid|null" }, { status: 400 })
  }

  if (requested !== null) {
    const role = await getMyRoleIn(requested)
    if (role === null) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
  }

  try {
    await setActiveOrgId(requested)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }

  // Re-sync overlay files on disk immediately so /app/glossary and any new
  // session pick up the right org context without waiting on the next /app
  // navigation.
  try {
    const workspaceDir = await ensureUserWorkspace(user.id)
    await syncOrgContextOverlays(workspaceDir, { activeOrgId: requested })
  } catch (e) {
    console.warn("syncOrgContextOverlays failed after active-org switch", e)
  }

  return NextResponse.json({ active_org_id: requested })
}

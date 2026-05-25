import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createSession } from "@/lib/opencode-client"
import {
  getActiveOrgId,
  getMyRoleIn,
  setActiveOrgId,
  syncOrgContextOverlays,
} from "@/lib/orgs"
import { ensureUserWorkspace } from "@/lib/user-workspace"

// POST /api/opencode/session
//   body: { active_org_id?: string | null }
//
// Optional `active_org_id` switches the caller's active org *before* the
// session is created so the agent boots with the right overlay (HARDENING
// §1.3). Membership is validated server-side via `org_members`; passing an
// org the caller isn't in returns 403. Pass `null` to opt back into personal
// mode. Omitting the field leaves the persisted active org untouched (we
// still re-sync overlays so a recently rotated canonical doc lands before the
// session boots).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: { active_org_id?: string | null } = {}
  if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
    try {
      body = (await req.json()) as { active_org_id?: string | null }
    } catch {
      // Empty body / non-JSON is fine — falls through to existing-profile path.
    }
  }

  let activeOrgId: string | null
  if (Object.prototype.hasOwnProperty.call(body, "active_org_id")) {
    const requested = body.active_org_id ?? null
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
    activeOrgId = requested
  } else {
    activeOrgId = await getActiveOrgId()
  }

  // Re-sync overlays so the freshly-active org's canonical glossary /
  // context_doc lands in the workspace before opencode reads its
  // `instructions:` array.
  const workspaceDir = await ensureUserWorkspace(user.id)
  try {
    await syncOrgContextOverlays(workspaceDir, { activeOrgId })
  } catch (e) {
    console.warn("syncOrgContextOverlays failed", e)
  }

  try {
    const session = await createSession(user.id)
    return NextResponse.json({ ...session, active_org_id: activeOrgId })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

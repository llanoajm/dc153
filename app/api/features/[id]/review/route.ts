import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ensureUserWorkspace } from "@/lib/user-workspace"
import { reviewFeatureDetached } from "@/lib/review"
import { recordAudit } from "@/lib/audit"

// POST /api/features/<id>/review — manually trigger the reviewer agent for a
// feature artifact. Useful when the user edited the file out-of-band (via the
// agent or a shell) and wants to re-check + re-decide status without making
// a content change through the PATCH route.
//
// Async by design: the reviewer subprocess runs detached; the response
// returns immediately with the artifact id. Poll /api/features?status=... or
// re-fetch the row to see the updated status + metadata.last_review.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params

  const { data: row, error } = await supabase
    .from("artifacts")
    .select("id, kind, org_id")
    .eq("id", id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (row.kind !== "feature") {
    return NextResponse.json({ error: "not a feature artifact" }, { status: 400 })
  }

  const workspace = await ensureUserWorkspace(user.id)
  reviewFeatureDetached(id, workspace)
  await recordAudit({
    user_id: user.id,
    org_id: row.org_id,
    artifact_id: id,
    action: "review.requested",
    actor: "user",
    payload: {},
  })
  return NextResponse.json({ ok: true, artifact_id: id, queued: true })
}

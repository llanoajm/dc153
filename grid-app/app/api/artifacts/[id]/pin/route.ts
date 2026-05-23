import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getArtifact } from "@/lib/artifacts"
import { recordAudit } from "@/lib/audit"

// POST /api/artifacts/<id>/pin  body: { pinned: boolean }
//
// Toggles `metadata.pinned` on a dashboard (or any artifact). Used by the
// workspace shell to surface a dashboard in the left rail's pinned list. RLS
// guards write authorization — owner or org admin, per the schema policies.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await ctx.params
  let body: { pinned?: unknown }
  try {
    body = (await req.json()) as { pinned?: unknown }
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  if (typeof body.pinned !== "boolean") {
    return NextResponse.json({ error: "body.pinned must be boolean" }, { status: 400 })
  }

  const existing = await getArtifact(id)
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 })

  const metadata = { ...(existing.metadata ?? {}), pinned: body.pinned }
  const { data, error } = await supabase
    .from("artifacts")
    .update({ metadata })
    .eq("id", id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await recordAudit({
    user_id: user.id,
    org_id: data?.org_id ?? null,
    artifact_id: id,
    action: body.pinned ? "artifact.pinned" : "artifact.unpinned",
    actor: "user",
    payload: { kind: data?.kind },
  })

  return NextResponse.json(data)
}

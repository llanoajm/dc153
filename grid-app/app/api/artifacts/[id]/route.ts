import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getArtifact } from "@/lib/artifacts"
import { recordAudit } from "@/lib/audit"

// GET a single artifact row. RLS handles authorization — an unauthenticated
// caller hits the 401 below; an authenticated caller without read access on
// the row hits the 404 fall-through.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await ctx.params
  const artifact = await getArtifact(id)
  if (!artifact) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(artifact)
}

// PATCH lets the owner update view_spec, metadata, or name on a row they
// already own. Used by the dashboard authoring flow when an agent updates a
// saved dashboard, and by the "pin to rail" affordance.
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await ctx.params
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (isRecord(body.view_spec)) patch.view_spec = body.view_spec
  if (isRecord(body.metadata)) patch.metadata = body.metadata
  if (typeof body.name === "string") patch.name = body.name
  if (typeof body.status === "string") patch.status = body.status

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no patchable fields supplied" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("artifacts")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await recordAudit({
    user_id: user.id,
    org_id: data?.org_id ?? null,
    artifact_id: id,
    action: "artifact.patched",
    actor: "user",
    payload: { fields: Object.keys(patch) },
  })

  return NextResponse.json(data)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

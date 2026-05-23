import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getMyRoleIn } from "@/lib/orgs"

// GET /api/orgs/[id]/context — returns the org's canonical glossary +
// context_doc artifacts (if any). PUT /api/orgs/[id]/context
// { kind: "glossary"|"context_doc", text: string } — upserts the canonical
// org artifact. Caller must be owner/admin (RLS-enforced; we also short-
// circuit here for a friendlier 403).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params

  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .eq("org_id", id)
    .in("kind", ["glossary", "context_doc"])
    .eq("status", "canonical")
    .order("updated_at", { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params

  const role = await getMyRoleIn(id)
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  let body: { kind?: string; text?: string; name?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const kind = body.kind
  const text = body.text ?? ""
  if (kind !== "glossary" && kind !== "context_doc") {
    return NextResponse.json({ error: "kind must be glossary|context_doc" }, { status: 400 })
  }

  const { data: existing, error: lookupErr } = await supabase
    .from("artifacts")
    .select("id")
    .eq("org_id", id)
    .eq("kind", kind)
    .eq("status", "canonical")
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })

  const name = body.name ?? (kind === "glossary" ? "Org glossary" : "Org context")
  const view_spec = { renderer: "markdown", text }

  if (existing) {
    const { data, error } = await supabase
      .from("artifacts")
      .update({ name, view_spec, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  const { data, error } = await supabase
    .from("artifacts")
    .insert({
      user_id: user.id,
      org_id: id,
      kind,
      name,
      status: "canonical",
      view_spec,
      metadata: {},
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

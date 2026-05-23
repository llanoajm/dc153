import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getMyRoleIn } from "@/lib/orgs"

// GET/PUT /api/review-policy
//
// Body / query shape:
//   ?org_id=<uuid>  — read or write the org's policy (owner/admin only)
//                     omit it to read or write the caller's personal policy
//
// Body: { auto_promote: boolean }
//
// Underlies ROADMAP §9 (LOOP_QUEUE item 15): the reviewer reads this policy
// to decide whether a passing review auto-promotes a draft to canonical or
// stays in draft awaiting manual approval.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const orgId = url.searchParams.get("org_id")

  let q = supabase.from("review_policies").select("*").limit(1)
  if (orgId) q = q.eq("org_id", orgId).is("user_id", null)
  else q = q.eq("user_id", user.id).is("org_id", null)
  const { data, error } = await q.maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(
    data ?? {
      user_id: orgId ? null : user.id,
      org_id: orgId ?? null,
      auto_promote: false,
    },
  )
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: { auto_promote?: unknown; org_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const auto_promote = Boolean(body.auto_promote)
  const orgId = typeof body.org_id === "string" && body.org_id ? body.org_id : null

  // Short-circuit org writes before RLS so the response is a clean 403 rather
  // than the opaque "row violates row-level security" string.
  if (orgId) {
    const role = await getMyRoleIn(orgId)
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
  }

  const row: Record<string, unknown> = orgId
    ? { org_id: orgId, user_id: null, auto_promote, updated_at: new Date().toISOString() }
    : { user_id: user.id, org_id: null, auto_promote, updated_at: new Date().toISOString() }

  // No straight upsert because the unique constraint is partial (one index
  // per scope). Do read → insert/update by hand.
  let lookup = supabase.from("review_policies").select("id").limit(1)
  if (orgId) lookup = lookup.eq("org_id", orgId).is("user_id", null)
  else lookup = lookup.eq("user_id", user.id).is("org_id", null)
  const { data: existing, error: lookErr } = await lookup.maybeSingle()
  if (lookErr) return NextResponse.json({ error: lookErr.message }, { status: 500 })

  if (existing) {
    const { data: updated, error: updErr } = await supabase
      .from("review_policies")
      .update(row)
      .eq("id", (existing as { id: string }).id)
      .select()
      .single()
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    return NextResponse.json(updated)
  }

  const { data: inserted, error: insErr } = await supabase
    .from("review_policies")
    .insert(row)
    .select()
    .single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  return NextResponse.json(inserted)
}

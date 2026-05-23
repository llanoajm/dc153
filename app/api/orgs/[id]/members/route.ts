import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { serviceClient } from "@/lib/supabase/service"
import { addMember, listOrgMembers, type OrgRole } from "@/lib/orgs"

// GET /api/orgs/[id]/members — list members of an org (RLS: caller must be a
// member). POST /api/orgs/[id]/members { email | user_id, role? } — add a
// member; caller must be owner/admin (RLS-enforced). We use the service
// client to resolve email→user_id off the public.profiles table since the
// inviter may not have permission to read other profile rows directly.
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
  try {
    return NextResponse.json(await listOrgMembers(id))
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  let body: { email?: string; user_id?: string; role?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const role = (body.role ?? "member") as OrgRole
  if (!["owner", "admin", "member"].includes(role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 })
  }

  let userId = body.user_id ?? null
  if (!userId && body.email) {
    try {
      const svc = serviceClient()
      const { data, error } = await svc
        .from("profiles")
        .select("id")
        .eq("email", body.email.trim().toLowerCase())
        .maybeSingle()
      if (error) throw new Error(error.message)
      userId = data?.id ?? null
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 })
    }
    if (!userId) {
      return NextResponse.json(
        { error: "no user with that email — they must sign up first" },
        { status: 404 },
      )
    }
  }
  if (!userId) {
    return NextResponse.json({ error: "email or user_id required" }, { status: 400 })
  }

  try {
    await addMember(id, userId, role)
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

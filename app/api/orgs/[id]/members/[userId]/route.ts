import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// DELETE /api/orgs/[id]/members/[userId] — remove a member. RLS allows
// either the member themselves (leaving) or an owner/admin (removing).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id, userId } = await params
  const { error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", id)
    .eq("user_id", userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

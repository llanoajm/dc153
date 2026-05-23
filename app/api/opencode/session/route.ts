import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createSession } from "@/lib/opencode-client"

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const session = await createSession(user.id)
    return NextResponse.json(session)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

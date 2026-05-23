import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getMessages } from "@/lib/opencode-client"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  try {
    const messages = await getMessages(user.id, id)
    return NextResponse.json(messages)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

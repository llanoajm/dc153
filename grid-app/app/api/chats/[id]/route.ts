import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getChat, touchChat } from "@/lib/chats"

// GET /api/chats/[id]
//   Returns one chat (its workspace + opencode session id). Reopening a past
//   chat: the client takes the returned session_id and reloads its messages
//   via the existing GET /api/opencode/session/[session_id]/message route.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  try {
    const chat = await getChat(id)
    if (!chat) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json(chat)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// PATCH /api/chats/[id]  — bump recency so the chat floats up the history list.
export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  try {
    await touchChat(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

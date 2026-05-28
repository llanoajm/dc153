import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createChat, listChats } from "@/lib/chats"

// GET /api/chats?workspace_id=<uuid>
//   Lists a workspace's chats (most-recent first) for the sidebar history.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get("workspace_id")
  if (!workspaceId) {
    return NextResponse.json({ error: "missing workspace_id" }, { status: 400 })
  }
  try {
    const chats = await listChats(workspaceId)
    return NextResponse.json(chats)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// POST /api/chats
//   body: { workspace_id, session_id, title?, first_message?, org_id? }
//   Persists a chat the first time a session sends a message.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: {
    workspace_id?: string | null
    session_id?: string
    title?: string
    first_message?: string
    org_id?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  if (typeof body.session_id !== "string" || !body.session_id) {
    return NextResponse.json({ error: "missing session_id" }, { status: 400 })
  }
  try {
    const chat = await createChat({
      workspace_id: body.workspace_id ?? null,
      session_id: body.session_id,
      title: body.title,
      first_message: body.first_message,
      org_id: body.org_id ?? null,
    })
    return NextResponse.json(chat)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

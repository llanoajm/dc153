import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sendPrompt } from "@/lib/opencode-client"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  if (typeof body?.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "missing text" }, { status: 400 })
  }
  try {
    // This blocks until the agent completes its turn. With Sonnet doing tool
    // work this can be a minute or more — fine for v0; v1 will stream.
    const result = await sendPrompt(user.id, id, body.text, {
      agent: body.agent,
      providerID: body.providerID,
      modelID: body.modelID,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export const maxDuration = 600 // 10 min — agent turns can be long

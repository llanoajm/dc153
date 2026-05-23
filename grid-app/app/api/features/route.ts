import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { listArtifacts, type ArtifactStatus } from "@/lib/artifacts"

// GET /api/features?status=draft|canonical|deprecated
// Returns the user's feature artifacts. The Features panel uses this to drive
// the approve/edit/reject flow (ROADMAP §4 / LOOP_QUEUE item 12).
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const status = url.searchParams.get("status") ?? undefined
  const limit = url.searchParams.get("limit")

  try {
    const rows = await listArtifacts({
      kind: "feature",
      status: status as ArtifactStatus | undefined,
      limit: limit ? Number(limit) : 200,
    })
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

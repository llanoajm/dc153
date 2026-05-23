import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createOrg, listMyOrgs, slugify } from "@/lib/orgs"

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    return NextResponse.json(await listMyOrgs())
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: { name?: string; slug?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const name = (body.name ?? "").trim()
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 })
  }
  const slug = slugify(body.slug || name)
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 })
  }
  try {
    const org = await createOrg(name, slug)
    return NextResponse.json(org, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

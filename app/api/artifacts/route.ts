import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  createArtifact,
  listArtifacts,
  type ArtifactKind,
  type ArtifactStatus,
} from "@/lib/artifacts"
import { recordAudit } from "@/lib/audit"
import { reviewFeatureDetached } from "@/lib/review"
import { ensureUserWorkspace } from "@/lib/user-workspace"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const kind = url.searchParams.get("kind") ?? undefined
  const status = url.searchParams.get("status") ?? undefined
  const session = url.searchParams.get("session") ?? undefined
  const limit = url.searchParams.get("limit")
  const org_id = url.searchParams.get("org_id") ?? undefined
  const scope = url.searchParams.get("scope") ?? undefined

  try {
    const rows = await listArtifacts({
      kind: kind as ArtifactKind | undefined,
      status: status as ArtifactStatus | undefined,
      parent_session_id: session,
      limit: limit ? Number(limit) : undefined,
      org_id,
      scope: scope === "personal" || scope === "all" ? scope : undefined,
    })
    return NextResponse.json(rows)
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

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const kind = body.kind
  const name = body.name
  if (typeof kind !== "string" || typeof name !== "string") {
    return NextResponse.json(
      { error: "kind and name are required strings" },
      { status: 400 },
    )
  }

  try {
    const created = await createArtifact({
      kind,
      name,
      slug: typeof body.slug === "string" ? body.slug : null,
      fs_path: typeof body.fs_path === "string" ? body.fs_path : null,
      storage_path: typeof body.storage_path === "string" ? body.storage_path : null,
      metadata: isRecord(body.metadata) ? body.metadata : {},
      view_spec: isRecord(body.view_spec) ? body.view_spec : {},
      parent_id: typeof body.parent_id === "string" ? body.parent_id : null,
      parent_session_id:
        typeof body.parent_session_id === "string" ? body.parent_session_id : null,
      status: isStatus(body.status) ? body.status : "draft",
      org_id: typeof body.org_id === "string" ? body.org_id : null,
    })
    // Audit + reviewer (ROADMAP §9 / LOOP_QUEUE item 15). Every artifact
    // write is logged; feature artifacts also trigger the reviewer pass so
    // status flips to canonical / failed_validation per policy.
    await recordAudit({
      user_id: user.id,
      org_id: created.org_id,
      artifact_id: created.id,
      action: "artifact.created",
      actor: "user",
      payload: { kind: created.kind, status: created.status },
    })
    if (created.kind === "feature") {
      try {
        const workspace = await ensureUserWorkspace(user.id)
        reviewFeatureDetached(created.id, workspace)
      } catch (e) {
        console.error("[artifacts] reviewer dispatch failed:", e)
      }
    }
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function isStatus(v: unknown): v is ArtifactStatus {
  return v === "draft" || v === "canonical" || v === "deprecated" || v === "failed_validation"
}

import { NextRequest, NextResponse } from "next/server"
import fs from "node:fs/promises"
import path from "node:path"
import { createClient } from "@/lib/supabase/server"
import { ensureUserWorkspace } from "@/lib/user-workspace"
import type { ArtifactStatus } from "@/lib/artifacts"

// PATCH /api/features/<id>
//
// Body shape:
//   { status?: 'canonical' | 'deprecated' | 'draft', code?: string }
//
// status transitions:
//   - 'canonical' (approve): file stays under features/<slug>.py so the
//     per-user MCP server keeps exposing it. Artifact row flips to canonical.
//   - 'deprecated' (reject): file is renamed features/_<slug>.py so the MCP
//     server (which skips leading-underscore files) stops listing it. The
//     code stays on disk so the user / agent can recover it later.
//   - 'draft' (un-approve / un-reject): reverse of either of the above.
//     Restores features/<slug>.py if needed.
//
// `code`: overwrites the .py file on disk and refreshes `view_spec.source`
// so the renderer reflects the edit. Allowed in any status.
//
// All mutations are RLS-gated: the supabase client uses the user's session,
// so the update only succeeds when the row belongs to them.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params

  let body: { status?: string; code?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const targetStatus =
    body.status === "canonical" || body.status === "deprecated" || body.status === "draft"
      ? (body.status as ArtifactStatus)
      : null
  const code = typeof body.code === "string" ? body.code : null

  if (!targetStatus && code == null) {
    return NextResponse.json(
      { error: "nothing to change (provide status and/or code)" },
      { status: 400 },
    )
  }

  // Load the existing row to discover fs_path + current status.
  const { data: existing, error: fetchErr } = await supabase
    .from("artifacts")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (existing.kind !== "feature") {
    return NextResponse.json({ error: "not a feature artifact" }, { status: 400 })
  }

  const workspace = await ensureUserWorkspace(user.id)
  const featuresDir = path.join(workspace, "features")

  // Resolve current and target file paths. fs_path may be stale (e.g. after a
  // previous approve/reject) so we re-derive from slug for safety.
  const slug =
    (typeof existing.slug === "string" && existing.slug.length > 0
      ? existing.slug
      : path.basename(existing.fs_path ?? "feature.py", ".py").replace(/^_+/, "")) || "feature"
  const activeFile = path.join(featuresDir, `${slug}.py`)
  const hiddenFile = path.join(featuresDir, `_${slug}.py`)

  // Locate where the file currently lives. Cope with either active or hidden.
  let currentPath: string | null = null
  if (existing.fs_path) {
    try {
      await fs.access(existing.fs_path)
      currentPath = existing.fs_path
    } catch {
      currentPath = null
    }
  }
  if (!currentPath) {
    for (const candidate of [activeFile, hiddenFile]) {
      try {
        await fs.access(candidate)
        currentPath = candidate
        break
      } catch {
        // keep looking
      }
    }
  }

  // Apply code edit first (writes to currentPath, or to activeFile if there's
  // no file yet — e.g. row was inserted without a draft on disk).
  if (code != null) {
    const writePath = currentPath ?? activeFile
    await fs.mkdir(featuresDir, { recursive: true })
    await fs.writeFile(writePath, code, "utf8")
    currentPath = writePath
  }

  // Handle status-driven file moves.
  let finalPath = currentPath
  if (targetStatus === "deprecated" && currentPath && currentPath !== hiddenFile) {
    try {
      await fs.rename(currentPath, hiddenFile)
      finalPath = hiddenFile
    } catch (e) {
      return NextResponse.json({ error: `rename failed: ${e}` }, { status: 500 })
    }
  } else if (
    (targetStatus === "canonical" || targetStatus === "draft") &&
    currentPath &&
    currentPath !== activeFile
  ) {
    try {
      await fs.rename(currentPath, activeFile)
      finalPath = activeFile
    } catch (e) {
      return NextResponse.json({ error: `rename failed: ${e}` }, { status: 500 })
    }
  }

  // Read the final file contents back so view_spec.source stays in sync with
  // disk after a rename / edit.
  let onDiskSource: string | null = null
  if (finalPath) {
    try {
      onDiskSource = await fs.readFile(finalPath, "utf8")
    } catch {
      onDiskSource = null
    }
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (targetStatus) patch.status = targetStatus
  if (finalPath) patch.fs_path = finalPath
  if (onDiskSource != null) {
    patch.view_spec = {
      ...(existing.view_spec ?? {}),
      renderer: "code",
      language: "python",
      path: path.relative(workspace, finalPath ?? activeFile),
      source: onDiskSource,
    }
  }
  // Stamp a small audit trail in metadata so the lineage view (and a future
  // reviewer agent) can see who flipped which bits when.
  const existingMeta = (existing.metadata ?? {}) as Record<string, unknown>
  const history = Array.isArray(existingMeta.history) ? existingMeta.history : []
  patch.metadata = {
    ...existingMeta,
    history: [
      ...history,
      {
        at: new Date().toISOString(),
        actor: user.id,
        status: targetStatus ?? existing.status,
        edited: code != null,
      },
    ].slice(-20),
  }

  const { data: updated, error: updateErr } = await supabase
    .from("artifacts")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  return NextResponse.json(updated)
}

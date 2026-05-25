import { NextRequest, NextResponse } from "next/server"
import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { createClient } from "@/lib/supabase/server"
import { createArtifact } from "@/lib/artifacts"
import {
  ensureUserWorkspace,
  pyInterpreterForWorkspace,
  pythonEnv,
} from "@/lib/user-workspace"
import { acquireSlot, releaseTokenAsync } from "@/lib/proceed"
import { checkUserQuota } from "@/lib/quota"

function ingestScriptPath(): string {
  if (process.env.STEINMETZ_INGEST_SCRIPT) return process.env.STEINMETZ_INGEST_SCRIPT
  return path.join(process.cwd(), "scripts", "ingest_pypsa_folder.py")
}

// Upload route. Accepts multipart/form-data with one or more files representing
// a PyPSA folder (multiple CSVs) OR a single .zip. The route writes uploaded
// bytes to `<workspace>/sources/<slug>/raw/`, creates a `network` artifact in
// `pipeline_status='queued'`, and kicks off a detached Python ingestion process
// that handles unzipping, topology extraction, view_spec inlining, and a
// 1-hour smoke-dispatch. The ingestion script updates the artifact's
// `metadata.pipeline_status` as it progresses (queued → extracting → embedded
// → ready) and flips `status` to `failed_validation` on error.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch (e) {
    return NextResponse.json({ error: `bad form data: ${e}` }, { status: 400 })
  }

  const name = (form.get("name") as string | null)?.trim() || "Uploaded network"
  const slugInput = (form.get("slug") as string | null)?.trim() || ""
  const sessionId = (form.get("session") as string | null)?.trim() || null
  const files = form.getAll("files").filter((f): f is File => f instanceof File)

  if (files.length === 0) {
    return NextResponse.json({ error: "no files in upload" }, { status: 400 })
  }

  // HARDENING §2.3: block uploads when the caller is over their disk quota.
  // scripts/quota_check.sh flips profiles.over_quota at the 80% mark; the
  // user has to free space before we'll write more bytes to their workspace.
  const quota = await checkUserQuota(user.id)
  if (!quota.ok) {
    return NextResponse.json(
      { error: quota.reason, message: quota.message },
      { status: 507 },
    )
  }

  const slug = slugify(slugInput || name) || `network-${Date.now()}`
  const workspace = await ensureUserWorkspace(user.id)
  const rawDir = path.join(workspace, "sources", slug, "raw")
  await fs.mkdir(rawDir, { recursive: true })

  // HARDENING §2.2: gate the detached ingestion against the per-user / global
  // bucket so a user can't queue up 100 zip uploads in parallel. Reject loudly
  // (429) instead of silently dropping the request.
  const admission = await acquireSlot({
    userId: user.id,
    tool: "upload__pypsa_folder",
    args: { slug, files: files.map((f) => f.name) },
  })
  if (!admission.ok) {
    return NextResponse.json(
      {
        error: "concurrency_limit",
        reason: admission.reason,
        retry_after: admission.retryAfter,
      },
      {
        status: 429,
        headers: { "Retry-After": String(admission.retryAfter) },
      },
    )
  }

  // Write each uploaded file directly into rawDir. We trust the file names
  // because they came from the user's drag-and-drop and are scoped to their
  // own workspace; sanitize the basename to avoid path traversal.
  const written: string[] = []
  let totalBytes = 0
  for (const f of files) {
    const safeName = sanitizeFilename(f.name) || `file-${written.length}`
    const buf = Buffer.from(await f.arrayBuffer())
    totalBytes += buf.length
    const dest = path.join(rawDir, safeName)
    await fs.writeFile(dest, buf)
    written.push(safeName)
  }

  const artifact = await createArtifact({
    kind: "network",
    name,
    slug,
    fs_path: rawDir,
    metadata: {
      pipeline_status: "queued",
      uploaded_at: new Date().toISOString(),
      uploaded_files: written,
      uploaded_bytes: totalBytes,
    },
    view_spec: {
      renderer: "network-graph",
      fallback_renderer: "markdown",
    },
    parent_session_id: sessionId ?? undefined,
    status: "draft",
  })

  // Fire and forget — the ingestion script self-updates the artifact row via
  // the Supabase service-role key. The release(token) call fires from the
  // child's `close` handler so the bucket reflects real lifetime.
  spawnIngestion(artifact.id, rawDir, workspace, admission.token)

  return NextResponse.json(artifact, { status: 201 })
}

function spawnIngestion(
  artifactId: string,
  folder: string,
  workspace: string,
  proceedToken: string,
) {
  const child = spawn(
    pyInterpreterForWorkspace(workspace),
    [ingestScriptPath(), "--artifact-id", artifactId, "--folder", folder],
    {
      detached: true,
      stdio: "ignore",
      cwd: process.cwd(),
      env: pythonEnv(workspace),
    },
  )
  child.on("close", (code) => {
    void releaseTokenAsync({
      token: proceedToken,
      status: code === 0 ? "ok" : "error",
      error: code === 0 ? null : `ingester exited ${code}`,
    })
  })
  child.on("error", (err) => {
    void releaseTokenAsync({
      token: proceedToken,
      status: "error",
      error: String(err),
    })
  })
  child.unref()
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name)
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_")
}

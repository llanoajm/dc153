import { NextRequest, NextResponse } from "next/server"
import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { createClient } from "@/lib/supabase/server"
import { createArtifact } from "@/lib/artifacts"
import { ensureUserWorkspace } from "@/lib/user-workspace"

const PY_BIN = process.env.STEINMETZ_PY || "/home/agent/zap/.venv/bin/python"

function ingestScriptPath(): string {
  if (process.env.STEINMETZ_INGEST_PDF_SCRIPT) return process.env.STEINMETZ_INGEST_PDF_SCRIPT
  return path.join(process.cwd(), "scripts", "ingest_pdf.py")
}

// PDF upload route (ROADMAP §1, §3 — LOOP_QUEUE item 11). Accepts a single
// PDF file in multipart/form-data, writes it under
// `<workspace>/sources/<slug>/v<N>/` (versioned), creates a `source_document`
// artifact in `pipeline_status='queued'`, and kicks off a detached Python
// ingestion process that extracts text, chunks, embeds, and updates the
// workspace's glossary.md + company-context.md.
//
// If the slug already exists for this user, the new upload becomes a child
// of the prior artifact (`parent_id`), so the ingestion script can compute a
// diff view spec.
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

  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing 'file' field (PDF upload)" }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 })
  }
  const nameInput = (form.get("name") as string | null)?.trim() || file.name || "Uploaded PDF"
  const slugInput = (form.get("slug") as string | null)?.trim() || ""
  const sessionId = (form.get("session") as string | null)?.trim() || null

  const slug = slugify(slugInput || stripExt(file.name) || nameInput) || `source-${Date.now()}`

  const workspace = await ensureUserWorkspace(user.id)

  // Look up prior versions by user + slug to chain parent_id and bump version.
  const { data: priorRows } = await supabase
    .from("artifacts")
    .select("id, metadata")
    .eq("user_id", user.id)
    .eq("kind", "source_document")
    .eq("slug", slug)
    .order("created_at", { ascending: false })
    .limit(1)
  const prior = priorRows?.[0] as { id: string; metadata: Record<string, unknown> } | undefined
  const priorVersion = Number(prior?.metadata?.version ?? 0) || 0
  const version = priorVersion + 1

  const versionDir = path.join(workspace, "sources", slug, `v${version}`)
  await fs.mkdir(versionDir, { recursive: true })
  const safeName = sanitizeFilename(file.name) || `source-${version}.pdf`
  const pdfPath = path.join(versionDir, safeName)
  const buf = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(pdfPath, buf)

  const artifact = await createArtifact({
    kind: "source_document",
    name: nameInput,
    slug,
    fs_path: pdfPath,
    parent_id: prior?.id ?? null,
    parent_session_id: sessionId ?? undefined,
    status: "draft",
    metadata: {
      pipeline_status: "queued",
      uploaded_at: new Date().toISOString(),
      uploaded_file: safeName,
      uploaded_bytes: buf.length,
      version,
      mime: file.type || "application/pdf",
    },
    view_spec: {
      renderer: "markdown",
    },
  })

  spawnIngestion(artifact.id, pdfPath, workspace)

  return NextResponse.json(artifact, { status: 201 })
}

function spawnIngestion(artifactId: string, pdfPath: string, workspace: string) {
  const child = spawn(
    PY_BIN,
    [
      ingestScriptPath(),
      "--artifact-id",
      artifactId,
      "--pdf",
      pdfPath,
      "--workspace",
      workspace,
    ],
    {
      detached: true,
      stdio: "ignore",
      cwd: process.cwd(),
      env: { ...process.env },
    },
  )
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

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "")
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name)
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_")
}

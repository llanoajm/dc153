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

// Universal source-document upload (ROADMAP §1, LOOP_QUEUE item 13).
// Accepts PDF, PPTX, image (PNG/JPEG/GIF/WEBP), and audio (MP3/WAV/M4A/OGG/
// FLAC) in multipart/form-data. Dispatches by mime/extension to the matching
// ingestion script. Each upload writes a `source_document` artifact and a
// versioned file under `<workspace>/sources/<slug>/v<N>/` — same versioning
// convention as the existing PDF route, so re-uploading the same slug chains
// `parent_id`.
//
// The ingester runs detached: this route returns immediately with the new
// artifact and the panel polls for `metadata.pipeline_status` transitions.

type IngesterKind = "pdf" | "pptx" | "image" | "audio"

interface IngesterConfig {
  kind: IngesterKind
  script: string
  flag: string
  mediaType: string
  defaultExt: string
  rendererHint: string
}

const INGESTERS: Record<IngesterKind, IngesterConfig> = {
  pdf: {
    kind: "pdf",
    script: "ingest_pdf.py",
    flag: "--pdf",
    mediaType: "application/pdf",
    defaultExt: ".pdf",
    rendererHint: "markdown",
  },
  pptx: {
    kind: "pptx",
    script: "ingest_pptx.py",
    flag: "--pptx",
    mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    defaultExt: ".pptx",
    rendererHint: "markdown",
  },
  image: {
    kind: "image",
    script: "ingest_image.py",
    flag: "--image",
    mediaType: "image/*",
    defaultExt: ".png",
    rendererHint: "markdown",
  },
  audio: {
    kind: "audio",
    script: "ingest_audio.py",
    flag: "--audio",
    mediaType: "audio/*",
    defaultExt: ".mp3",
    rendererHint: "markdown",
  },
}

const EXT_MAP: Record<string, IngesterKind> = {
  ".pdf": "pdf",
  ".pptx": "pptx",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".bmp": "image",
  ".tif": "image",
  ".tiff": "image",
  ".mp3": "audio",
  ".wav": "audio",
  ".m4a": "audio",
  ".ogg": "audio",
  ".oga": "audio",
  ".flac": "audio",
}

function detectKind(file: File): IngesterKind | null {
  const ext = path.extname(file.name).toLowerCase()
  if (ext in EXT_MAP) return EXT_MAP[ext]
  const type = (file.type || "").toLowerCase()
  if (type === "application/pdf") return "pdf"
  if (type === INGESTERS.pptx.mediaType) return "pptx"
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("audio/")) return "audio"
  return null
}

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
    return NextResponse.json(
      { error: "missing 'file' field" },
      { status: 400 },
    )
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 })
  }

  // HARDENING §2.3: reject uploads from over-quota users before any disk
  // write or detached spawn.
  const quota = await checkUserQuota(user.id)
  if (!quota.ok) {
    return NextResponse.json(
      { error: quota.reason, message: quota.message },
      { status: 507 },
    )
  }

  const kind = detectKind(file)
  if (!kind) {
    return NextResponse.json(
      {
        error: `unsupported file type: ${file.type || path.extname(file.name) || "unknown"}`,
        supported: Object.keys(EXT_MAP),
      },
      { status: 415 },
    )
  }
  const cfg = INGESTERS[kind]

  const nameInput = (form.get("name") as string | null)?.trim() || file.name || `Uploaded ${kind}`
  const slugInput = (form.get("slug") as string | null)?.trim() || ""
  const sessionId = (form.get("session") as string | null)?.trim() || null
  const slug = slugify(slugInput || stripExt(file.name) || nameInput) || `source-${Date.now()}`

  const workspace = await ensureUserWorkspace(user.id)

  // Chain prior versions by user+slug, matching the PDF route's convention.
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
  const safeName = sanitizeFilename(file.name) || `source-${version}${cfg.defaultExt}`
  const filePath = path.join(versionDir, safeName)
  const buf = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(filePath, buf)

  // HARDENING §2.2: bucket-gated ingestion. Vision / audio captioning chews
  // CPU + outbound OpenRouter quota, so the same caps apply.
  const admission = await acquireSlot({
    userId: user.id,
    tool: `upload__${cfg.kind}`,
    args: { slug, version, kind: cfg.kind },
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

  const artifact = await createArtifact({
    kind: "source_document",
    name: nameInput,
    slug,
    fs_path: filePath,
    parent_id: prior?.id ?? null,
    parent_session_id: sessionId ?? undefined,
    status: "draft",
    metadata: {
      pipeline_status: "queued",
      uploaded_at: new Date().toISOString(),
      uploaded_file: safeName,
      uploaded_bytes: buf.length,
      version,
      mime: file.type || cfg.mediaType,
      source_kind: cfg.kind,
    },
    view_spec: {
      renderer: cfg.rendererHint,
    },
  })

  spawnIngestion(cfg, artifact.id, filePath, workspace, admission.token)

  return NextResponse.json(artifact, { status: 201 })
}

function spawnIngestion(
  cfg: IngesterConfig,
  artifactId: string,
  filePath: string,
  workspace: string,
  proceedToken: string,
) {
  const scriptPath = path.join(process.cwd(), "scripts", cfg.script)
  const child = spawn(
    pyInterpreterForWorkspace(workspace),
    [scriptPath, "--artifact-id", artifactId, cfg.flag, filePath, "--workspace", workspace],
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
      error: code === 0 ? null : `${cfg.kind} ingester exited ${code}`,
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

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "")
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name)
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_")
}

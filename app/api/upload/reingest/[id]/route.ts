import { NextRequest, NextResponse } from "next/server"
import path from "node:path"
import { spawn } from "node:child_process"
import { createClient } from "@/lib/supabase/server"
import {
  ensureUserWorkspace,
  pyInterpreterForWorkspace,
  pythonEnv,
} from "@/lib/user-workspace"

function ingestScriptPath(): string {
  if (process.env.STEINMETZ_INGEST_SCRIPT) return process.env.STEINMETZ_INGEST_SCRIPT
  return path.join(process.cwd(), "scripts", "ingest_pypsa_folder.py")
}

// Re-runs ingestion against an existing `network` artifact whose pipeline
// left it in `awaiting_importer` or `failed_validation`. Used after the agent
// writes a custom importer to `features/import_<slug>.py`: the importer
// matches the schema fingerprint, converts the raw upload to a PyPSA folder,
// and the same pipeline takes over from `embedded` through `ready`.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data: artifact, error } = await supabase
    .from("artifacts")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!artifact) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (artifact.kind !== "network") {
    return NextResponse.json({ error: "not a network artifact" }, { status: 400 })
  }

  // `fs_path` may point at the converted PyPSA folder from a previous run;
  // walk up to the upload's raw/ folder so the converter chain starts fresh.
  const rawDir = resolveRawDir(artifact.fs_path)
  if (!rawDir) {
    return NextResponse.json(
      { error: "artifact has no recognizable raw upload path" },
      { status: 400 },
    )
  }

  // Reset pipeline_status to queued; the detached process will move it
  // forward (or back to awaiting_importer if still unmatched).
  const metadata = { ...(artifact.metadata ?? {}), pipeline_status: "queued" }
  delete (metadata as Record<string, unknown>).pipeline_error
  await supabase
    .from("artifacts")
    .update({ metadata, status: "draft" })
    .eq("id", id)

  const workspace = await ensureUserWorkspace(user.id)
  spawnIngestion(id, rawDir, workspace)
  return NextResponse.json({ ok: true, artifact_id: id, folder: rawDir })
}

function resolveRawDir(fsPath: string | null): string | null {
  if (!fsPath) return null
  // fs_path can point at the raw upload, a wrapper subdir under it, or a
  // ``converted/`` sibling produced by an earlier converter. Walk back to
  // ``<workspace>/sources/<slug>/raw`` so the converter chain re-runs from
  // the top.
  const parts = fsPath.split(path.sep)
  const sourcesIdx = parts.lastIndexOf("sources")
  if (sourcesIdx === -1 || sourcesIdx + 1 >= parts.length) return null
  return [...parts.slice(0, sourcesIdx + 2), "raw"].join(path.sep)
}

function spawnIngestion(artifactId: string, folder: string, workspace: string) {
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
  child.unref()
}

import { NextRequest, NextResponse } from "next/server"
import path from "node:path"
import { spawn } from "node:child_process"
import { createClient } from "@/lib/supabase/server"
import { ensureUserWorkspace, pythonEnv } from "@/lib/user-workspace"
import { acquireSlot, releaseTokenAsync } from "@/lib/proceed"

const PY_BIN = process.env.STEINMETZ_PY || "/home/agent/zap/.venv/bin/python"

function fetchScriptPath(): string {
  if (process.env.STEINMETZ_FETCH_SCRIPT) return process.env.STEINMETZ_FETCH_SCRIPT
  return path.join(process.cwd(), "scripts", "fetch_url.py")
}

// Agentic data acquisition entrypoint (ROADMAP §6.5, LOOP_QUEUE item 8).
// Accepts a JSON body { url, name?, slug?, license?, checksum?, session? }
// and downloads the URL into <workspace>/sources/<slug>/raw/, creating a
// `network` artifact with source_url/license/fetched_at/checksum metadata.
// Validation re-uses the standard upload ingestion pipeline (spawned
// detached by the Python helper).
//
// The synchronous portion waits on the download + checksum + DB insert so the
// caller knows whether the fetch itself succeeded; the long-running parse
// + smoke-dispatch runs in the background.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: {
    url?: string
    name?: string
    slug?: string
    license?: string
    checksum?: string
    session?: string
  }
  try {
    body = await req.json()
  } catch (e) {
    return NextResponse.json({ error: `bad json body: ${e}` }, { status: 400 })
  }

  const url = (body.url || "").trim()
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 })
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "url must be http(s)" }, { status: 400 })
  }

  const workspace = await ensureUserWorkspace(user.id)

  const args = [
    fetchScriptPath(),
    "--workspace",
    workspace,
    "--url",
    url,
    "--user-id",
    user.id,
  ]
  if (body.name) args.push("--name", body.name)
  if (body.slug) args.push("--slug", body.slug)
  if (body.license) args.push("--license", body.license)
  if (body.checksum) args.push("--checksum", body.checksum)
  if (body.session) args.push("--session-id", body.session)

  // HARDENING §2.2: gate the fetch through the same per-user / global bucket
  // as the upload routes. The synchronous portion of the script holds the
  // slot; the detached ingest it kicks off at the very end runs unmetered
  // (acceptable — the agent can't queue another via this endpoint until the
  // sync part has released).
  const admission = await acquireSlot({
    userId: user.id,
    tool: "fetch_network",
    args: { url, slug: body.slug ?? null },
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

  // Wait on the fetch script — it does the download synchronously and only
  // spawns the long-running ingest at the very end. Typical run is seconds
  // for a single CSV / .m file, up to ~30s for a moderate zip.
  let result: FetchResult
  try {
    result = await runFetch(args, workspace)
  } catch (e) {
    await releaseTokenAsync({
      token: admission.token,
      status: "error",
      error: String(e),
    })
    throw e
  }
  await releaseTokenAsync({
    token: admission.token,
    status: result.status === 0 ? "ok" : "error",
    error:
      result.status === 0
        ? null
        : String(result.payload?.error || `fetch exited ${result.status}`),
  })
  if (result.status !== 0) {
    return NextResponse.json(
      { error: result.payload?.error || "fetch_failed", detail: result.payload },
      { status: result.status === 2 ? 422 : 500 },
    )
  }
  return NextResponse.json(result.payload, { status: 201 })
}

interface FetchResult {
  status: number
  payload: Record<string, unknown> | null
}

function runFetch(args: string[], workspace: string): Promise<FetchResult> {
  return new Promise((resolve) => {
    const child = spawn(PY_BIN, args, {
      cwd: process.cwd(),
      env: pythonEnv(workspace),
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (b) => {
      stdout += b.toString()
    })
    child.stderr.on("data", (b) => {
      stderr += b.toString()
    })
    child.on("close", (code) => {
      const exit = code ?? 0
      let payload: Record<string, unknown> | null = null
      // Script prints exactly one JSON line on success or error.
      const line = stdout.trim().split("\n").pop() || ""
      if (line) {
        try {
          payload = JSON.parse(line) as Record<string, unknown>
        } catch {
          payload = { raw: line }
        }
      }
      if (!payload && stderr) {
        payload = { error: "fetch_failed", stderr: stderr.slice(-2000) }
      }
      resolve({ status: exit, payload })
    })
    child.on("error", (err) => {
      resolve({ status: 1, payload: { error: "spawn_failed", detail: String(err) } })
    })
  })
}

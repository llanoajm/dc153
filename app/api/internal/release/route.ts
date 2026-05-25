import { NextRequest, NextResponse } from "next/server"
import { release, sweep } from "@/lib/concurrency"
import { serviceClient } from "@/lib/supabase/service"

// HARDENING §2.2 — `may_I_proceed()` release endpoint.
//
// Body: { token, status?, runtime_ms?, error? }
//   - token is the value returned by /api/internal/proceed.
//   - status defaults to 'ok'; pass 'error' on a tool exception.
//   - runtime_ms is optional — release computes it from the in-memory record
//     if not supplied (so callers that don't track their own timer work too).
//
// Auth: shared bearer (`STEINMETZ_INTERNAL_TOKEN`). 401 without it.

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.STEINMETZ_INTERNAL_TOKEN
  if (!expected) return false
  const got = req.headers.get("authorization") ?? ""
  const want = `Bearer ${expected}`
  if (got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) {
    diff |= got.charCodeAt(i) ^ want.charCodeAt(i)
  }
  return diff === 0
}

async function markOrphaned(tokens: { token: string; runtimeMs: number }[]) {
  if (tokens.length === 0) return
  try {
    const sb = serviceClient()
    const now = new Date().toISOString()
    for (const t of tokens) {
      await sb
        .from("tool_runs")
        .update({
          status: "orphaned",
          ended_at: now,
          runtime_ms: t.runtimeMs,
          error: "no release received before deadline",
        })
        .eq("token", t.token)
        .eq("status", "running")
    }
  } catch (e) {
    console.error("[release] orphan-sweep update failed:", e)
  }
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  let body: {
    token?: string
    status?: string
    runtime_ms?: number
    error?: string
  }
  try {
    body = await req.json()
  } catch (e) {
    return NextResponse.json({ error: `bad json body: ${e}` }, { status: 400 })
  }

  const token = (body.token || "").trim()
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 })
  }
  const incomingStatus = (body.status || "ok").trim()
  const status = incomingStatus === "error" ? "error" : "ok"

  // Sweep first so orphan rows get cleaned up alongside this release.
  const reclaimed = sweep()
  if (reclaimed.length > 0) {
    await markOrphaned(
      reclaimed.map((r) => ({ token: r.token, runtimeMs: r.runtimeMs })),
    )
  }

  const result = release(token)
  // The in-memory record may have been swept (orphaned) before this call
  // arrived. We still want to finalize the DB row, so fall back to a plain
  // ended_at write keyed by token.
  const runtimeMs =
    typeof body.runtime_ms === "number" && body.runtime_ms >= 0
      ? Math.floor(body.runtime_ms)
      : result?.runtimeMs ?? null

  try {
    const sb = serviceClient()
    const update: Record<string, unknown> = {
      status,
      ended_at: new Date().toISOString(),
      runtime_ms: runtimeMs,
    }
    if (body.error) update.error = String(body.error).slice(0, 4000)
    const { error } = await sb
      .from("tool_runs")
      .update(update)
      .eq("token", token)
    if (error) throw error
  } catch (e) {
    console.error("[release] update failed:", e)
  }

  return NextResponse.json({
    released: result !== null,
    runtime_ms: runtimeMs,
    status,
  })
}

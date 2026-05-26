import { NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import { acquire, digestArgs, sweep } from "@/lib/concurrency"
import { serviceClient } from "@/lib/supabase/service"
import { sanitizeBearerTokenEnv } from "@/lib/bearer-token-validation"

// HARDENING §2.2 — `may_I_proceed()` admission endpoint.
//
// Called by:
//   * scripts/user-mcp-server.py (Python) before invoking a feature.
//   * grid-app upload / fetch routes before spawning a detached ingester.
//
// Auth: shared bearer token (`STEINMETZ_INTERNAL_TOKEN`). NOT user-scoped —
// the MCP server runs out of opencode and doesn't have a Supabase session;
// the user_id is supplied in the body and trusted because only internal
// callers know the bearer.
//
// Body: { user_id, tool, args_digest?, estimated_seconds? }
// Returns:
//   200 { token, deadline, run_id } if a slot was reserved
//   429 { retry_after, reason }     if over a per-user / global cap
//   401 { error }                   if the bearer is missing/wrong
//
// Side effects: writes a `tool_runs` row (status='running' for 200, 'rejected'
// for 429) via the service-role client. Any tokens reclaimed by the in-memory
// sweep get their `tool_runs` row flipped to 'orphaned' on the same call.

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

function checkAuth(req: NextRequest): boolean {
  const expected = sanitizeBearerTokenEnv("STEINMETZ_INTERNAL_TOKEN")
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
    console.error("[proceed] orphan-sweep update failed:", e)
  }
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  let body: {
    user_id?: string
    tool?: string
    args_digest?: string | null
    args?: unknown
    estimated_seconds?: number | null
  }
  try {
    body = await req.json()
  } catch (e) {
    return NextResponse.json({ error: `bad json body: ${e}` }, { status: 400 })
  }

  const userId = (body.user_id || "").trim()
  const tool = (body.tool || "").trim()
  if (!userId || !tool) {
    return NextResponse.json({ error: "user_id and tool are required" }, { status: 400 })
  }
  const argsDigest =
    body.args_digest ?? (body.args !== undefined ? digestArgs(body.args) : null)

  // Run a sweep on every admission decision; surface reclaimed tokens to the
  // audit table so the live-status view doesn't keep showing dead runs.
  const reclaimed = sweep()
  if (reclaimed.length > 0) {
    await markOrphaned(
      reclaimed.map((r) => ({ token: r.token, runtimeMs: r.runtimeMs })),
    )
  }

  const result = acquire({
    userId,
    tool,
    argsDigest,
    estimatedSeconds: body.estimated_seconds ?? null,
  })

  const sb = serviceClient()

  if (!result.ok) {
    // Still record the attempt so users can see "you got rate-limited at HH:MM".
    try {
      await sb.from("tool_runs").insert({
        user_id: userId,
        tool,
        args_digest: argsDigest,
        token: `rejected:${crypto.randomUUID()}`,
        status: "rejected",
        ended_at: new Date().toISOString(),
        runtime_ms: 0,
        error: result.reason,
      })
    } catch (e) {
      console.error("[proceed] rejected-row insert failed:", e)
    }
    return NextResponse.json(
      { retry_after: result.retryAfter, reason: result.reason },
      { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
    )
  }

  const record = result.record
  try {
    const { data, error } = await sb
      .from("tool_runs")
      .insert({
        user_id: userId,
        tool,
        args_digest: argsDigest,
        token: record.token,
        started_at: new Date(record.startedAt).toISOString(),
        expected_deadline: new Date(record.expectedDeadline).toISOString(),
        status: "running",
      })
      .select("id")
      .single()
    if (error) throw error
    return NextResponse.json({
      token: record.token,
      deadline: new Date(record.expectedDeadline).toISOString(),
      run_id: data?.id ?? null,
    })
  } catch (e) {
    console.error("[proceed] running-row insert failed:", e)
    // The slot is reserved in memory either way — don't block the caller.
    return NextResponse.json({
      token: record.token,
      deadline: new Date(record.expectedDeadline).toISOString(),
      run_id: null,
    })
  }
}

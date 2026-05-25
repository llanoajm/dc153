import "server-only"
import crypto from "node:crypto"
import { acquire, digestArgs, release as releaseSlot, sweep } from "@/lib/concurrency"
import { serviceClient } from "@/lib/supabase/service"

// Direct call into the same concurrency core that /api/internal/proceed and
// /api/internal/release use. The upload + fetch routes already authenticate
// the caller via Supabase, so they don't need to round-trip through the
// internal-bearer HTTP endpoints — they can talk to the bucket in-process.
// This keeps the policy unified (HARDENING §2.2: "existing detached-spawn
// upload routes call the same endpoints") while skipping the bearer-loopback
// that would only be needed if the caller were out-of-process.

export interface AdmissionGranted {
  ok: true
  token: string
  deadline: string
}

export interface AdmissionDenied {
  ok: false
  retryAfter: number
  reason: "per_user_limit" | "global_limit"
}

async function markStaleAsOrphaned(
  reclaimed: { token: string; runtimeMs: number }[],
) {
  if (reclaimed.length === 0) return
  try {
    const sb = serviceClient()
    const now = new Date().toISOString()
    for (const r of reclaimed) {
      await sb
        .from("tool_runs")
        .update({
          status: "orphaned",
          ended_at: now,
          runtime_ms: r.runtimeMs,
          error: "no release received before deadline",
        })
        .eq("token", r.token)
        .eq("status", "running")
    }
  } catch (e) {
    console.error("[proceed-helper] orphan sweep failed:", e)
  }
}

export async function acquireSlot(opts: {
  userId: string
  tool: string
  args?: unknown
  estimatedSeconds?: number
}): Promise<AdmissionGranted | AdmissionDenied> {
  await markStaleAsOrphaned(sweep())
  const argsDigest = opts.args !== undefined ? digestArgs(opts.args) : null
  const result = acquire({
    userId: opts.userId,
    tool: opts.tool,
    argsDigest,
    estimatedSeconds: opts.estimatedSeconds ?? null,
  })
  const sb = serviceClient()
  if (!result.ok) {
    try {
      await sb.from("tool_runs").insert({
        user_id: opts.userId,
        tool: opts.tool,
        args_digest: argsDigest,
        token: `rejected:${crypto.randomUUID()}`,
        status: "rejected",
        ended_at: new Date().toISOString(),
        runtime_ms: 0,
        error: result.reason,
      })
    } catch (e) {
      console.error("[proceed-helper] rejected-row insert failed:", e)
    }
    return { ok: false, retryAfter: result.retryAfter, reason: result.reason }
  }
  try {
    await sb.from("tool_runs").insert({
      user_id: opts.userId,
      tool: opts.tool,
      args_digest: argsDigest,
      token: result.record.token,
      started_at: new Date(result.record.startedAt).toISOString(),
      expected_deadline: new Date(result.record.expectedDeadline).toISOString(),
      status: "running",
    })
  } catch (e) {
    console.error("[proceed-helper] running-row insert failed:", e)
  }
  return {
    ok: true,
    token: result.record.token,
    deadline: new Date(result.record.expectedDeadline).toISOString(),
  }
}

export async function releaseTokenAsync(opts: {
  token: string
  status: "ok" | "error"
  error?: string | null
}): Promise<void> {
  await markStaleAsOrphaned(sweep())
  const result = releaseSlot(opts.token)
  const runtimeMs = result?.runtimeMs ?? null
  try {
    const sb = serviceClient()
    const update: Record<string, unknown> = {
      status: opts.status,
      ended_at: new Date().toISOString(),
      runtime_ms: runtimeMs,
    }
    if (opts.error) update.error = String(opts.error).slice(0, 4000)
    await sb.from("tool_runs").update(update).eq("token", opts.token)
  } catch (e) {
    console.error("[proceed-helper] release update failed:", e)
  }
}

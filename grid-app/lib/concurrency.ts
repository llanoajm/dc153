import "server-only"
import crypto from "node:crypto"

// In-memory token bucket for `may_I_proceed()` (HARDENING §2.2).
//
// The MCP server (and the detached-spawn upload routes) call grid-app's
// `/api/internal/proceed` before running a tool and `/api/internal/release`
// when it finishes. This module is the policy core both endpoints share:
// per-user and global slot caps, token issuance, and a stale-token sweep that
// frees slots whose `expected_deadline + grace` has elapsed with no release.
//
// Honest-broker by design: a malicious feature could skip the proceed call.
// Kernel-enforced limits are Phase 3 (systemd resource slices). This layer
// stays as the visibility, audit, and queueing UX.
//
// State lives at module scope so it persists across requests within a single
// Node process — which is what the single-VM target end state assumes. If we
// ever ship multiple Next.js workers, this module needs an external store.

const PER_USER_LIMIT = readPositiveInt(process.env.STEINMETZ_CONCURRENCY_PER_USER, 1)
const GLOBAL_LIMIT = readPositiveInt(process.env.STEINMETZ_CONCURRENCY_GLOBAL, 3)
const DEFAULT_DEADLINE_MS = readPositiveInt(
  process.env.STEINMETZ_CONCURRENCY_DEFAULT_DEADLINE_MS,
  10 * 60 * 1000, // 10 minutes
)
const GRACE_MS = readPositiveInt(
  process.env.STEINMETZ_CONCURRENCY_GRACE_MS,
  30 * 1000, // 30 seconds past the deadline before a slot is reclaimed
)

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export interface SlotRecord {
  token: string
  userId: string
  tool: string
  argsDigest: string | null
  startedAt: number
  expectedDeadline: number
}

export interface AcquireRequest {
  userId: string
  tool: string
  argsDigest?: string | null
  estimatedSeconds?: number | null
}

export interface AcquireResult {
  ok: true
  record: SlotRecord
  retryAfter?: undefined
  reason?: undefined
}

export interface AcquireRejection {
  ok: false
  retryAfter: number
  reason: "per_user_limit" | "global_limit"
}

const active = new Map<string, SlotRecord>()

export function acquire(req: AcquireRequest): AcquireResult | AcquireRejection {
  sweep()
  if (active.size >= GLOBAL_LIMIT) {
    return { ok: false, retryAfter: 5, reason: "global_limit" }
  }
  let perUser = 0
  for (const r of active.values()) {
    if (r.userId === req.userId) perUser += 1
    if (perUser >= PER_USER_LIMIT) {
      return { ok: false, retryAfter: 5, reason: "per_user_limit" }
    }
  }
  const now = Date.now()
  const ttl =
    req.estimatedSeconds && req.estimatedSeconds > 0
      ? Math.floor(req.estimatedSeconds * 1000)
      : DEFAULT_DEADLINE_MS
  const record: SlotRecord = {
    token: crypto.randomUUID(),
    userId: req.userId,
    tool: req.tool,
    argsDigest: req.argsDigest ?? null,
    startedAt: now,
    expectedDeadline: now + ttl,
  }
  active.set(record.token, record)
  return { ok: true, record }
}

export interface ReleaseResult {
  record: SlotRecord
  runtimeMs: number
}

// Returns the record that was released, plus its measured runtime. Returns
// `null` if the token was unknown (e.g. already reclaimed by the sweep).
export function release(token: string): ReleaseResult | null {
  sweep()
  const record = active.get(token)
  if (!record) return null
  active.delete(token)
  return { record, runtimeMs: Date.now() - record.startedAt }
}

export interface StaleRecord extends SlotRecord {
  runtimeMs: number
}

// Drop any tokens whose `expected_deadline + GRACE_MS` has passed. Returns
// the list of records that were reclaimed so callers can mark the matching
// `tool_runs` rows as `orphaned`.
export function sweep(): StaleRecord[] {
  const now = Date.now()
  const reclaimed: StaleRecord[] = []
  for (const [token, record] of active) {
    if (record.expectedDeadline + GRACE_MS <= now) {
      active.delete(token)
      reclaimed.push({ ...record, runtimeMs: now - record.startedAt })
    }
  }
  return reclaimed
}

export interface ConcurrencySnapshot {
  active: SlotRecord[]
  perUserLimit: number
  globalLimit: number
}

export function snapshot(): ConcurrencySnapshot {
  return {
    active: Array.from(active.values()),
    perUserLimit: PER_USER_LIMIT,
    globalLimit: GLOBAL_LIMIT,
  }
}

// Test-only reset. Not exported by name in production paths.
export function _resetForTest(): void {
  active.clear()
}

// Compute a stable args digest for the `tool_runs` audit column. Callers can
// pass their own digest if they have a more meaningful canonicalization; this
// is the safe default.
export function digestArgs(value: unknown): string {
  let canonical: string
  try {
    canonical = JSON.stringify(value ?? {}, Object.keys(value ?? {}).sort())
  } catch {
    canonical = String(value)
  }
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32)
}

export const concurrencyConfig = {
  perUserLimit: PER_USER_LIMIT,
  globalLimit: GLOBAL_LIMIT,
  defaultDeadlineMs: DEFAULT_DEADLINE_MS,
  graceMs: GRACE_MS,
}

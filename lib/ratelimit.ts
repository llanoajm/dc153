// Lightweight in-memory token bucket. Per-process, per-key.
// Fine for single-instance Vercel free / local dev. For multi-region, swap to Upstash.

type Bucket = { tokens: number; lastRefill: number }
const buckets = new Map<string, Bucket>()

export function allowRequest(key: string, capacity: number, refillIntervalMs: number): boolean {
  const now = Date.now()
  const b = buckets.get(key) ?? { tokens: capacity, lastRefill: now }
  const elapsed = now - b.lastRefill
  const refill = (elapsed / refillIntervalMs) * capacity
  b.tokens = Math.min(capacity, b.tokens + refill)
  b.lastRefill = now
  if (b.tokens >= 1) {
    b.tokens -= 1
    buckets.set(key, b)
    return true
  }
  buckets.set(key, b)
  return false
}

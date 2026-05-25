import "server-only"
import { serviceClient } from "@/lib/supabase/service"

// HARDENING §2.3 — disk-quota tripwire.
//
// scripts/quota_check.sh walks every workspace, measures `du -sb`, and flips
// `profiles.over_quota=true` once a user crosses 80% of the soft cap (5GB
// default). Upload routes call `assertWithinQuota(userId)` before writing
// bytes to disk; if the caller is over-quota, the route returns 507
// Insufficient Storage with a clear error string.
//
// Reads go through the service-role client because grid-app routes spawn
// detached children that need a server-trusted bool; we don't lean on RLS
// here. The column is also visible to the user via the regular profiles
// select-own policy so the UI can surface a "you're out of room" banner.

export interface QuotaOk {
  ok: true
}

export interface QuotaBlocked {
  ok: false
  reason: "over_quota"
  message: string
}

const BLOCKED_MESSAGE =
  "Your workspace is over its disk quota. Delete or download sources to free space, then retry the upload."

export async function checkUserQuota(
  userId: string,
): Promise<QuotaOk | QuotaBlocked> {
  try {
    const sb = serviceClient()
    const { data, error } = await sb
      .from("profiles")
      .select("over_quota")
      .eq("id", userId)
      .maybeSingle()
    if (error) {
      // Column missing (schema not pasted yet) or other DB-side noise — fail
      // open so we don't accidentally block every upload before the user has
      // applied the schema update.
      console.error("[quota] read failed (fail-open):", error.message)
      return { ok: true }
    }
    if (data?.over_quota === true) {
      return { ok: false, reason: "over_quota", message: BLOCKED_MESSAGE }
    }
    return { ok: true }
  } catch (e) {
    console.error("[quota] check threw (fail-open):", e)
    return { ok: true }
  }
}

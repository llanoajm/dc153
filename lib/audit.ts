import "server-only"
import { serviceClient } from "@/lib/supabase/service"

// Audit log writer (ROADMAP §9 / LOOP_QUEUE item 15). Every artifact write +
// every agent/reviewer decision lands here so an admin can reconstruct the
// chain "this canonical feature was drafted by intake → reviewed by reviewer
// → edited by user → re-reviewed → promoted to canonical".
//
// Uses the service-role client so reviewer / server routes can insert rows on
// behalf of any user; the audit_log RLS policy only grants SELECT to users
// for their own / their org's rows (no INSERT policy on purpose).
export interface AuditInput {
  user_id: string | null
  org_id?: string | null
  artifact_id?: string | null
  action: string
  actor?: "user" | "agent" | "reviewer" | "system"
  payload?: Record<string, unknown>
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const client = serviceClient()
    const { error } = await client.from("audit_log").insert({
      user_id: input.user_id,
      org_id: input.org_id ?? null,
      artifact_id: input.artifact_id ?? null,
      action: input.action,
      actor: input.actor ?? "user",
      payload: input.payload ?? {},
    })
    if (error) {
      console.error("[audit] insert failed:", error.message)
    }
  } catch (e) {
    // Audit failures must never crash a request — log and move on.
    console.error("[audit] unexpected:", e)
  }
}

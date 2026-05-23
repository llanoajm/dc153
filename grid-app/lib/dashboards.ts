import "server-only"
import { createClient } from "@/lib/supabase/server"
import type { Artifact } from "@/lib/artifacts"

// Helpers for the dashboards-as-artifacts surface (ROADMAP §11.8). A dashboard
// is any artifact with `kind in ('dashboard', 'view')` and a panels list on
// its view_spec; "pinned" lives on `metadata.pinned = true` so an author can
// flip the flag with a PATCH on the artifact row without a side table.

export const DASHBOARD_KINDS = ["dashboard", "view"] as const

export type DashboardKind = (typeof DASHBOARD_KINDS)[number]

export function isDashboardArtifact(a: Artifact): boolean {
  return DASHBOARD_KINDS.includes(a.kind as DashboardKind) && hasPanels(a.view_spec)
}

export function isPinned(a: Artifact): boolean {
  const v = a.metadata?.pinned
  return v === true
}

function hasPanels(view: unknown): boolean {
  if (!view || typeof view !== "object") return false
  const panels = (view as Record<string, unknown>).panels
  return Array.isArray(panels) && panels.length > 0
}

// List the user's pinned dashboards. Used by the workspace shell to materialize
// rail entries. Server-only; relies on RLS so the calling user only sees rows
// they own or are scoped into.
export async function listPinnedDashboards(): Promise<Artifact[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .in("kind", [...DASHBOARD_KINDS])
    .eq("metadata->>pinned", "true")
    .order("updated_at", { ascending: false })
    .limit(20)
  if (error) {
    console.warn("[dashboards] listPinned failed:", error.message)
    return []
  }
  return (data ?? []) as Artifact[]
}

// List every dashboard visible to the caller (pinned or not).
export async function listDashboards(): Promise<Artifact[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .in("kind", [...DASHBOARD_KINDS])
    .order("updated_at", { ascending: false })
    .limit(100)
  if (error) {
    console.warn("[dashboards] list failed:", error.message)
    return []
  }
  return (data ?? []) as Artifact[]
}

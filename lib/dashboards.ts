import "server-only"
import { createClient } from "@/lib/supabase/server"
import type { Artifact } from "@/lib/artifacts"

// Helpers for the dashboards-as-artifacts surface (ROADMAP §11.8). A dashboard
// is any artifact with `kind in ('dashboard', 'view')` and a panels list on
// its view_spec; "pinned" lives on `metadata.pinned = true` so an author can
// flip the flag with a PATCH on the artifact row without a side table.

export const DASHBOARD_KINDS = ["dashboard", "view"] as const
export const PANEL_KINDS = ["panel"] as const
// Anything that may be pinned to the workspace rail — dashboards (multi-panel
// compositions) and sandboxed agent-authored panels (ROADMAP §11.8).
export const PINNABLE_KINDS = [...DASHBOARD_KINDS, ...PANEL_KINDS] as const

export type DashboardKind = (typeof DASHBOARD_KINDS)[number]
export type PanelKind = (typeof PANEL_KINDS)[number]
export type PinnableKind = DashboardKind | PanelKind

export function isDashboardArtifact(a: Artifact): boolean {
  return DASHBOARD_KINDS.includes(a.kind as DashboardKind) && hasPanels(a.view_spec)
}

// True when the artifact is a sandboxed custom panel (kind='panel') with a
// `root` node on its view_spec. The pin button uses this alongside
// `isDashboardArtifact` to decide whether the artifact is rail-eligible.
export function isPanelArtifact(a: Artifact): boolean {
  if (!PANEL_KINDS.includes(a.kind as PanelKind)) return false
  const view = a.view_spec
  if (!view || typeof view !== "object") return false
  return Boolean((view as Record<string, unknown>).root)
}

// True for either a dashboard or a panel artifact. The workspace shell
// surfaces both kinds in the rail's "Pinned" section.
export function isPinnableArtifact(a: Artifact): boolean {
  return isDashboardArtifact(a) || isPanelArtifact(a)
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

// List the user's pinned dashboards AND panels. Used by the workspace shell
// to materialize rail entries. Server-only; relies on RLS so the calling user
// only sees rows they own or are scoped into.
export async function listPinnedDashboards(): Promise<Artifact[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .in("kind", [...PINNABLE_KINDS])
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

// List every sandboxed panel visible to the caller (pinned or not). Powers
// `/app/panels` and the promotion-ladder UI.
export async function listPanels(): Promise<Artifact[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .in("kind", [...PANEL_KINDS])
    .order("updated_at", { ascending: false })
    .limit(100)
  if (error) {
    console.warn("[dashboards] listPanels failed:", error.message)
    return []
  }
  return (data ?? []) as Artifact[]
}

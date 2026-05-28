import "server-only"
import { createClient } from "@/lib/supabase/server"
import {
  createWorkspaceWith,
  type Workspace,
  type CreateWorkspaceCoreInput,
} from "@/lib/workspaces-store"

// Workspace DB-access (WORKSPACE_REDESIGN.md §3–§5). A Workspace anchors a
// single primary network (the permanent answer to "which network?") plus an
// intent (focus tags) and its chats/objectives/runs/plans. The `workspaces`
// table is added in supabase/migrations/0001_workspaces.sql; these helpers are
// RLS-scoped via the per-request user client (own personal + member-org rows).
//
// The pure/injectable insert core + the focus-tag catalog live in
// lib/workspaces-store.ts (no `server-only`, so it's unit-testable); this module
// adds the RLS-checked createClient()-backed wrappers the routes call.

export type { Workspace } from "@/lib/workspaces-store"
export { FOCUS_TAGS, sanitizeFocus, type FocusTag } from "@/lib/workspaces-store"

// A workspace plus the resolved name of its primary network, for the gallery
// cards (avoids the client doing a second lookup per card).
export interface WorkspaceCard extends Workspace {
  primary_network_name: string | null
}

export interface CreateWorkspaceInput {
  name: string
  focus?: string[]
  primary_network_id?: string | null
  cover_image_url?: string | null
  org_id?: string | null
}

function normalizeWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row.id as string,
    user_id: (row.user_id as string | null) ?? null,
    org_id: (row.org_id as string | null) ?? null,
    name: (row.name as string) ?? "Untitled workspace",
    focus: Array.isArray(row.focus) ? (row.focus as string[]) : [],
    primary_network_id: (row.primary_network_id as string | null) ?? null,
    cover_image_url: (row.cover_image_url as string | null) ?? null,
    created_at: (row.created_at as string) ?? new Date().toISOString(),
    updated_at: (row.updated_at as string) ?? new Date().toISOString(),
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// List the caller's visible workspaces (most-recently-active first), each with
// its primary network name resolved in a single batched query so the gallery
// renders without per-card lookups.
export async function listMyWorkspaceCards(): Promise<WorkspaceCard[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .order("updated_at", { ascending: false })
  if (error) throw new Error(error.message)
  const workspaces = (data ?? []).map((r) => normalizeWorkspace(r as Record<string, unknown>))

  const networkIds = Array.from(
    new Set(workspaces.map((w) => w.primary_network_id).filter((id): id is string => !!id)),
  )
  const nameById = new Map<string, string>()
  if (networkIds.length > 0) {
    const { data: nets } = await supabase
      .from("artifacts")
      .select("id,name")
      .in("id", networkIds)
    for (const n of nets ?? []) {
      const row = n as { id: string; name: string }
      nameById.set(row.id, row.name)
    }
  }

  return workspaces.map((w) => ({
    ...w,
    primary_network_name: w.primary_network_id
      ? nameById.get(w.primary_network_id) ?? null
      : null,
  }))
}

// Single workspace with its primary network name resolved (the shell reads
// this to show the workspace's one anchored grid at the top of the rail).
export async function getWorkspaceCard(id: string): Promise<WorkspaceCard | null> {
  const workspace = await getWorkspace(id)
  if (!workspace) return null
  let primary_network_name: string | null = null
  if (workspace.primary_network_id) {
    const supabase = await createClient()
    const { data } = await supabase
      .from("artifacts")
      .select("name")
      .eq("id", workspace.primary_network_id)
      .maybeSingle()
    primary_network_name = (data as { name?: string } | null)?.name ?? null
  }
  return { ...workspace, primary_network_name }
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  // A route-shaped (non-uuid) segment should be a clean not-found, not a 500
  // from Postgres' uuid input parser.
  if (!UUID_RE.test(id)) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? normalizeWorkspace(data as Record<string, unknown>) : null
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("unauthorized")

  const coreInput: CreateWorkspaceCoreInput = {
    name: input.name,
    user_id: user.id,
    focus: input.focus,
    primary_network_id: input.primary_network_id ?? null,
    cover_image_url: input.cover_image_url ?? null,
    org_id: input.org_id ?? null,
  }
  const created = await createWorkspaceWith(supabase as never, coreInput)
  return normalizeWorkspace(created as unknown as Record<string, unknown>)
}

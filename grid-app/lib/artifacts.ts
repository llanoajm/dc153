import "server-only"
import { createClient } from "@/lib/supabase/server"

// Default artifact kinds (ROADMAP §11.6). The agent can introduce new kinds at
// runtime — the universal renderer falls back to JSON inspect for unknown
// kinds — so this list is descriptive, not enforced at the DB level.
export const ARTIFACT_KINDS = [
  "source_document",
  "dataset",
  "network",
  "run",
  "feature",
  "skill",
  "glossary",
  "context_doc",
  "report",
  "chat",
  "view",
  "panel",
  "dashboard",
] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number] | string

export type ArtifactStatus =
  | "draft"
  | "canonical"
  | "deprecated"
  | "failed_validation"

// view_spec is intentionally untyped JSON; renderers narrow it themselves.
export interface Artifact {
  id: string
  user_id: string | null
  org_id: string | null
  kind: ArtifactKind
  name: string
  slug: string | null
  fs_path: string | null
  storage_path: string | null
  metadata: Record<string, unknown>
  view_spec: Record<string, unknown>
  parent_id: string | null
  parent_session_id: string | null
  status: ArtifactStatus
  created_at: string
  updated_at: string
}

export interface CreateArtifactInput {
  kind: ArtifactKind
  name: string
  slug?: string | null
  fs_path?: string | null
  storage_path?: string | null
  metadata?: Record<string, unknown>
  view_spec?: Record<string, unknown>
  parent_id?: string | null
  parent_session_id?: string | null
  status?: ArtifactStatus
  org_id?: string | null
}

export interface ListArtifactsOptions {
  kind?: ArtifactKind
  status?: ArtifactStatus
  parent_session_id?: string
  limit?: number
  // `org_id` filters to a specific org. `scope` switches between personal
  // (org_id is null) and all-visible (the default RLS view: own + bundled
  // canonical + every org the user is a member of).
  org_id?: string
  scope?: "personal" | "all"
}

export async function createArtifact(input: CreateArtifactInput): Promise<Artifact> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("unauthorized")

  const row = {
    user_id: user.id,
    org_id: input.org_id ?? null,
    kind: input.kind,
    name: input.name,
    slug: input.slug ?? null,
    fs_path: input.fs_path ?? null,
    storage_path: input.storage_path ?? null,
    metadata: input.metadata ?? {},
    view_spec: input.view_spec ?? {},
    parent_id: input.parent_id ?? null,
    parent_session_id: input.parent_session_id ?? null,
    status: input.status ?? "draft",
  }

  const { data, error } = await supabase
    .from("artifacts")
    .insert(row)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Artifact
}

export async function getArtifact(id: string): Promise<Artifact | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Artifact | null) ?? null
}

export async function listArtifacts(opts: ListArtifactsOptions = {}): Promise<Artifact[]> {
  const supabase = await createClient()
  let q = supabase.from("artifacts").select("*").order("created_at", { ascending: false })
  if (opts.kind) q = q.eq("kind", opts.kind)
  if (opts.status) q = q.eq("status", opts.status)
  if (opts.parent_session_id) q = q.eq("parent_session_id", opts.parent_session_id)
  if (opts.org_id) q = q.eq("org_id", opts.org_id)
  if (opts.scope === "personal") q = q.is("org_id", null)
  if (opts.limit) q = q.limit(opts.limit)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as Artifact[]
}

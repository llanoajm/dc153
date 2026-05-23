import "server-only"
import { createClient } from "@/lib/supabase/server"
import { applyOrgOverlays, type OrgOverlay } from "@/lib/user-workspace"

// Org scopes (ROADMAP §10). An org groups users; artifacts can be `personal`
// (org_id null) or org-scoped (org_id set). Roles: owner > admin > member.
//
// All helpers run RLS-checked through the user's supabase client. Mutations
// that need to sidestep RLS (atomic org+membership creation) go through the
// `create_org` SQL function.
export type OrgRole = "owner" | "admin" | "member"

export interface Org {
  id: string
  name: string
  slug: string
  created_at: string
  created_by: string | null
}

export interface OrgMembership {
  org_id: string
  user_id: string
  role: OrgRole
  created_at: string
  org: Org
}

export async function listMyOrgs(): Promise<OrgMembership[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from("org_members")
    .select("org_id, user_id, role, created_at, org:orgs(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as OrgMembership[]
}

export async function getOrg(idOrSlug: string): Promise<Org | null> {
  const supabase = await createClient()
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug)
  const { data, error } = await supabase
    .from("orgs")
    .select("*")
    .eq(isUuid ? "id" : "slug", idOrSlug)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Org | null) ?? null
}

export async function listOrgMembers(orgId: string): Promise<OrgMembership[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("org_members")
    .select("org_id, user_id, role, created_at, org:orgs(*)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as OrgMembership[]
}

export async function getMyRoleIn(orgId: string): Promise<OrgRole | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.role as OrgRole | undefined) ?? null
}

export async function createOrg(name: string, slug: string): Promise<Org> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_org", {
    p_name: name,
    p_slug: slug,
  })
  if (error) throw new Error(error.message)
  return data as Org
}

export async function addMember(
  orgId: string,
  userId: string,
  role: OrgRole = "member",
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("org_members")
    .insert({ org_id: orgId, user_id: userId, role })
  if (error) throw new Error(error.message)
}

// Pull each org's canonical glossary + context_doc artifacts and write them
// into the workspace as overlay files. Org content loads first; personal
// content layers on top (ROADMAP §10). Called from the app layout on every
// /app request so memberships changing mid-session pick up next visit.
export async function syncOrgContextOverlays(workspaceDir: string): Promise<string[]> {
  const memberships = await listMyOrgs()
  if (memberships.length === 0) {
    return applyOrgOverlays(workspaceDir, [])
  }

  const supabase = await createClient()
  const orgIds = memberships.map((m) => m.org_id)
  const { data, error } = await supabase
    .from("artifacts")
    .select("org_id, kind, name, view_spec, metadata, status, updated_at")
    .in("org_id", orgIds)
    .in("kind", ["glossary", "context_doc"])
    .eq("status", "canonical")
    .order("updated_at", { ascending: false })
  if (error) throw new Error(error.message)

  const byOrg = new Map<string, { glossary?: string; context?: string }>()
  for (const row of (data ?? []) as Array<{
    org_id: string
    kind: string
    view_spec: Record<string, unknown> | null
    metadata: Record<string, unknown> | null
  }>) {
    const slot = byOrg.get(row.org_id) ?? {}
    const text =
      (typeof row.view_spec?.text === "string" && row.view_spec.text) ||
      (typeof row.metadata?.text === "string" && row.metadata.text) ||
      ""
    if (row.kind === "glossary" && !slot.glossary) slot.glossary = text
    if (row.kind === "context_doc" && !slot.context) slot.context = text
    byOrg.set(row.org_id, slot)
  }

  const overlays: OrgOverlay[] = memberships.map((m) => {
    const slot = byOrg.get(m.org_id) ?? {}
    return {
      slug: m.org.slug,
      glossary: slot.glossary,
      context: slot.context,
    }
  })
  return applyOrgOverlays(workspaceDir, overlays)
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64)
}

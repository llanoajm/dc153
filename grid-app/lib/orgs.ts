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

// Active-org state lives on `profiles.active_org_id` (HARDENING §1.3). Null =
// personal mode, no org overlay. Reading is RLS-gated to the caller's own row.
export async function getActiveOrgId(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from("profiles")
    .select("active_org_id")
    .eq("id", user.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.active_org_id as string | null | undefined) ?? null
}

// Set the caller's active org, validating membership first. Pass `null` to
// drop back to personal mode. Throws on non-membership so the calling route
// can return 403.
export async function setActiveOrgId(orgId: string | null): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("unauthorized")
  if (orgId !== null) {
    const role = await getMyRoleIn(orgId)
    if (role === null) throw new Error("forbidden: not a member of that org")
  }
  const { error } = await supabase
    .from("profiles")
    .update({ active_org_id: orgId })
    .eq("id", user.id)
  if (error) throw new Error(error.message)
}

// Pull the *active* org's canonical glossary + context_doc artifacts and
// write them into the workspace as overlay files. Org content loads first;
// personal content layers on top (ROADMAP §10). Non-active overlay files for
// other orgs the user belongs to are dropped — see HARDENING §1.3 (a user in
// multiple orgs must not leak context across them).
//
// `activeOrgId` is optional: when omitted, it's read from
// `profiles.active_org_id` for the current user. When the active id is null
// (personal mode), no overlay files are written and any stale ones are
// removed.
export async function syncOrgContextOverlays(
  workspaceDir: string,
  opts: { activeOrgId?: string | null } = {},
): Promise<string[]> {
  const activeOrgId =
    opts.activeOrgId === undefined ? await getActiveOrgId() : opts.activeOrgId

  if (!activeOrgId) {
    return applyOrgOverlays(workspaceDir, [])
  }

  // Validate that the active org is still one the caller belongs to. If not
  // (e.g. they were removed mid-session), drop back to personal mode rather
  // than stacking the now-unauthorized overlay.
  const memberships = await listMyOrgs()
  const active = memberships.find((m) => m.org_id === activeOrgId)
  if (!active) {
    return applyOrgOverlays(workspaceDir, [])
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("artifacts")
    .select("kind, view_spec, metadata, updated_at")
    .eq("org_id", activeOrgId)
    .in("kind", ["glossary", "context_doc"])
    .eq("status", "canonical")
    .order("updated_at", { ascending: false })
  if (error) throw new Error(error.message)

  let glossary: string | undefined
  let context: string | undefined
  for (const row of (data ?? []) as Array<{
    kind: string
    view_spec: Record<string, unknown> | null
    metadata: Record<string, unknown> | null
  }>) {
    const text =
      (typeof row.view_spec?.text === "string" && row.view_spec.text) ||
      (typeof row.metadata?.text === "string" && row.metadata.text) ||
      ""
    if (row.kind === "glossary" && glossary === undefined) glossary = text
    if (row.kind === "context_doc" && context === undefined) context = text
  }

  return applyOrgOverlays(workspaceDir, [
    { slug: active.org.slug, glossary, context },
  ])
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64)
}

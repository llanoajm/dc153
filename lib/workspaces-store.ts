// Workspace store core (REDESIGN_ROADMAP §10 / WORKSPACE_REDESIGN.md §3–§6).
//
// Pure / injectable store logic with NO `server-only` or `@/` imports, so it
// can be unit-tested with a fake Supabase-shaped client (see
// tests/unit/workspaces-store.test.mjs). The route-facing RLS-checked wrappers
// live in lib/workspaces.ts and delegate here.
//
// A Workspace anchors a single primary network (the permanent answer to "which
// network?") plus an intent (focus tags) and its chats/objectives/runs/plans.

export interface Workspace {
  id: string
  user_id: string | null
  org_id: string | null
  name: string
  focus: string[]
  primary_network_id: string | null
  cover_image_url: string | null
  created_at: string
  updated_at: string
}

export interface CreateWorkspaceCoreInput {
  name: string
  // The authenticated caller — recorded as the personal owner unless org_id is
  // given (the table's check constraint requires exactly one owner kind).
  user_id: string
  focus?: string[]
  primary_network_id?: string | null
  cover_image_url?: string | null
  org_id?: string | null
}

// Focus tags (WORKSPACE_REDESIGN.md §6). These are NOT cosmetic — they
// configure the zap planning problem (which device capacities become free
// decision variables and which objective terms turn on). The wizard's
// multi-select writes these into `workspaces.focus[]`; item 14 maps them to the
// actual parameter_names + objective composition.
export interface FocusTag {
  id: string
  label: string
  blurb: string
}

export const FOCUS_TAGS: FocusTag[] = [
  {
    id: "Operations",
    label: "Operations",
    blurb: "Dispatch only — solve the schedule and prices for the grid as built.",
  },
  {
    id: "Generation",
    label: "Generation expansion",
    blurb: "Let generator capacities be free; recommend a cost-optimal build-out.",
  },
  {
    id: "Transmission",
    label: "Transmission expansion",
    blurb: "Let line capacities be free; relieve congestion economically.",
  },
  {
    id: "Storage",
    label: "Storage & flexibility",
    blurb: "Let storage power/duration be free; size batteries and flexibility.",
  },
  {
    id: "Decarbonization",
    label: "Decarbonization",
    blurb: "Weight emissions in the objective; trade cost against carbon.",
  },
  {
    id: "General",
    label: "General / all",
    blurb: "All capacities free; cost + emissions + investment together.",
  },
]

const VALID_FOCUS = new Set(FOCUS_TAGS.map((t) => t.id))

// Keep only recognized focus ids, de-duplicated and order-preserving, so a
// stray client value never lands in the row.
export function sanitizeFocus(focus: unknown): string[] {
  if (!Array.isArray(focus)) return []
  const out: string[] = []
  for (const f of focus) {
    if (typeof f === "string" && VALID_FOCUS.has(f) && !out.includes(f)) out.push(f)
  }
  return out
}

// Minimal structural type for the bits of the Supabase client the store uses.
// Lets the unit test inject a fake without pulling the real SDK in.
export interface WorkspaceDbClient {
  from(table: string): {
    insert(row: Record<string, unknown>): {
      select(): { single(): Promise<{ data: unknown; error: { message: string } | null }> }
    }
    update(row: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): {
        select(): { single(): Promise<{ data: unknown; error: { message: string } | null }> }
      }
    }
  }
}

export async function createWorkspaceWith(
  db: WorkspaceDbClient,
  input: CreateWorkspaceCoreInput,
): Promise<Workspace> {
  const row = {
    // Exactly one owner kind (the table's check constraint): org-owned when an
    // org is given, else personal.
    user_id: input.org_id ? null : input.user_id,
    org_id: input.org_id ?? null,
    name: input.name.trim() || "Untitled workspace",
    focus: sanitizeFocus(input.focus),
    primary_network_id: input.primary_network_id ?? null,
    cover_image_url: input.cover_image_url ?? null,
  }
  const { data, error } = await db.from("workspaces").insert(row).select().single()
  if (error) throw new Error(error.message)
  return data as Workspace
}

// Swap (or clear) a workspace's anchored primary network — the Data Source tab's
// only mutation (WORKSPACE_REDESIGN.md §5). Pure/injectable like the create core
// so it's unit-testable; the RLS-checked wrapper lives in lib/workspaces.ts.
// A null primary network is valid (a deferred-source workspace). RLS on the
// real client governs whether the caller may touch this row at all.
export async function updatePrimaryNetworkWith(
  db: WorkspaceDbClient,
  workspaceId: string,
  primaryNetworkId: string | null,
): Promise<Workspace> {
  const { data, error } = await db
    .from("workspaces")
    .update({ primary_network_id: primaryNetworkId, updated_at: new Date().toISOString() })
    .eq("id", workspaceId)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Workspace
}

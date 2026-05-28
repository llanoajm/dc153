// Chat store core (REDESIGN_ROADMAP §4 / WORKSPACE_REDESIGN.md §10).
//
// Pure / injectable store logic with NO `server-only` or `@/` imports, so it
// can be unit-tested with a fake Supabase-shaped client (see
// tests/unit/chats-store.test.mjs). The route-facing RLS-checked wrappers live
// in lib/chats.ts and delegate here.
//
// A chat is a durable handle: it maps a workspace to an opencode session id
// plus a human title, ordered by recency for the sidebar history list. The
// transcript stays in opencode and is reloaded by session id on reopen — this
// store owns the mapping + the list, not the messages.

export interface Chat {
  id: string
  workspace_id: string | null
  user_id: string | null
  org_id: string | null
  session_id: string
  title: string
  created_at: string
  updated_at: string
  last_message_at: string
}

export interface CreateChatInput {
  workspace_id: string | null
  session_id: string
  user_id: string
  // First user message — used to derive a title when one isn't supplied.
  first_message?: string
  title?: string
  org_id?: string | null
}

const DEFAULT_TITLE = "New chat"
const TITLE_MAX = 80

// Pure: derive a tidy one-line title from the first user message. Collapses
// whitespace, strips the [active-network] context preamble the composer
// prepends (so titles read like the user's actual ask), and truncates.
export function deriveChatTitle(firstMessage?: string): string {
  if (!firstMessage) return DEFAULT_TITLE
  let text = firstMessage
  // Drop the composer's network-context preamble if present (mirrors the
  // NETWORK_CTX_PREFIX / "\n\n<body>" shape used in the chat page).
  if (text.startsWith("[active-network]")) {
    const nl = text.indexOf("\n\n")
    if (nl !== -1) text = text.slice(nl + 2)
  }
  const collapsed = text.replace(/\s+/g, " ").trim()
  if (!collapsed) return DEFAULT_TITLE
  if (collapsed.length <= TITLE_MAX) return collapsed
  return collapsed.slice(0, TITLE_MAX - 1).trimEnd() + "…"
}

// Minimal structural type for the bits of the Supabase client the store uses.
// Lets the unit test inject a fake without pulling the real SDK in.
export interface ChatDbClient {
  from(table: string): {
    insert(row: Record<string, unknown>): {
      select(): { single(): Promise<{ data: unknown; error: { message: string } | null }> }
    }
    select(cols: string): {
      eq(col: string, val: unknown): {
        order(
          col: string,
          opts: { ascending: boolean },
        ): Promise<{ data: unknown; error: { message: string } | null }>
        maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>
      }
    }
    update(row: Record<string, unknown>): {
      eq(col: string, val: unknown): Promise<{ error: { message: string } | null }>
    }
  }
}

export async function createChatWith(
  db: ChatDbClient,
  input: CreateChatInput,
): Promise<Chat> {
  const now = new Date().toISOString()
  const row = {
    workspace_id: input.workspace_id,
    user_id: input.org_id ? null : input.user_id,
    org_id: input.org_id ?? null,
    session_id: input.session_id,
    title: input.title?.trim() || deriveChatTitle(input.first_message),
    last_message_at: now,
  }
  const { data, error } = await db.from("chats").insert(row).select().single()
  if (error) throw new Error(error.message)
  return data as Chat
}

export async function listChatsWith(
  db: ChatDbClient,
  workspaceId: string,
): Promise<Chat[]> {
  const { data, error } = await db
    .from("chats")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("last_message_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Chat[]
}

export async function getChatWith(
  db: ChatDbClient,
  id: string,
): Promise<Chat | null> {
  const { data, error } = await db
    .from("chats")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Chat | null) ?? null
}

// Bump recency so the chat floats to the top of the sidebar history list.
export async function touchChatWith(db: ChatDbClient, id: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await db
    .from("chats")
    .update({ last_message_at: now, updated_at: now })
    .eq("id", id)
  if (error) throw new Error(error.message)
}

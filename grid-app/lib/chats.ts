import "server-only"
import { createClient } from "@/lib/supabase/server"
import {
  createChatWith,
  listChatsWith,
  getChatWith,
  touchChatWith,
  type Chat,
  type ChatDbClient,
  type CreateChatInput,
} from "@/lib/chats-store"

// Route-facing chat store (REDESIGN_ROADMAP §4 / WORKSPACE_REDESIGN.md §10).
// The pure / injectable core lives in lib/chats-store.ts (unit-tested with a
// fake client); these wrappers just resolve the RLS-checked user client and
// delegate. Re-export the core types so callers import from one place.
export type { Chat, CreateChatInput } from "@/lib/chats-store"
export { deriveChatTitle } from "@/lib/chats-store"

export async function createChat(
  input: Omit<CreateChatInput, "user_id">,
): Promise<Chat> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("unauthorized")
  return createChatWith(supabase as unknown as ChatDbClient, {
    ...input,
    user_id: user.id,
  })
}

export async function listChats(workspaceId: string): Promise<Chat[]> {
  const supabase = await createClient()
  return listChatsWith(supabase as unknown as ChatDbClient, workspaceId)
}

export async function getChat(id: string): Promise<Chat | null> {
  const supabase = await createClient()
  return getChatWith(supabase as unknown as ChatDbClient, id)
}

export async function touchChat(id: string): Promise<void> {
  const supabase = await createClient()
  await touchChatWith(supabase as unknown as ChatDbClient, id)
}

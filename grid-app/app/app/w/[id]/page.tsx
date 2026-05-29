import { notFound } from "next/navigation"
import { getWorkspace } from "@/lib/workspaces"
import { ChatView } from "@/components/chat/ChatView"

// Workspace home (WORKSPACE_REDESIGN.md §5). Default surface is the chat, bound
// to this workspace so chats persist with its `workspace_id` and the agent's
// session is the implicit subject of the workspace's network. The chat shell
// (left rail with this workspace's chats + the single network) is applied by
// the /app chrome wrapper for /app/w/** routes.
export default async function WorkspaceHomePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // Treat a DB error (e.g. the workspaces table not applied to the live DB yet)
  // the same as "not visible" — a clean 404 rather than a 500 in the interim.
  const workspace = await getWorkspace(id).catch(() => null)
  if (!workspace) notFound()
  return <ChatView workspaceId={workspace.id} />
}

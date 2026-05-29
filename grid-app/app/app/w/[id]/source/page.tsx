import { notFound } from "next/navigation"
import { getWorkspace } from "@/lib/workspaces"
import { getArtifact, listArtifacts, type Artifact } from "@/lib/artifacts"
import { WorkspaceSource, type NetworkOption } from "@/components/workspaces/WorkspaceSource"

// Data Source tab (WORKSPACE_REDESIGN.md §5; REDESIGN_ROADMAP §11). Shows the
// one grid the workspace is anchored to — topology + bus/line/carrier counts —
// and lets the user swap/add the primary network (which PATCHes
// workspaces.primary_network_id). The "ask the agent to fetch" entry routes
// back to the chat so the existing fetch_network tool does the acquisition.
//
// Server component: resolves the workspace (404 if not visible), its primary
// network artifact (if any), and the catalog of selectable networks (canonical
// shared + the caller's own, via artifacts RLS). Degrades to an empty catalog
// if the schema/migration isn't applied to the live DB yet.

function networkSubtitle(a: Pick<Artifact, "metadata" | "slug">): string {
  const meta = a.metadata ?? {}
  const parts: string[] = []
  if (typeof meta.buses === "number") parts.push(`${meta.buses} buses`)
  if (typeof meta.lines === "number") parts.push(`${meta.lines} lines`)
  if (typeof meta.generators === "number") parts.push(`${meta.generators} generators`)
  return parts.join(" · ") || (a.slug ?? "network")
}

export default async function WorkspaceSourcePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const workspace = await getWorkspace(id).catch(() => null)
  if (!workspace) notFound()

  const primaryArtifact = workspace.primary_network_id
    ? await getArtifact(workspace.primary_network_id).catch(() => null)
    : null

  let options: NetworkOption[] = []
  try {
    const networks = await listArtifacts({ kind: "network", limit: 200 })
    options = networks.map((a) => ({
      id: a.id,
      name: a.name,
      subtitle: networkSubtitle(a),
    }))
  } catch {
    options = []
  }

  return (
    <WorkspaceSource
      workspaceId={workspace.id}
      primaryNetwork={primaryArtifact}
      options={options}
    />
  )
}

import { listArtifacts, type Artifact } from "@/lib/artifacts"
import { CreateWizard, type NetworkChoice } from "@/components/workspaces/CreateWizard"

// Creation wizard route (WORKSPACE_REDESIGN.md §5; REDESIGN_ROADMAP §10).
// Loads the reference networks the caller can see (canonical shared + their own,
// via artifacts RLS) so the data-source step can anchor one. Degrades to an
// empty list (skip-only) if the schema/migration isn't applied yet.

function networkSubtitle(a: Artifact): string {
  const meta = a.metadata ?? {}
  const parts: string[] = []
  if (typeof meta.buses === "number") parts.push(`${meta.buses} buses`)
  if (typeof meta.lines === "number") parts.push(`${meta.lines} lines`)
  if (typeof meta.generators === "number") parts.push(`${meta.generators} generators`)
  return parts.join(" · ") || (a.slug ?? "network")
}

export default async function NewWorkspacePage() {
  let networks: NetworkChoice[] = []
  try {
    const artifacts = await listArtifacts({ kind: "network", limit: 50 })
    networks = artifacts.map((a) => ({
      id: a.id,
      name: a.name,
      subtitle: networkSubtitle(a),
    }))
  } catch {
    networks = []
  }

  return <CreateWizard networks={networks} />
}

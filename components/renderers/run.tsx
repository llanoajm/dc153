import type { RendererProps } from "./types"
import { RunView } from "@/components/runs/RunView"

// Default renderer for kind='run' artifacts. The agent (or seed scripts) emit
// `view_spec.{lmps,carriers,flows}` — see components/runs/RunView for the
// expected shape. This component just adapts the universal artifact renderer
// dispatch to the same RunView used by /app/runs/[id].
export function RunRenderer({ artifact }: RendererProps) {
  return <RunView artifact={artifact} />
}

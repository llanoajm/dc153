import type { Artifact } from "@/lib/artifacts"
import { MarkdownRenderer } from "./markdown"
import { TableRenderer } from "./table"
import { ChartRenderer } from "./chart"
import { DiffRenderer } from "./diff"
import { CodeRenderer } from "./code"
import { FileRenderer } from "./file"
import { LogRenderer } from "./log"
import type { RendererName, RendererProps } from "./types"

// view_spec shape:
//   {
//     renderer: "dashboard",
//     title?: string,
//     panels: Array<{
//       title?: string,
//       span?: 1 | 2 | 3 | 4,
//       renderer: RendererName,
//       view_spec: Record<string, unknown>,
//       metadata?: Record<string, unknown>,
//     }>
//   }
// Each panel is rendered as a synthetic Artifact through the matching
// child renderer — agent-authored multi-panel layouts (ROADMAP §11.8).
export function DashboardRenderer({ artifact }: RendererProps) {
  const spec = artifact.view_spec as {
    title?: string
    panels?: Array<DashboardPanel>
  }
  const panels = Array.isArray(spec.panels) ? spec.panels : []
  if (panels.length === 0) {
    return (
      <div className="text-sm font-serif-soft text-black/50">
        Empty dashboard. Set <code className="font-mono">view_spec.panels</code>.
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {spec.title ? (
        <div className="font-mark text-xs tracking-wider text-black/60 uppercase">{spec.title}</div>
      ) : null}
      <div className="grid grid-cols-4 gap-4">
        {panels.map((p, i) => (
          <div
            key={i}
            className="border border-black/10 p-3"
            style={{ gridColumn: `span ${clampSpan(p.span)} / span ${clampSpan(p.span)}` }}
          >
            {p.title ? (
              <div className="font-mark text-[11px] tracking-wider text-black/50 uppercase mb-2">
                {p.title}
              </div>
            ) : null}
            <PanelView panel={p} parent={artifact} index={i} />
          </div>
        ))}
      </div>
    </div>
  )
}

interface DashboardPanel {
  title?: string
  span?: number
  renderer: RendererName
  view_spec: Record<string, unknown>
  metadata?: Record<string, unknown>
}

function clampSpan(s: number | undefined): number {
  if (typeof s !== "number") return 4
  if (s < 1) return 1
  if (s > 4) return 4
  return Math.floor(s)
}

function PanelView({
  panel,
  parent,
  index,
}: {
  panel: DashboardPanel
  parent: Artifact
  index: number
}) {
  // Synthesize an Artifact-shaped object so each child renderer keeps the
  // same `RendererProps` contract. We don't insert this — it's purely for
  // the renderer's read path.
  const synthetic: Artifact = {
    ...parent,
    id: `${parent.id}#panel-${index}`,
    kind: "view",
    view_spec: panel.view_spec ?? {},
    metadata: panel.metadata ?? {},
  }
  switch (panel.renderer) {
    case "markdown":
      return <MarkdownRenderer artifact={synthetic} />
    case "table":
      return <TableRenderer artifact={synthetic} />
    case "chart":
      return <ChartRenderer artifact={synthetic} />
    case "diff":
      return <DiffRenderer artifact={synthetic} />
    case "code":
      return <CodeRenderer artifact={synthetic} />
    case "log":
      return <LogRenderer artifact={synthetic} />
    case "dashboard":
      return <DashboardRenderer artifact={synthetic} />
    case "file":
    default:
      return <FileRenderer artifact={synthetic} />
  }
}

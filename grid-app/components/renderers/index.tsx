import type { Artifact } from "@/lib/artifacts"
import { MarkdownRenderer } from "./markdown"
import { TableRenderer } from "./table"
import { ChartRenderer } from "./chart"
import { DiffRenderer } from "./diff"
import { CodeRenderer } from "./code"
import { FileRenderer } from "./file"
import { LogRenderer } from "./log"
import { DashboardRenderer } from "./dashboard"
import { NetworkGraphRenderer } from "./network-graph"
import { GeoMapRenderer } from "./geo-map"
import { RunRenderer } from "./run"
import { PlanRenderer } from "./plan"
import { PanelRenderer } from "./panel"
import { rendererFor } from "./types"

// Universal entry point. Pick a renderer by (1) explicit
// `view_spec.renderer`, (2) artifact.kind fallback, (3) file renderer as the
// catch-all so unknown shapes still display *something*.
export function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  const name = rendererFor(artifact)
  switch (name) {
    case "markdown":
      return <MarkdownRenderer artifact={artifact} />
    case "table":
      return <TableRenderer artifact={artifact} />
    case "chart":
      return <ChartRenderer artifact={artifact} />
    case "diff":
      return <DiffRenderer artifact={artifact} />
    case "code":
      return <CodeRenderer artifact={artifact} />
    case "log":
      return <LogRenderer artifact={artifact} />
    case "dashboard":
      return <DashboardRenderer artifact={artifact} />
    case "network-graph":
      return <NetworkGraphRenderer artifact={artifact} />
    case "geo-map":
      return <GeoMapRenderer artifact={artifact} />
    case "run":
      return <RunRenderer artifact={artifact} />
    case "plan":
      return <PlanRenderer artifact={artifact} />
    case "panel":
      return <PanelRenderer artifact={artifact} />
    case "file":
    default:
      return <FileRenderer artifact={artifact} />
  }
}

export { rendererFor } from "./types"
export type { RendererName } from "./types"

import { PanelHost } from "@/components/sandbox/PanelHost"
import type { RendererProps } from "./types"

// Thin wrapper so the universal renderer can dispatch `kind='panel'` (or
// `view_spec.renderer='panel'`) through the sandboxed PanelHost. All the
// rendering / security work lives in `components/sandbox/PanelHost.tsx`.
export function PanelRenderer({ artifact }: RendererProps) {
  return <PanelHost artifact={artifact} />
}

import type { RendererProps } from "./types"

// view_spec shape: { source: string, language?: string, path?: string }
// Syntax highlighting is a later upgrade — Prism/Shiki carry weight we don't
// need yet. The contract here is stable: emit `view_spec.source` and a
// future renderer swap is transparent.
export function CodeRenderer({ artifact }: RendererProps) {
  const spec = artifact.view_spec as { source?: string; language?: string; path?: string }
  const source = spec.source ?? readMetadataSource(artifact.metadata) ?? ""
  if (!source) {
    return (
      <div className="text-sm font-soft text-black/50">
        No source. Set <code className="font-mono">view_spec.source</code>.
      </div>
    )
  }
  return (
    <div className="border border-black/10">
      {(spec.path || spec.language) ? (
        <div className="px-3 py-1.5 bg-black/[0.04] font-mono text-[11px] border-b border-black/10 flex items-center justify-between">
          <span>{spec.path ?? ""}</span>
          <span className="text-black/50">{spec.language ?? ""}</span>
        </div>
      ) : null}
      <pre className="font-mono text-[12px] leading-relaxed p-3 overflow-x-auto whitespace-pre">
        {source}
      </pre>
    </div>
  )
}

function readMetadataSource(metadata: Record<string, unknown>): string | null {
  if (typeof metadata.source === "string") return metadata.source
  if (typeof metadata.body === "string") return metadata.body
  return null
}

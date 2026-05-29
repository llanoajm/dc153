import type { RendererProps } from "./types"

// view_spec shape: { lines: string[] } or { text: string }
export function LogRenderer({ artifact }: RendererProps) {
  const spec = artifact.view_spec as { lines?: string[]; text?: string }
  const lines = Array.isArray(spec.lines) ? spec.lines : spec.text ? spec.text.split("\n") : []
  if (lines.length === 0) {
    return (
      <div className="text-sm font-soft text-black/50">
        Empty log. Set <code className="font-mono">view_spec.lines</code> or{" "}
        <code className="font-mono">view_spec.text</code>.
      </div>
    )
  }
  return (
    <pre className="font-mono text-[12px] leading-relaxed bg-black text-green-100 p-3 overflow-x-auto whitespace-pre">
      {lines.join("\n")}
    </pre>
  )
}

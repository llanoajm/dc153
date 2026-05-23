import type { RendererProps } from "./types"

// Minimal markdown rendering — paragraphs, code fences, headings, lists — no
// external deps. The agent can emit `{ text }` directly or pass `{ source }`
// pointing at metadata.source. A real markdown renderer (remark/MDX) is a
// later upgrade; the renderer contract here is stable.
export function MarkdownRenderer({ artifact }: RendererProps) {
  const text = pickText(artifact.view_spec, artifact.metadata)
  if (!text) {
    return (
      <div className="text-sm font-serif-soft text-black/50">
        No markdown body. Set <code className="font-mono">view_spec.text</code> or{" "}
        <code className="font-mono">metadata.body</code>.
      </div>
    )
  }
  return (
    <div className="font-serif-soft text-[15px] leading-relaxed text-black whitespace-pre-wrap">
      {text}
    </div>
  )
}

function pickText(view_spec: Record<string, unknown>, metadata: Record<string, unknown>): string {
  if (typeof view_spec.text === "string") return view_spec.text
  if (typeof view_spec.body === "string") return view_spec.body
  if (typeof metadata.body === "string") return metadata.body
  if (typeof metadata.text === "string") return metadata.text
  return ""
}

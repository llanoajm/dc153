import type { RendererProps } from "./types"

// view_spec shape: { before: string, after: string, path?: string }
// Renders a simple unified diff line-by-line. A real diff library is a later
// upgrade; for now this matches what `Edit` already produces in tool cards.
export function DiffRenderer({ artifact }: RendererProps) {
  const spec = artifact.view_spec as { before?: string; after?: string; path?: string }
  const before = spec.before ?? ""
  const after = spec.after ?? ""
  if (!before && !after) {
    return (
      <div className="text-sm font-serif-soft text-black/50">
        Empty diff. Set <code className="font-mono">view_spec.before</code> and{" "}
        <code className="font-mono">view_spec.after</code>.
      </div>
    )
  }
  const lines = unifiedDiff(before, after)
  return (
    <div className="border border-black/10">
      {spec.path ? (
        <div className="px-3 py-1.5 bg-black/[0.04] font-mono text-[11px] border-b border-black/10">
          {spec.path}
        </div>
      ) : null}
      <pre className="font-mono text-[12px] leading-snug">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === "add"
                ? "bg-green-50 text-green-900"
                : l.kind === "del"
                  ? "bg-red-50 text-red-900"
                  : "text-black/70"
            }
          >
            <span className="inline-block w-6 text-center select-none opacity-60">
              {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
            </span>
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  )
}

interface DiffLine {
  kind: "add" | "del" | "eq"
  text: string
}

function unifiedDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n")
  const b = after.split("\n")
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: "eq", text: a[i] })
      i++
      j++
    } else if (j < b.length && (i >= a.length || !a.slice(i).includes(b[j]))) {
      out.push({ kind: "add", text: b[j] })
      j++
    } else if (i < a.length) {
      out.push({ kind: "del", text: a[i] })
      i++
    } else {
      out.push({ kind: "add", text: b[j] })
      j++
    }
  }
  return out
}

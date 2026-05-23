import type { RendererProps } from "./types"

// view_spec shape: a Vega-Lite spec (ROADMAP §11.6). Vega-Lite isn't bundled
// yet — adding it without a use case is premature. For now we show the spec
// + a tiny preview when data is inline so the contract is testable; swap in
// a real Vega-Lite renderer here when the chart artifact lands.
export function ChartRenderer({ artifact }: RendererProps) {
  const spec = artifact.view_spec as {
    mark?: string
    encoding?: Record<string, unknown>
    data?: { values?: unknown[] }
    title?: string
  }
  const rows = spec.data?.values ?? []
  return (
    <div className="space-y-3">
      <div className="font-mark text-xs tracking-wider text-black/60 uppercase">
        {spec.title ?? `Chart · ${spec.mark ?? "vega-lite"}`}
      </div>
      <MiniBarPreview rows={Array.isArray(rows) ? rows : []} encoding={spec.encoding} />
      <details className="text-[11px] font-mono">
        <summary className="cursor-pointer text-black/50">view spec</summary>
        <pre className="mt-2 p-3 bg-black/[0.04] overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(artifact.view_spec, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function MiniBarPreview({
  rows,
  encoding,
}: {
  rows: unknown[]
  encoding: Record<string, unknown> | undefined
}) {
  if (rows.length === 0) {
    return (
      <div className="text-sm font-serif-soft text-black/50">
        No inline data. Set <code className="font-mono">view_spec.data.values</code> for an inline
        preview, or upgrade to the full Vega-Lite renderer.
      </div>
    )
  }
  const xField = readField(encoding, "x")
  const yField = readField(encoding, "y")
  const series = rows
    .map((r) => (typeof r === "object" && r ? (r as Record<string, unknown>) : null))
    .filter((r): r is Record<string, unknown> => r !== null)
    .slice(0, 40)
  const max = Math.max(
    1,
    ...series.map((r) => (typeof r[yField] === "number" ? (r[yField] as number) : 0)),
  )
  return (
    <div className="flex items-end gap-1 h-32 border-b border-l border-black/10 px-2 py-2">
      {series.map((r, i) => {
        const v = typeof r[yField] === "number" ? (r[yField] as number) : 0
        const h = Math.max(2, (Math.abs(v) / max) * 100)
        return (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className="bg-black w-3"
              style={{ height: `${h}%` }}
              title={`${String(r[xField] ?? i)}: ${v}`}
            />
          </div>
        )
      })}
    </div>
  )
}

function readField(encoding: Record<string, unknown> | undefined, axis: "x" | "y"): string {
  const e = encoding?.[axis]
  if (e && typeof e === "object" && "field" in e && typeof (e as Record<string, unknown>).field === "string") {
    return (e as Record<string, unknown>).field as string
  }
  return axis === "x" ? "x" : "y"
}

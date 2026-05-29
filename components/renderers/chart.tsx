"use client"

import { useEffect, useRef, useState } from "react"
import type { RendererProps } from "./types"

// view_spec is a Vega-Lite spec (ROADMAP §11.6). The renderer dynamic-imports
// vega-embed so the ~1MB Vega bundle only loads when an artifact actually
// mounts a chart. If `view_spec.spec` is set we treat that as the canonical
// spec and use the rest of view_spec for renderer-side options; otherwise we
// treat view_spec itself as the spec.
type VegaEmbed = typeof import("vega-embed")["default"]

interface ChartViewSpec {
  spec?: Record<string, unknown>
  renderer?: string
  title?: string
  description?: string
  // Top-level vega-lite fields we recognize for the "no spec wrapper" case.
  mark?: unknown
  encoding?: Record<string, unknown>
  data?: Record<string, unknown>
  layer?: unknown[]
  hconcat?: unknown[]
  vconcat?: unknown[]
  repeat?: unknown
  facet?: unknown
}

export function ChartRenderer({ artifact }: RendererProps) {
  const viewSpec = (artifact.view_spec ?? {}) as ChartViewSpec
  const spec = pickSpec(viewSpec)
  const title =
    typeof viewSpec.title === "string"
      ? viewSpec.title
      : typeof (spec as Record<string, unknown>)?.title === "string"
      ? ((spec as Record<string, unknown>).title as string)
      : artifact.name

  return (
    <div className="space-y-3">
      <div className="font-mark text-xs tracking-wider text-black/60 uppercase">
        {title}
      </div>
      {spec ? (
        <VegaLiteChart spec={spec} />
      ) : (
        <div className="text-sm font-soft text-black/50 border border-dashed border-black/15 px-4 py-6">
          No chart spec on this artifact. Set <code className="font-mono">view_spec</code> to a
          Vega-Lite spec (or wrap it as <code className="font-mono">view_spec.spec</code>).
        </div>
      )}
      <details className="text-[11px] font-mono">
        <summary className="cursor-pointer text-black/50">view spec</summary>
        <pre className="mt-2 p-3 bg-black/[0.04] overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(artifact.view_spec, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function pickSpec(view: ChartViewSpec): Record<string, unknown> | null {
  if (view.spec && typeof view.spec === "object") {
    return view.spec as Record<string, unknown>
  }
  if (
    view.mark ||
    view.layer ||
    view.hconcat ||
    view.vconcat ||
    view.repeat ||
    view.facet ||
    view.encoding
  ) {
    const { renderer: _r, title: _t, description: _d, ...rest } = view
    void _r
    void _t
    void _d
    return rest as Record<string, unknown>
  }
  return null
}

export function VegaLiteChart({
  spec,
  className,
  height,
}: {
  spec: Record<string, unknown>
  className?: string
  height?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let view: { finalize: () => void } | null = null
    setError(null)

    ;(async () => {
      try {
        const mod = await import("vega-embed")
        if (cancelled || !ref.current) return
        const embed: VegaEmbed = mod.default
        const merged: Record<string, unknown> = {
          $schema: "https://vega.github.io/schema/vega-lite/v6.json",
          width: "container",
          autosize: { type: "fit", contains: "padding" },
          ...spec,
        }
        if (height !== undefined && !("height" in spec)) {
          merged.height = height
        }
        const result = await embed(ref.current, merged as Parameters<VegaEmbed>[1], {
          actions: false,
          renderer: "svg",
          ast: true,
        })
        if (cancelled) {
          result.view.finalize()
          return
        }
        view = result.view
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    })()

    return () => {
      cancelled = true
      try {
        view?.finalize()
      } catch {
        // ignore
      }
    }
  }, [spec, height])

  if (error) {
    return (
      <div className={className}>
        <div className="text-xs font-mono text-red-700 border border-red-200 bg-red-50 px-3 py-2">
          chart render error: {error}
        </div>
      </div>
    )
  }

  return <div ref={ref} className={`w-full ${className ?? ""}`} />
}

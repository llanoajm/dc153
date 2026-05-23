"use client"

import { useMemo } from "react"
import type { Artifact } from "@/lib/artifacts"
import { VegaLiteChart } from "@/components/renderers/chart"

// A run artifact's view_spec is expected to carry inline time-series suitable
// for direct Vega-Lite consumption. The exact shapes (all optional — the panel
// renders whichever ones are present):
//
//   view_spec.hours: string[]            ISO timestamps for each snapshot
//   view_spec.lmps: { t, bus, value }[]  per-bus LMP per snapshot
//   view_spec.carriers: { t, carrier, value }[]  dispatch by carrier per snapshot
//   view_spec.flows: { t, line, value }[]  line MW per snapshot
//
// Future runs may also set view_spec.units / view_spec.network_name etc., which
// we surface as subtitle context.

export interface RunSeries {
  t: string | number
  [k: string]: unknown
}

export interface RunSpec {
  hours?: unknown
  lmps?: RunSeries[]
  carriers?: RunSeries[]
  flows?: RunSeries[]
  network_name?: string
  network_slug?: string
  units?: Record<string, string>
}

const MAX_BUS_SERIES = 12
const MAX_LINE_SERIES = 12

export function RunView({ artifact, compact = false }: { artifact: Artifact; compact?: boolean }) {
  const view = (artifact.view_spec ?? {}) as RunSpec
  const meta = (artifact.metadata ?? {}) as Record<string, unknown>

  const lmpSpec = useMemo(() => buildLmpSpec(view, compact ? 180 : 240), [view, compact])
  const carrierSpec = useMemo(() => buildCarrierSpec(view, compact ? 180 : 240), [view, compact])
  const flowSpec = useMemo(() => buildFlowSpec(view, compact ? 180 : 240), [view, compact])

  const subtitle = [
    typeof meta.network_name === "string" ? (meta.network_name as string) : view.network_name,
    typeof meta.solver === "string" ? `solver=${meta.solver}` : null,
    typeof meta.elapsed_s === "number" ? `${(meta.elapsed_s as number).toFixed(2)}s` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="space-y-6">
      {subtitle ? (
        <div className="text-[11px] font-mono text-black/50">{subtitle}</div>
      ) : null}

      <ChartBlock title="Locational marginal prices" spec={lmpSpec} empty="No LMP data on this run." />
      <ChartBlock title="Dispatch by carrier" spec={carrierSpec} empty="No carrier dispatch on this run." />
      <ChartBlock title="Line flows" spec={flowSpec} empty="No line flow data on this run." />
    </div>
  )
}

function ChartBlock({
  title,
  spec,
  empty,
}: {
  title: string
  spec: Record<string, unknown> | null
  empty: string
}) {
  return (
    <div className="border border-black/10 p-4">
      <div className="text-[11px] font-mark tracking-wider uppercase text-black/60 mb-3">
        {title}
      </div>
      {spec ? (
        <VegaLiteChart spec={spec} />
      ) : (
        <div className="text-sm font-serif-soft text-black/50">{empty}</div>
      )}
    </div>
  )
}

function buildLmpSpec(view: RunSpec, height: number): Record<string, unknown> | null {
  const rows = Array.isArray(view.lmps) ? (view.lmps as RunSeries[]) : []
  if (rows.length === 0) return null
  const topBuses = topKeysByVariance(rows, "bus", "value", MAX_BUS_SERIES)
  const filtered = rows.filter((r) => topBuses.has(String(r["bus"])))
  return {
    height,
    data: { values: filtered },
    mark: { type: "line", point: filtered.length < 60 },
    encoding: {
      x: { field: "t", type: timeOrOrdinal(filtered), title: "snapshot" },
      y: { field: "value", type: "quantitative", title: "LMP ($/MWh)" },
      color: { field: "bus", type: "nominal", legend: { title: "bus" } },
      tooltip: [
        { field: "t" },
        { field: "bus" },
        { field: "value", type: "quantitative", format: ".2f" },
      ],
    },
  }
}

function buildCarrierSpec(view: RunSpec, height: number): Record<string, unknown> | null {
  const rows = Array.isArray(view.carriers) ? (view.carriers as RunSeries[]) : []
  if (rows.length === 0) return null
  return {
    height,
    data: { values: rows },
    mark: { type: "area", interpolate: "step-after", opacity: 0.85 },
    encoding: {
      x: { field: "t", type: timeOrOrdinal(rows), title: "snapshot" },
      y: { field: "value", type: "quantitative", title: "MW", stack: "zero" },
      color: { field: "carrier", type: "nominal", legend: { title: "carrier" } },
      tooltip: [
        { field: "t" },
        { field: "carrier" },
        { field: "value", type: "quantitative", format: ".1f" },
      ],
    },
  }
}

function buildFlowSpec(view: RunSpec, height: number): Record<string, unknown> | null {
  const rows = Array.isArray(view.flows) ? (view.flows as RunSeries[]) : []
  if (rows.length === 0) return null
  const topLines = topKeysByVariance(rows, "line", "value", MAX_LINE_SERIES)
  const filtered = rows.filter((r) => topLines.has(String(r["line"])))
  return {
    height,
    data: { values: filtered },
    mark: { type: "line", point: filtered.length < 60 },
    encoding: {
      x: { field: "t", type: timeOrOrdinal(filtered), title: "snapshot" },
      y: { field: "value", type: "quantitative", title: "MW" },
      color: { field: "line", type: "nominal", legend: { title: "line" } },
      tooltip: [
        { field: "t" },
        { field: "line" },
        { field: "value", type: "quantitative", format: ".1f" },
      ],
    },
  }
}

function timeOrOrdinal(rows: RunSeries[]): string {
  if (rows.length === 0) return "ordinal"
  const sample = rows[0].t
  if (typeof sample === "string" && Number.isNaN(Date.parse(sample))) return "ordinal"
  if (typeof sample === "number") return "ordinal"
  return "temporal"
}

function topKeysByVariance(
  rows: RunSeries[],
  key: string,
  valueKey: string,
  k: number,
): Set<string> {
  const byKey = new Map<string, number[]>()
  for (const r of rows) {
    const id = String(r[key] ?? "")
    if (!id) continue
    const v = typeof r[valueKey] === "number" ? (r[valueKey] as number) : NaN
    if (!Number.isFinite(v)) continue
    const arr = byKey.get(id) ?? []
    arr.push(v)
    byKey.set(id, arr)
  }
  if (byKey.size <= k) return new Set(byKey.keys())
  const scored: Array<[string, number]> = []
  for (const [id, arr] of byKey) {
    if (arr.length === 0) continue
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length
    const variance =
      arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length
    scored.push([id, variance])
  }
  scored.sort((a, b) => b[1] - a[1])
  return new Set(scored.slice(0, k).map(([id]) => id))
}

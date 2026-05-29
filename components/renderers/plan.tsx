"use client"

import { useMemo } from "react"
import type { RendererProps } from "./types"
import type { Artifact } from "@/lib/artifacts"
import { VegaLiteChart } from "./chart"
import { RunView } from "@/components/runs/RunView"

// A `kind='plan'` artifact's view_spec is built by scripts/plan_artifact.py
// (build_plan_view_spec). The five panels from WORKSPACE_REDESIGN.md §7, each
// independently optional — the renderer omits any panel whose data is absent:
//
//   view_spec.loss/op_cost/inv_cost : number[] per-iteration objective curves
//   view_spec.trajectory            : { iteration, device, capacity }[]
//   view_spec.capacity_table        : { device, carrier, before, after, delta, capex }[]
//   view_spec.dispatch              : a `run` view_spec solved at final caps
//   view_spec.cost_emissions        : { op_cost, emissions, emissions_weight }
//
// The dispatch panel reuses RunView (the same LMP / carrier / flow charts as a
// dispatch Run) rather than re-implementing them.

interface CapacityRow {
  device?: unknown
  carrier?: unknown
  before?: unknown
  after?: unknown
  delta?: unknown
  capex?: unknown
}

interface TrajectoryRow {
  iteration?: unknown
  device?: unknown
  capacity?: unknown
}

interface CostEmissions {
  op_cost?: unknown
  emissions?: unknown
  emissions_weight?: unknown
}

interface PlanSpec {
  loss?: unknown
  op_cost?: unknown
  inv_cost?: unknown
  trajectory?: TrajectoryRow[]
  capacity_table?: CapacityRow[]
  dispatch?: Record<string, unknown>
  cost_emissions?: CostEmissions
  emissions_weight?: unknown
}

const MAX_TRAJECTORY_SERIES = 12

export function PlanRenderer({ artifact }: RendererProps) {
  const view = (artifact.view_spec ?? {}) as PlanSpec
  const meta = (artifact.metadata ?? {}) as Record<string, unknown>

  const lossSpec = useMemo(() => buildLossSpec(view), [view])
  const trajectorySpec = useMemo(() => buildTrajectorySpec(view), [view])
  const costEmissionsSpec = useMemo(() => buildCostEmissionsSpec(view), [view])

  const capacityRows = Array.isArray(view.capacity_table)
    ? (view.capacity_table as CapacityRow[])
    : []
  const dispatchArtifact = useMemo(
    () => buildDispatchArtifact(artifact, view),
    [artifact, view],
  )

  const subtitle = [
    typeof meta.network_name === "string" ? (meta.network_name as string) : null,
    typeof meta.iterations === "number" ? `${meta.iterations} iters` : null,
    typeof meta.solver === "string" ? `solver=${meta.solver}` : null,
    typeof meta.emissions_weight === "number" && (meta.emissions_weight as number) > 0
      ? `λ=${meta.emissions_weight}`
      : null,
    typeof meta.final_op_cost === "number"
      ? `op cost=${formatNumber(meta.final_op_cost as number)}`
      : null,
    typeof meta.final_inv_cost === "number"
      ? `invest=${formatNumber(meta.final_inv_cost as number)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="space-y-6">
      {subtitle ? (
        <div className="text-[11px] font-mono text-black/50">{subtitle}</div>
      ) : null}

      <Block title="Objective over iterations" empty="No loss history on this plan.">
        {lossSpec ? <VegaLiteChart spec={lossSpec} /> : null}
      </Block>

      <Block title="Capacity trajectory" empty="No capacity trajectory on this plan.">
        {trajectorySpec ? <VegaLiteChart spec={trajectorySpec} /> : null}
      </Block>

      <Block title="Recommended build" empty="No final build table on this plan.">
        {capacityRows.length > 0 ? <CapacityTable rows={capacityRows} /> : null}
      </Block>

      <Block
        title="Resulting dispatch"
        empty="No dispatch was solved at the final capacities."
      >
        {dispatchArtifact ? <RunView artifact={dispatchArtifact} compact /> : null}
      </Block>

      <Block
        title="Cost vs emissions"
        empty="No emissions data on this plan (the network's generators carry no emission rates)."
      >
        {costEmissionsSpec ? <VegaLiteChart spec={costEmissionsSpec} /> : null}
      </Block>
    </div>
  )
}

function Block({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: React.ReactNode
}) {
  return (
    <div className="border border-black/10 p-4">
      <div className="text-[11px] font-mark tracking-wider uppercase text-black/60 mb-3">
        {title}
      </div>
      {children ?? <div className="text-sm font-soft text-black/50">{empty}</div>}
      {children ? null : null}
    </div>
  )
}

// The objective curves share an iteration axis. We pivot loss / op_cost /
// inv_cost into a single long-format series so Vega draws one line per metric.
function buildLossSpec(view: PlanSpec): Record<string, unknown> | null {
  const series: Array<{ key: string; values: number[] }> = [
    { key: "loss", values: numberList(view.loss) },
    { key: "op_cost", values: numberList(view.op_cost) },
    { key: "inv_cost", values: numberList(view.inv_cost) },
  ].filter((s) => s.values.length > 0)
  if (series.length === 0) return null
  const rows: Array<{ iteration: number; metric: string; value: number }> = []
  for (const { key, values } of series) {
    values.forEach((v, i) => rows.push({ iteration: i, metric: key, value: v }))
  }
  return {
    height: 220,
    data: { values: rows },
    mark: { type: "line", point: rows.length < 120 },
    encoding: {
      x: { field: "iteration", type: "quantitative", title: "iteration" },
      y: { field: "value", type: "quantitative", title: "objective" },
      color: { field: "metric", type: "nominal", legend: { title: null } },
      tooltip: [
        { field: "iteration", type: "quantitative" },
        { field: "metric", type: "nominal" },
        { field: "value", type: "quantitative", format: ".4g" },
      ],
    },
  }
}

function buildTrajectorySpec(view: PlanSpec): Record<string, unknown> | null {
  const rows = Array.isArray(view.trajectory)
    ? (view.trajectory as TrajectoryRow[])
        .map((r) => ({
          iteration: toNumber(r.iteration),
          device: String(r.device ?? ""),
          capacity: toNumber(r.capacity),
        }))
        .filter(
          (r) =>
            r.iteration !== null && r.capacity !== null && r.device.length > 0,
        )
    : []
  if (rows.length === 0) return null
  const devices = Array.from(new Set(rows.map((r) => r.device)))
  const keep =
    devices.length > MAX_TRAJECTORY_SERIES
      ? new Set(devices.slice(0, MAX_TRAJECTORY_SERIES))
      : new Set(devices)
  const filtered = rows.filter((r) => keep.has(r.device))
  return {
    height: 220,
    data: { values: filtered },
    mark: { type: "line", point: filtered.length < 120 },
    encoding: {
      x: { field: "iteration", type: "quantitative", title: "iteration" },
      y: { field: "capacity", type: "quantitative", title: "capacity (MW)" },
      color: { field: "device", type: "nominal", legend: { title: "generator" } },
      tooltip: [
        { field: "iteration", type: "quantitative" },
        { field: "device", type: "nominal" },
        { field: "capacity", type: "quantitative", format: ".2f" },
      ],
    },
  }
}

// One achieved point today; the spec stays a list so a future λ-sweep can add
// the full Pareto frontier without changing the renderer.
function buildCostEmissionsSpec(view: PlanSpec): Record<string, unknown> | null {
  const ce = view.cost_emissions
  if (!ce || typeof ce !== "object") return null
  const op = toNumber(ce.op_cost)
  const em = toNumber(ce.emissions)
  if (op === null || em === null) return null
  const lambda = toNumber(ce.emissions_weight) ?? toNumber(view.emissions_weight) ?? 0
  const point = { op_cost: op, emissions: em, lambda }
  return {
    height: 220,
    data: { values: [point] },
    mark: { type: "point", filled: true, size: 120 },
    encoding: {
      x: { field: "emissions", type: "quantitative", title: "emissions" },
      y: { field: "op_cost", type: "quantitative", title: "operating cost" },
      color: { field: "lambda", type: "quantitative", legend: { title: "λ" } },
      tooltip: [
        { field: "op_cost", type: "quantitative", format: ".4g" },
        { field: "emissions", type: "quantitative", format: ".4g" },
        { field: "lambda", type: "quantitative" },
      ],
    },
  }
}

function CapacityTable({ rows }: { rows: CapacityRow[] }) {
  const anyCapex = rows.some((r) => toNumber(r.capex) !== null)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-mono">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-black/50 border-b border-black/10">
            <th className="py-2 pr-4 font-mark">generator</th>
            <th className="py-2 pr-4 font-mark">carrier</th>
            <th className="py-2 pr-4 font-mark text-right">before</th>
            <th className="py-2 pr-4 font-mark text-right">after</th>
            <th className="py-2 pr-4 font-mark text-right">Δ</th>
            {anyCapex ? <th className="py-2 font-mark text-right">capex</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const delta = toNumber(r.delta)
            return (
              <tr key={i} className="border-b border-black/[0.06]">
                <td className="py-1.5 pr-4">{String(r.device ?? "")}</td>
                <td className="py-1.5 pr-4 text-black/50">{String(r.carrier ?? "")}</td>
                <td className="py-1.5 pr-4 text-right">{formatCell(r.before)}</td>
                <td className="py-1.5 pr-4 text-right">{formatCell(r.after)}</td>
                <td
                  className={`py-1.5 pr-4 text-right ${
                    delta !== null && delta > 0
                      ? "text-emerald-700"
                      : delta !== null && delta < 0
                      ? "text-red-700"
                      : "text-black/40"
                  }`}
                >
                  {delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatNumber(delta)}`}
                </td>
                {anyCapex ? (
                  <td className="py-1.5 text-right">{formatCell(r.capex)}</td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Build a synthetic `kind='run'` artifact wrapping the nested dispatch spec so
// RunView (which keys off artifact.view_spec) can render it unchanged.
function buildDispatchArtifact(
  parent: Artifact,
  view: PlanSpec,
): Artifact | null {
  const dispatch = view.dispatch
  if (!dispatch || typeof dispatch !== "object") return null
  const hasSeries =
    nonEmptyArray((dispatch as Record<string, unknown>).lmps) ||
    nonEmptyArray((dispatch as Record<string, unknown>).carriers) ||
    nonEmptyArray((dispatch as Record<string, unknown>).flows)
  if (!hasSeries) return null
  return {
    ...parent,
    kind: "run",
    view_spec: dispatch as Record<string, unknown>,
  }
}

function nonEmptyArray(x: unknown): boolean {
  return Array.isArray(x) && x.length > 0
}

function numberList(x: unknown): number[] {
  if (!Array.isArray(x)) return []
  return x.map(toNumber).filter((v): v is number => v !== null)
}

function toNumber(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x
  return null
}

function formatCell(x: unknown): string {
  const v = toNumber(x)
  return v === null ? "—" : formatNumber(v)
}

function formatNumber(v: number): string {
  const abs = Math.abs(v)
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return v.toExponential(2)
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

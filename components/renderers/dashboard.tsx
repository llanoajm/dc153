"use client"

import { useEffect, useMemo, useState } from "react"
import type { Artifact } from "@/lib/artifacts"
import { MarkdownRenderer } from "./markdown"
import { TableRenderer } from "./table"
import { ChartRenderer } from "./chart"
import { DiffRenderer } from "./diff"
import { CodeRenderer } from "./code"
import { FileRenderer } from "./file"
import { LogRenderer } from "./log"
import { NetworkGraphRenderer } from "./network-graph"
import { GeoMapRenderer } from "./geo-map"
import { RunRenderer } from "./run"
import type { RendererName, RendererProps } from "./types"
import {
  DASHBOARD_DEFAULTS,
  clampSpan,
  initialControlState,
  type DashboardControl,
  type DashboardPanel,
  type DashboardViewSpec,
  type TimeSliderControl,
} from "@/lib/view-specs/dashboard"

// Dashboard renderer for agent-authored multi-panel layouts (ROADMAP §11.8).
// The schema this consumes is documented in `lib/view-specs/dashboard.ts`. The
// renderer is a thin compositor: it routes each panel through the same
// renderer registry the rest of the app uses, threads shared controls into
// panel view specs as renderer-internal keys (`_controlled_hour_idx`), and
// resolves panel-level `artifact_id` references on mount.
export function DashboardRenderer({ artifact }: RendererProps) {
  const spec = (artifact.view_spec ?? {}) as unknown as DashboardViewSpec
  const panels = Array.isArray(spec.panels) ? spec.panels : []
  const controls = Array.isArray(spec.controls) ? spec.controls : []
  const columns = Math.max(1, Math.floor(spec.columns ?? DASHBOARD_DEFAULTS.columns))
  const [controlState, setControlState] = useState<Record<string, number>>(() =>
    initialControlState(spec),
  )

  if (panels.length === 0) {
    return (
      <div className="text-sm font-soft text-black/50">
        Empty dashboard. Set <code className="font-mono">view_spec.panels</code>.
      </div>
    )
  }

  const setControl = (id: string, value: number) =>
    setControlState((s) => ({ ...s, [id]: value }))

  return (
    <div className="space-y-4">
      {spec.title || spec.description ? (
        <div className="space-y-1">
          {spec.title ? (
            <div className="font-mark text-xs tracking-wider text-black/60 uppercase">
              {spec.title}
            </div>
          ) : null}
          {spec.description ? (
            <div className="font-soft text-sm text-black/70">{spec.description}</div>
          ) : null}
        </div>
      ) : null}

      {controls.length > 0 ? (
        <div className="space-y-2">
          {controls.map((c, i) => (
            <ControlBar
              key={c.id ?? i}
              control={c}
              value={controlState[c.id] ?? 0}
              onChange={(v) => setControl(c.id, v)}
            />
          ))}
        </div>
      ) : null}

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {panels.map((p, i) => (
          <PanelCell
            key={i}
            panel={p}
            columns={columns}
            parent={artifact}
            index={i}
            controlState={controlState}
            controls={controls}
          />
        ))}
      </div>
    </div>
  )
}

function ControlBar({
  control,
  value,
  onChange,
}: {
  control: DashboardControl
  value: number
  onChange: (v: number) => void
}) {
  if (control.kind === "time-slider") {
    return <TimeSliderBar control={control} value={value} onChange={onChange} />
  }
  return null
}

function TimeSliderBar({
  control,
  value,
  onChange,
}: {
  control: TimeSliderControl
  value: number
  onChange: (v: number) => void
}) {
  const hours = Array.isArray(control.hours) ? control.hours : []
  const max = Math.max(0, hours.length - 1)
  const label = control.label ?? "Hour"
  const ts = hours[value] ?? ""
  return (
    <div className="flex items-center gap-3 border border-black/10 px-3 py-2 bg-black/[0.015]">
      <span className="text-[11px] font-mark tracking-wider uppercase text-black/60 shrink-0">
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-black"
        aria-label={`${label} (control id ${control.id})`}
        disabled={max === 0}
      />
      <span className="text-[11px] font-mono text-black/70 shrink-0 tabular-nums">
        {value + 1} / {Math.max(1, hours.length)}
      </span>
      <span className="text-[11px] font-mono text-black/50 shrink-0">{ts}</span>
    </div>
  )
}

function PanelCell({
  panel,
  columns,
  parent,
  index,
  controlState,
  controls,
}: {
  panel: DashboardPanel
  columns: number
  parent: Artifact
  index: number
  controlState: Record<string, number>
  controls: DashboardControl[]
}) {
  const span = clampSpan(panel.span, columns)
  const rowSpan = Math.max(1, Math.floor(panel.row_span ?? DASHBOARD_DEFAULTS.row_span))
  return (
    <div
      className="border border-black/10 p-3 min-w-0 flex flex-col"
      style={{
        gridColumn: `span ${span} / span ${span}`,
        gridRow: `span ${rowSpan} / span ${rowSpan}`,
      }}
    >
      {panel.title ? (
        <div className="font-mark text-[11px] tracking-wider text-black/50 uppercase mb-2">
          {panel.title}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <PanelView
          panel={panel}
          parent={parent}
          index={index}
          controlState={controlState}
          controls={controls}
        />
      </div>
    </div>
  )
}

function PanelView({
  panel,
  parent,
  index,
  controlState,
  controls,
}: {
  panel: DashboardPanel
  parent: Artifact
  index: number
  controlState: Record<string, number>
  controls: DashboardControl[]
}) {
  const referenced = useReferencedArtifact(panel.artifact_id)

  // The synthetic artifact handed to the child renderer carries the panel's
  // (or referenced artifact's) view_spec + metadata, overlaid with renderer-
  // internal keys derived from the active control state. The parent dashboard
  // artifact's id is preserved so child renderers that hit
  // `/api/artifacts/<id>/topology` won't accidentally re-fetch the parent —
  // we use the referenced artifact's id if present.
  const synthetic = useMemo<Artifact>(() => {
    const baseSpec = (referenced?.view_spec ?? panel.view_spec ?? {}) as Record<string, unknown>
    const baseMetadata = (referenced?.metadata ?? panel.metadata ?? {}) as Record<string, unknown>
    const overlay = computeControlOverlay(panel, controlState, controls)
    const view_spec: Record<string, unknown> = { ...baseSpec, ...overlay }
    return {
      ...parent,
      id: referenced?.id ?? `${parent.id}#panel-${index}`,
      kind: referenced?.kind ?? "view",
      name: referenced?.name ?? panel.title ?? parent.name,
      slug: referenced?.slug ?? parent.slug,
      fs_path: referenced?.fs_path ?? parent.fs_path,
      storage_path: referenced?.storage_path ?? parent.storage_path,
      view_spec,
      metadata: baseMetadata,
      parent_id: referenced?.parent_id ?? parent.parent_id,
      parent_session_id: referenced?.parent_session_id ?? parent.parent_session_id,
      status: referenced?.status ?? parent.status,
      created_at: referenced?.created_at ?? parent.created_at,
      updated_at: referenced?.updated_at ?? parent.updated_at,
      user_id: referenced?.user_id ?? parent.user_id,
      org_id: referenced?.org_id ?? parent.org_id,
    }
  }, [panel, referenced, parent, index, controlState, controls])

  if (panel.artifact_id && referenced === undefined) {
    return (
      <div className="text-[11px] font-mono text-black/50 px-2 py-3">Loading panel…</div>
    )
  }
  if (panel.artifact_id && referenced === null) {
    return (
      <div className="text-[11px] font-mono text-red-700 border border-red-200 bg-red-50 px-2 py-2">
        Referenced artifact <span className="font-mono">{panel.artifact_id}</span> not
        accessible.
      </div>
    )
  }

  return renderChildPanel(panel.renderer as RendererName, synthetic)
}

function renderChildPanel(name: RendererName, artifact: Artifact) {
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
    case "network-graph":
      return <NetworkGraphRenderer artifact={artifact} />
    case "geo-map":
      return <GeoMapRenderer artifact={artifact} />
    case "run":
      return <RunRenderer artifact={artifact} />
    case "dashboard":
      return <DashboardRenderer artifact={artifact} />
    case "file":
    default:
      return <FileRenderer artifact={artifact} />
  }
}

// Build the overlay applied on top of the panel's view_spec for this render.
// Every renderer that ships with the platform reads `_controlled_hour_idx`;
// authors can additionally request the value land under a custom key via
// `share_controls`.
function computeControlOverlay(
  panel: DashboardPanel,
  controlState: Record<string, number>,
  controls: DashboardControl[],
): Record<string, unknown> {
  const overlay: Record<string, unknown> = {}
  const share = panel.share_controls ?? {}
  for (const [controlId, viewKey] of Object.entries(share)) {
    const value = controlState[controlId]
    if (value === undefined) continue
    overlay[viewKey] = value
    const control = controls.find((c) => c.id === controlId)
    if (control?.kind === "time-slider") {
      overlay._controlled_hour_idx = value
    }
  }
  return overlay
}

// Resolve `panel.artifact_id` by hitting /api/artifacts/<id>. Returns
// `undefined` while loading, `null` on failure, the artifact otherwise. The
// dashboard is a client component, so this stays a client-side fetch.
function useReferencedArtifact(id: string | undefined): Artifact | null | undefined {
  const [state, setState] = useState<Artifact | null | undefined>(id ? undefined : null)
  useEffect(() => {
    if (!id) {
      setState(null)
      return
    }
    let aborted = false
    setState(undefined)
    fetch(`/api/artifacts/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`artifact ${r.status}`)
        return (await r.json()) as Artifact
      })
      .then((a) => {
        if (!aborted) setState(a)
      })
      .catch(() => {
        if (!aborted) setState(null)
      })
    return () => {
      aborted = true
    }
  }, [id])
  return state
}

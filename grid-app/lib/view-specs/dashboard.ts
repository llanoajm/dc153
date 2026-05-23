// Dashboard view spec schema (ROADMAP §11.8, LOOP_QUEUE item 16).
//
// A dashboard is an artifact (kind='view' or kind='dashboard') whose
// `view_spec` declares a layout of panels and an optional set of shared
// controls. Built so that the agent can compose existing renderers (chart,
// table, network-graph, geo-map, run, markdown, code, diff, file, log) into a
// single saveable, re-renderable layout.
//
// Authoring this schema is intentionally cheap: every field is optional, every
// renderer-specific view spec is forwarded verbatim. The dashboard renderer
// dispatches each panel through the same renderer registry the rest of the app
// uses, so anything the agent can put in an artifact it can also put in a
// panel.
//
// Example minimal spec:
//
//   {
//     "renderer": "dashboard",
//     "title": "WECC 240 quick look",
//     "columns": 4,
//     "controls": [
//       { "id": "hour", "kind": "time-slider", "hours": ["2030-01-01T00:00", ...] }
//     ],
//     "panels": [
//       {
//         "title": "LMP map",
//         "renderer": "geo-map",
//         "span": 3,
//         "share_controls": { "hour": "hour" },
//         "artifact_id": "<network-artifact-uuid>"     // or inline view_spec
//       },
//       {
//         "title": "Dispatch by carrier",
//         "renderer": "chart",
//         "span": 1,
//         "view_spec": { "mark": "area", "encoding": { ... } }
//       }
//     ]
//   }
//
// Saved as an artifact row, the dashboard re-renders identically next time:
// the renderer recomputes the layout purely from `view_spec`. There is no
// hidden runtime state.

import type { RendererName } from "@/components/renderers/types"

// Renderer names allowed as a panel renderer. Mirrors the central
// `RendererName` union — the dashboard accepts every built-in renderer. The
// `dashboard` renderer itself is allowed so you can nest a sub-dashboard.
export type DashboardPanelRenderer = RendererName

// A control mounted at the top of the dashboard and shared across panels that
// opt in via `panel.share_controls`. Today only the `time-slider` is wired —
// the schema is extensible so future control kinds (carrier filters, scenario
// selectors) drop in without churning panel authors.
export interface TimeSliderControl {
  kind: "time-slider"
  id: string
  // Human-readable label shown next to the slider. Defaults to "Hour".
  label?: string
  // Ordered timestamps the slider scrubs through. Each panel that subscribes
  // gets the panel-level value injected as the current index (number) at
  // render time.
  hours: string[]
  // Optional default index. Bounded to [0, hours.length-1].
  default_index?: number
}

export type DashboardControl = TimeSliderControl

// A single panel slot. Either `view_spec` (inline data) or `artifact_id`
// (reference to an existing artifact whose view_spec the dashboard pulls at
// render time) — the renderer prefers `artifact_id` when both are set.
//
// `share_controls` maps a control id (from the dashboard's `controls` list) to
// a key the renderer recognizes on `view_spec`. The dashboard renderer writes
// the live control value under that key on a *synthetic* copy of the panel's
// view spec before handing it to the child renderer — the source artifact is
// never mutated.
//
// Built-in mappings:
//   - geo-map / network-graph: write `_controlled_hour_idx` (number)
//   - run / chart: write `_controlled_hour_idx` for renderers that honour it
export interface DashboardPanel {
  title?: string
  // 1..N grid columns (clamped to dashboard `columns`). Default 4.
  span?: number
  // 1..N grid rows. Default 1.
  row_span?: number
  renderer: DashboardPanelRenderer
  // Inline view spec — same shape the renderer accepts at the top level. If
  // omitted, the panel must set `artifact_id`.
  view_spec?: Record<string, unknown>
  // Inline metadata forwarded to the child renderer (status badges, fs path).
  metadata?: Record<string, unknown>
  // Reference an existing artifact instead of inlining. The renderer resolves
  // the row server-side and uses its `view_spec` + `metadata` + `fs_path` for
  // the child renderer. Lets a dashboard be a thin composition layer over
  // already-saved networks / runs / reports.
  artifact_id?: string
  // Map control id → view_spec key. Example: { "hour": "hour" } means "inject
  // the current value of the dashboard's control with id 'hour' into the
  // panel's view_spec under key 'hour'". The dashboard always also writes
  // `_controlled_hour_idx` so renderers that ship with the platform know what
  // to listen for without coupling to a specific key name.
  share_controls?: Record<string, string>
}

// Top-level dashboard view spec.
export interface DashboardViewSpec {
  renderer?: "dashboard"
  title?: string
  description?: string
  // Grid column count. Defaults to 4.
  columns?: number
  controls?: DashboardControl[]
  panels: DashboardPanel[]
}

// Default values. Renderers and helpers must use these constants instead of
// hard-coding so that "default 4-column" stays consistent across the codebase.
export const DASHBOARD_DEFAULTS = {
  columns: 4,
  span: 4,
  row_span: 1,
} as const

// Programmatic check that a value looks like a dashboard view spec. Used by
// the agentic authoring flow + the renderer for early sanity feedback. Returns
// null on success; otherwise returns a short error string.
export function validateDashboardSpec(spec: unknown): string | null {
  if (!spec || typeof spec !== "object") return "view_spec is not an object"
  const s = spec as Record<string, unknown>
  if (!Array.isArray(s.panels)) return "view_spec.panels must be an array"
  if (s.panels.length === 0) return "view_spec.panels is empty"
  for (let i = 0; i < s.panels.length; i++) {
    const p = s.panels[i] as Record<string, unknown> | null
    if (!p || typeof p !== "object") return `panels[${i}] is not an object`
    if (typeof p.renderer !== "string") return `panels[${i}].renderer must be a string`
    if (!p.view_spec && !p.artifact_id) {
      return `panels[${i}] must set either view_spec or artifact_id`
    }
  }
  if (s.controls !== undefined && !Array.isArray(s.controls)) {
    return "view_spec.controls must be an array"
  }
  if (s.columns !== undefined && typeof s.columns !== "number") {
    return "view_spec.columns must be a number"
  }
  return null
}

// Clamp a span value to the dashboard grid range.
export function clampSpan(span: number | undefined, columns: number): number {
  const cols = Math.max(1, Math.floor(columns))
  if (typeof span !== "number" || !Number.isFinite(span)) return cols
  if (span < 1) return 1
  if (span > cols) return cols
  return Math.floor(span)
}

// Return the initial value for each declared control, indexed by control id.
// time-slider → number (the default_index, clamped).
export function initialControlState(spec: DashboardViewSpec): Record<string, number> {
  const out: Record<string, number> = {}
  const controls = Array.isArray(spec.controls) ? spec.controls : []
  for (const c of controls) {
    if (c.kind === "time-slider") {
      const n = Array.isArray(c.hours) ? c.hours.length : 0
      const def = typeof c.default_index === "number" ? Math.floor(c.default_index) : 0
      out[c.id] = clampToRange(def, 0, Math.max(0, n - 1))
    }
  }
  return out
}

function clampToRange(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

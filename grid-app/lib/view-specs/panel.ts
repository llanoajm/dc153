// Sandboxed custom-panel view spec (ROADMAP §11.8, LOOP_QUEUE item 17).
//
// A "panel" is an agent-authored mini interactive UI rendered inside the
// workspace. We deliberately do NOT execute JSX text strings (that path leads
// to `eval`, transpilation, dynamic-import, or VM2-shaped trouble). Instead the
// agent emits a JSON tree whose nodes are restricted to an allowlisted
// component vocabulary and whose props are validated against per-component
// schemas. The runner (`components/sandbox/PanelHost.tsx`) walks the tree and
// renders React elements; there is no string-to-code path inside the sandbox.
//
// Constraints (this is the "JSX subset spec" the roadmap references):
//
//   1. Only the components listed in `PANEL_COMPONENTS` below may appear as a
//      node's `type`. Unknown types render an inline error and skip the node;
//      the rest of the panel keeps rendering so a single bad node doesn't kill
//      the whole UI.
//   2. Props must be plain JSON. No functions, no React elements, no class
//      instances. The runner forwards only the per-component allowlisted keys
//      and ignores the rest.
//   3. The only side-effect channel is `Action`s on event props (`on_click`,
//      `on_change`). Actions are themselves JSON, evaluated by the runner
//      against a single map of named state. No `eval`, no DOM access, no
//      navigation outside the allowed verbs (`set_state`, `open_artifact`).
//   4. Dynamic values use `{"$bind": "path.to.value"}` leaves resolved
//      against state at render time. There is no expression DSL — only path
//      lookup. This keeps the surface area auditable.
//   5. The runner never reads `document`, `window`, or `fetch` on the
//      panel's behalf. The only network call is `ArtifactView` fetching a
//      single artifact by id — exactly the same call the dashboard renderer
//      makes when a panel references another artifact.
//
// Promotion ladder (also enforced by the spec's `metadata`):
//   - draft (ephemeral chat output): `kind='panel'`, `status='draft'`
//   - pinned (visible in the workspace rail): `metadata.pinned = true`
//   - skill (callable by name): `metadata.promoted_to_skill = true` plus a
//     `skill` artifact row pointing at this panel by `parent_id`.
//
// Example minimal panel spec:
//
//   {
//     "renderer": "panel",
//     "title": "WECC hour scrubber",
//     "state": { "hour": 0, "max": 23 },
//     "root": {
//       "type": "Stack",
//       "props": { "gap": "md" },
//       "children": [
//         { "type": "Heading", "props": { "level": 2, "text": "Pick an hour" } },
//         { "type": "Slider", "props": {
//             "bind": "hour", "min": 0, "max": 23, "step": 1, "label": "Hour"
//         }},
//         { "type": "Metric", "props": {
//             "label": "Selected hour",
//             "value": { "$bind": "hour" },
//             "unit": "h"
//         }}
//       ]
//     }
//   }

// -----------------------------------------------------------------------------
// Component vocabulary
// -----------------------------------------------------------------------------

// Component names that may appear as a node's `type`. The runner ignores any
// other value. Authors should treat this list as the canonical JSX subset —
// the platform may grow it but never shrink it without bumping a schema
// version on the panel.
export const PANEL_COMPONENTS = [
  // layout
  "Stack",
  "Row",
  "Box",
  "Grid",
  // typography
  "Heading",
  "Text",
  "Markdown",
  "Code",
  // data display
  "Metric",
  "Badge",
  "Table",
  // controls
  "Button",
  "Slider",
  "Select",
  "NumberInput",
  "TextInput",
  "Toggle",
  // composed renderers (delegate to existing artifact renderers)
  "ChartPanel",
  "ArtifactView",
] as const

export type PanelComponentName = (typeof PANEL_COMPONENTS)[number]

// -----------------------------------------------------------------------------
// Node shape
// -----------------------------------------------------------------------------

// A single node in the panel tree. Props are an unstructured map — each
// component narrows what it reads. Children may be a literal string (rendered
// as text inside the component) or an array of further nodes.
export interface PanelNode {
  type: PanelComponentName | string
  props?: Record<string, unknown>
  children?: PanelNode[] | string
}

// -----------------------------------------------------------------------------
// Dynamic-value bindings
// -----------------------------------------------------------------------------

// Recognised binding shapes (resolved by the runner at render time):
//   { "$bind": "path" }       — read state[path] (supports `a.b.c`)
//   { "$fmt": "Hour {h}/{n}", "values": { "h": <Bind>, "n": <Bind> } }
//   { "$eq": [<Bind>, <Bind>] } — boolean equality, for `disabled`/`hidden`
//
// Anything else is a literal value passed through verbatim.

export interface BindRef {
  $bind: string
}

export interface FmtRef {
  $fmt: string
  values?: Record<string, unknown>
}

export interface EqRef {
  $eq: [unknown, unknown]
}

export type DynamicValue = BindRef | FmtRef | EqRef

export function isBindRef(v: unknown): v is BindRef {
  return (
    typeof v === "object" && v !== null && typeof (v as BindRef).$bind === "string"
  )
}
export function isFmtRef(v: unknown): v is FmtRef {
  return (
    typeof v === "object" && v !== null && typeof (v as FmtRef).$fmt === "string"
  )
}
export function isEqRef(v: unknown): v is EqRef {
  return typeof v === "object" && v !== null && Array.isArray((v as EqRef).$eq)
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

// The runner's action verbs. New verbs require an explicit case in the runner —
// there is no escape hatch.
export type PanelAction =
  | { kind: "set_state"; key: string; value: unknown }
  | { kind: "toggle_state"; key: string }
  | { kind: "increment_state"; key: string; by?: number; min?: number; max?: number }
  | { kind: "open_artifact"; id: string }

export function isPanelAction(v: unknown): v is PanelAction {
  if (!v || typeof v !== "object") return false
  const kind = (v as { kind?: unknown }).kind
  return (
    kind === "set_state" ||
    kind === "toggle_state" ||
    kind === "increment_state" ||
    kind === "open_artifact"
  )
}

// -----------------------------------------------------------------------------
// Top-level panel view spec
// -----------------------------------------------------------------------------

export interface PanelViewSpec {
  renderer?: "panel"
  title?: string
  description?: string
  // Initial state map. Keys are strings; values may be any JSON. The runner
  // copies this into a React `useState` on mount; subsequent edits stay
  // in-memory (no persistence — a refresh resets to `state`).
  state?: Record<string, unknown>
  // The root node of the panel tree. Required; the renderer shows a
  // placeholder if absent.
  root?: PanelNode
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

// Returns `null` on success or a short error message describing the first
// problem encountered. Intended to be cheap enough to run before pin /
// promotion so the user sees structural errors without having to mount the
// panel.
export function validatePanelSpec(spec: unknown): string | null {
  if (!spec || typeof spec !== "object") return "view_spec is not an object"
  const s = spec as PanelViewSpec
  if (s.state !== undefined && (typeof s.state !== "object" || Array.isArray(s.state))) {
    return "view_spec.state must be an object"
  }
  if (!s.root) return "view_spec.root is required"
  return validateNode(s.root, "root")
}

function validateNode(node: unknown, path: string): string | null {
  if (!node || typeof node !== "object") return `${path} is not an object`
  const n = node as PanelNode
  if (typeof n.type !== "string") return `${path}.type must be a string`
  if (!isAllowedComponent(n.type)) {
    return `${path}.type '${n.type}' is not in the allowlist`
  }
  if (n.props !== undefined && (typeof n.props !== "object" || Array.isArray(n.props))) {
    return `${path}.props must be an object`
  }
  if (n.children !== undefined && !Array.isArray(n.children) && typeof n.children !== "string") {
    return `${path}.children must be an array or string`
  }
  if (Array.isArray(n.children)) {
    for (let i = 0; i < n.children.length; i++) {
      const err = validateNode(n.children[i], `${path}.children[${i}]`)
      if (err) return err
    }
  }
  return null
}

export function isAllowedComponent(name: string): name is PanelComponentName {
  return (PANEL_COMPONENTS as readonly string[]).includes(name)
}

// -----------------------------------------------------------------------------
// State path lookup
// -----------------------------------------------------------------------------

// Walk a dotted path against a state map. Returns `undefined` on miss. Used by
// the runner's `$bind` resolver. Kept here so the validator and the runner
// agree on path semantics.
export function readPath(state: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined
  const segments = path.split(".")
  let cur: unknown = state
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

// Defaults used by the runner. Authors should not need to reference these;
// listed for symmetry with `DASHBOARD_DEFAULTS`.
export const PANEL_DEFAULTS = {
  gridColumns: 2,
  spacingGap: "md" as "sm" | "md" | "lg",
} as const

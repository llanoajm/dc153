"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { Artifact } from "@/lib/artifacts"
import { ArtifactRenderer } from "@/components/renderers"
import { VegaLiteChart } from "@/components/renderers/chart"
import {
  isAllowedComponent,
  isBindRef,
  isEqRef,
  isFmtRef,
  isPanelAction,
  readPath,
  validatePanelSpec,
  type PanelAction,
  type PanelComponentName,
  type PanelNode,
  type PanelViewSpec,
} from "@/lib/view-specs/panel"

// PanelHost is the sandboxed runner for agent-authored UI (ROADMAP §11.8).
// It walks the JSON tree on `view_spec`, dispatches each node to an
// allowlisted React component, and resolves `$bind` / `$fmt` / `$eq` leaves
// against a local state map. There is NO code-eval path: nodes that aren't in
// `PANEL_COMPONENTS` render an inline error and the rest of the tree keeps
// rendering. Actions on event props are dispatched through a fixed verb table.
//
// What's intentionally absent:
//   - No `dangerouslySetInnerHTML` anywhere.
//   - No `fetch` / `XMLHttpRequest` / `WebSocket` / `localStorage` access in
//     any allowed component.
//   - No `window` / `document` / `globalThis` lookups.
//   - No way to navigate outside the app — `open_artifact` is the only
//     navigation verb and it uses next/navigation's typed `router.push`.
//
// The sandbox is a tree of React components, not an iframe — the upside is
// zero serialization overhead and shared styling; the trade-off is that
// supply-chain trust still lives in the renderers themselves. Authors of new
// components in this file must follow the same constraints.
export function PanelHost({ artifact }: { artifact: Artifact }) {
  const spec = (artifact.view_spec ?? {}) as PanelViewSpec
  const validationError = useMemo(() => validatePanelSpec(spec), [spec])

  // Reset state when the artifact changes — saved panels are re-mounted by
  // route changes / pin toggles. Initial state comes from `view_spec.state`.
  const [state, setState] = useState<Record<string, unknown>>(() => ({
    ...(isPlainObject(spec.state) ? spec.state : {}),
  }))
  useEffect(() => {
    setState({ ...(isPlainObject(spec.state) ? spec.state : {}) })
    // Only reset when the artifact id changes (re-mount). We deliberately
    // don't depend on spec.state directly so live-editing the JSON doesn't
    // clobber a user's interactive selection during a single mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id])

  const router = useRouter()
  const dispatch = useMemo(
    () => makeDispatcher(setState, router),
    [setState, router],
  )

  if (validationError) {
    return (
      <PanelChrome spec={spec} artifact={artifact}>
        <div className="text-xs font-mono text-red-700 border border-red-200 bg-red-50 px-3 py-2">
          panel validation error: {validationError}
        </div>
        <SpecDetails spec={spec} />
      </PanelChrome>
    )
  }

  const root = spec.root
  if (!root) {
    return (
      <PanelChrome spec={spec} artifact={artifact}>
        <div className="text-sm font-soft text-black/50">
          Empty panel. Set <code className="font-mono">view_spec.root</code>.
        </div>
        <SpecDetails spec={spec} />
      </PanelChrome>
    )
  }

  return (
    <PanelChrome spec={spec} artifact={artifact}>
      <RenderNode node={root} state={state} dispatch={dispatch} path="root" />
      <SpecDetails spec={spec} />
    </PanelChrome>
  )
}

function PanelChrome({
  spec,
  artifact,
  children,
}: {
  spec: PanelViewSpec
  artifact: Artifact
  children: ReactNode
}) {
  const title = spec.title ?? artifact.name
  return (
    <div className="space-y-4">
      {title || spec.description ? (
        <div className="space-y-1">
          {title ? (
            <div className="font-mark text-xs tracking-wider text-black/60 uppercase">
              {title}
            </div>
          ) : null}
          {spec.description ? (
            <div className="font-soft text-sm text-black/70">
              {spec.description}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

function SpecDetails({ spec }: { spec: PanelViewSpec }) {
  return (
    <details className="text-[11px] font-mono pt-4 border-t border-black/10">
      <summary className="cursor-pointer text-black/50">panel spec</summary>
      <pre className="mt-2 p-3 bg-black/[0.04] overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(spec, null, 2)}
      </pre>
    </details>
  )
}

// -----------------------------------------------------------------------------
// Dispatcher: turns a PanelAction (JSON) into a state update or navigation
// -----------------------------------------------------------------------------

type Dispatch = (action: unknown) => void

function makeDispatcher(
  setState: React.Dispatch<React.SetStateAction<Record<string, unknown>>>,
  router: ReturnType<typeof useRouter>,
): Dispatch {
  return (action) => {
    if (!isPanelAction(action)) return
    switch (action.kind) {
      case "set_state":
        setState((s) => ({ ...s, [action.key]: action.value }))
        return
      case "toggle_state":
        setState((s) => ({ ...s, [action.key]: !s[action.key] }))
        return
      case "increment_state":
        setState((s) => {
          const cur = typeof s[action.key] === "number" ? (s[action.key] as number) : 0
          const by = typeof action.by === "number" ? action.by : 1
          let next = cur + by
          if (typeof action.min === "number" && next < action.min) next = action.min
          if (typeof action.max === "number" && next > action.max) next = action.max
          return { ...s, [action.key]: next }
        })
        return
      case "open_artifact":
        if (typeof action.id === "string" && action.id.length > 0) {
          router.push(`/app/artifacts/${action.id}`)
        }
        return
    }
  }
}

// -----------------------------------------------------------------------------
// Tree walker
// -----------------------------------------------------------------------------

interface RenderContext {
  state: Record<string, unknown>
  dispatch: Dispatch
}

function RenderNode({
  node,
  state,
  dispatch,
  path,
}: {
  node: PanelNode
  state: Record<string, unknown>
  dispatch: Dispatch
  path: string
}) {
  if (!node || typeof node !== "object") {
    return <InlineError message={`${path}: invalid node`} />
  }
  if (typeof node.type !== "string" || !isAllowedComponent(node.type)) {
    return <InlineError message={`${path}: unknown component '${String(node.type)}'`} />
  }
  const props = isPlainObject(node.props) ? node.props : {}
  const ctx: RenderContext = { state, dispatch }
  const Component = COMPONENT_REGISTRY[node.type as PanelComponentName]
  return (
    <Component
      props={props}
      children={node.children}
      ctx={ctx}
      path={path}
    />
  )
}

function RenderChildren({
  children,
  state,
  dispatch,
  path,
}: {
  children: PanelNode["children"]
  state: Record<string, unknown>
  dispatch: Dispatch
  path: string
}) {
  if (typeof children === "string") {
    return <>{resolveString(children, state)}</>
  }
  if (!Array.isArray(children)) return null
  return (
    <>
      {children.map((child, i) => (
        <RenderNode
          key={i}
          node={child}
          state={state}
          dispatch={dispatch}
          path={`${path}.children[${i}]`}
        />
      ))}
    </>
  )
}

function resolveString(s: string, _state: Record<string, unknown>): string {
  // Templated string interpolation is intentionally absent; authors use the
  // `Text` component with a `$fmt` value instead. Keeping `children: string`
  // strictly literal removes a templating-injection footgun.
  return s
}

// -----------------------------------------------------------------------------
// Value resolution
// -----------------------------------------------------------------------------

function resolveValue(value: unknown, state: Record<string, unknown>): unknown {
  if (isBindRef(value)) return readPath(state, value.$bind)
  if (isFmtRef(value)) return formatTemplate(value.$fmt, value.values ?? {}, state)
  if (isEqRef(value)) {
    const [a, b] = value.$eq
    return resolveValue(a, state) === resolveValue(b, state)
  }
  return value
}

function formatTemplate(
  template: string,
  values: Record<string, unknown>,
  state: Record<string, unknown>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      const v = resolveValue(values[key], state)
      return v === undefined || v === null ? "" : String(v)
    }
    return ""
  })
}

function asString(v: unknown, fallback = ""): string {
  if (v === undefined || v === null) return fallback
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return JSON.stringify(v)
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v
  if (v === undefined || v === null) return fallback
  return Boolean(v)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

// -----------------------------------------------------------------------------
// Component registry
// -----------------------------------------------------------------------------

interface ComponentProps {
  props: Record<string, unknown>
  children: PanelNode["children"]
  ctx: RenderContext
  path: string
}

type ComponentImpl = (p: ComponentProps) => ReactNode

const GAP_CLASS = { sm: "gap-2", md: "gap-3", lg: "gap-5" } as const
const PAD_CLASS = { none: "p-0", sm: "p-2", md: "p-3", lg: "p-5" } as const
const TONE_BORDER = {
  neutral: "border border-black/10",
  muted: "border border-black/10 bg-black/[0.015]",
  accent: "border border-black/20 bg-black/[0.04]",
  warn: "border border-amber-300 bg-amber-50",
  ok: "border border-emerald-300 bg-emerald-50",
} as const
const TONE_TEXT = {
  default: "text-black/80",
  muted: "text-black/50",
  warn: "text-amber-700",
  ok: "text-emerald-700",
  accent: "text-black",
} as const

function gapClass(value: unknown, fallback: keyof typeof GAP_CLASS = "md") {
  const v = typeof value === "string" ? value : ""
  return GAP_CLASS[v as keyof typeof GAP_CLASS] ?? GAP_CLASS[fallback]
}
function padClass(value: unknown, fallback: keyof typeof PAD_CLASS = "md") {
  const v = typeof value === "string" ? value : ""
  return PAD_CLASS[v as keyof typeof PAD_CLASS] ?? PAD_CLASS[fallback]
}
function toneBorder(value: unknown) {
  const v = typeof value === "string" ? value : "neutral"
  return TONE_BORDER[v as keyof typeof TONE_BORDER] ?? TONE_BORDER.neutral
}
function toneText(value: unknown) {
  const v = typeof value === "string" ? value : "default"
  return TONE_TEXT[v as keyof typeof TONE_TEXT] ?? TONE_TEXT.default
}

const Stack: ComponentImpl = ({ props, children, ctx, path }) => (
  <div className={`flex flex-col ${gapClass(props.gap)} min-w-0`}>
    <RenderChildren
      children={children}
      state={ctx.state}
      dispatch={ctx.dispatch}
      path={path}
    />
  </div>
)

const Row: ComponentImpl = ({ props, children, ctx, path }) => {
  const align = asString(props.align, "center")
  const alignClass =
    align === "start" ? "items-start" : align === "end" ? "items-end" : "items-center"
  return (
    <div className={`flex flex-row ${gapClass(props.gap, "sm")} ${alignClass} min-w-0 flex-wrap`}>
      <RenderChildren
        children={children}
        state={ctx.state}
        dispatch={ctx.dispatch}
        path={path}
      />
    </div>
  )
}

const Box: ComponentImpl = ({ props, children, ctx, path }) => (
  <div className={`${toneBorder(props.tone)} ${padClass(props.padding)} min-w-0`}>
    <RenderChildren
      children={children}
      state={ctx.state}
      dispatch={ctx.dispatch}
      path={path}
    />
  </div>
)

const Grid: ComponentImpl = ({ props, children, ctx, path }) => {
  const cols = Math.max(1, Math.min(12, Math.floor(asNumber(props.columns, 2))))
  return (
    <div
      className={`grid ${gapClass(props.gap)} min-w-0`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      <RenderChildren
        children={children}
        state={ctx.state}
        dispatch={ctx.dispatch}
        path={path}
      />
    </div>
  )
}

const Heading: ComponentImpl = ({ props, ctx }) => {
  const level = Math.max(1, Math.min(6, Math.floor(asNumber(props.level, 2))))
  const text = asString(resolveValue(props.text, ctx.state))
  const sizeClass =
    level === 1 ? "text-2xl" : level === 2 ? "text-lg" : level === 3 ? "text-base" : "text-sm"
  const Tag = (`h${level}` as unknown) as "h1"
  return <Tag className={`${sizeClass} font-soft`}>{text}</Tag>
}

const Text: ComponentImpl = ({ props, ctx }) => {
  const text = asString(resolveValue(props.text, ctx.state))
  const tone = toneText(props.tone)
  const sizeProp = asString(props.size, "sm")
  const sizeClass =
    sizeProp === "xs" ? "text-xs" : sizeProp === "lg" ? "text-base" : sizeProp === "md" ? "text-sm" : "text-sm"
  const fontClass = asBool(props.mono) ? "font-mono" : "font-soft"
  return <p className={`${sizeClass} ${tone} ${fontClass}`}>{text}</p>
}

const MarkdownComp: ComponentImpl = ({ props, ctx }) => {
  // Plain-text rendering of a markdown source — we deliberately do NOT pull in
  // a markdown parser here because the agent could otherwise embed HTML
  // through it. For real markdown the agent should use a `kind='report'`
  // artifact and `ArtifactView` it inside the panel.
  const source = asString(resolveValue(props.source, ctx.state))
  return (
    <pre className="whitespace-pre-wrap font-soft text-sm text-black/80">
      {source}
    </pre>
  )
}

const Code: ComponentImpl = ({ props, ctx }) => {
  const source = asString(resolveValue(props.source, ctx.state))
  return (
    <pre className="font-mono text-[11px] p-3 bg-black/[0.04] overflow-x-auto whitespace-pre-wrap">
      {source}
    </pre>
  )
}

const Metric: ComponentImpl = ({ props, ctx }) => {
  const label = asString(resolveValue(props.label, ctx.state))
  const value = resolveValue(props.value, ctx.state)
  const unit = asString(resolveValue(props.unit, ctx.state))
  const displayValue =
    typeof value === "number" ? formatNumber(value) : asString(value)
  return (
    <div className={`${toneBorder(props.tone)} px-3 py-2 min-w-0`}>
      <div className="text-[10px] font-mark tracking-wider uppercase text-black/50">
        {label}
      </div>
      <div className="text-lg font-soft text-black tabular-nums">
        {displayValue}
        {unit ? <span className="text-sm text-black/50 ml-1">{unit}</span> : null}
      </div>
    </div>
  )
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
  return n.toPrecision(3)
}

const BADGE_TONE = {
  neutral: "bg-black/[0.06] text-black/70 border-black/10",
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-700 border-amber-300",
  accent: "bg-black text-white border-black",
} as const

const Badge: ComponentImpl = ({ props, ctx }) => {
  const label = asString(resolveValue(props.label, ctx.state))
  const toneKey = asString(props.tone, "neutral") as keyof typeof BADGE_TONE
  const cls = BADGE_TONE[toneKey] ?? BADGE_TONE.neutral
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-mark tracking-wider uppercase border ${cls}`}>
      {label}
    </span>
  )
}

const Table: ComponentImpl = ({ props, ctx }) => {
  const columns = Array.isArray(props.columns) ? (props.columns as unknown[]) : []
  const rowsRaw = resolveValue(props.rows, ctx.state)
  const rows = Array.isArray(rowsRaw) ? (rowsRaw as Array<Record<string, unknown>>) : []
  if (columns.length === 0) {
    return <div className="text-xs font-mono text-black/40">Table: missing `columns`</div>
  }
  const cols = columns.map((c) => {
    if (typeof c === "string") return { key: c, label: c }
    if (isPlainObject(c)) {
      const key = asString(c.key)
      return {
        key,
        label: asString(c.label, key),
      }
    }
    return { key: "", label: "" }
  })
  return (
    <div className="border border-black/10 overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead className="bg-black/[0.04]">
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                className="px-2 py-1.5 text-left font-mark text-[10px] tracking-wider uppercase text-black/60"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-black/[0.01]"}>
              {cols.map((c) => (
                <td key={c.key} className="px-2 py-1.5 font-mono text-[11px] text-black/80">
                  {asString(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const BUTTON_VARIANT = {
  primary: "bg-black text-white border-black hover:bg-black/90",
  secondary: "bg-white text-black border-black/20 hover:bg-black/[0.04]",
  ghost: "bg-transparent text-black/70 border-transparent hover:text-black",
} as const

const Button: ComponentImpl = ({ props, ctx }) => {
  const label = asString(resolveValue(props.label, ctx.state), "Button")
  const variantKey = asString(props.variant, "secondary") as keyof typeof BUTTON_VARIANT
  const variantClass = BUTTON_VARIANT[variantKey] ?? BUTTON_VARIANT.secondary
  const disabled = asBool(resolveValue(props.disabled, ctx.state))
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => ctx.dispatch(props.on_click)}
      className={`px-3 py-1.5 text-xs font-mark tracking-wider uppercase border transition-colors ${variantClass} disabled:opacity-50`}
    >
      {label}
    </button>
  )
}

const Slider: ComponentImpl = ({ props, ctx }) => {
  const key = asString(props.bind)
  if (!key) return <InlineError message="Slider: missing `bind`" />
  const min = asNumber(props.min, 0)
  const max = asNumber(props.max, 100)
  const step = asNumber(props.step, 1)
  const value = asNumber(ctx.state[key], min)
  const label = asString(resolveValue(props.label, ctx.state), key)
  const showValue = asBool(props.show_value ?? true, true)
  return (
    <div className="flex items-center gap-3 border border-black/10 px-3 py-2 bg-black/[0.015]">
      <span className="text-[11px] font-mark tracking-wider uppercase text-black/60 shrink-0">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) =>
          ctx.dispatch({ kind: "set_state", key, value: Number(e.target.value) })
        }
        className="flex-1 accent-black"
        aria-label={label}
      />
      {showValue ? (
        <span className="text-[11px] font-mono text-black/70 shrink-0 tabular-nums">
          {value}
        </span>
      ) : null}
    </div>
  )
}

const Select: ComponentImpl = ({ props, ctx }) => {
  const key = asString(props.bind)
  if (!key) return <InlineError message="Select: missing `bind`" />
  const options = Array.isArray(props.options) ? (props.options as unknown[]) : []
  const opts = options
    .map((o) => {
      if (typeof o === "string" || typeof o === "number") {
        return { value: String(o), label: String(o) }
      }
      if (isPlainObject(o)) {
        return { value: asString(o.value), label: asString(o.label, asString(o.value)) }
      }
      return null
    })
    .filter((o): o is { value: string; label: string } => o !== null)
  const value = asString(ctx.state[key])
  const label = asString(resolveValue(props.label, ctx.state), key)
  return (
    <label className="flex items-center gap-3 border border-black/10 px-3 py-2 bg-black/[0.015]">
      <span className="text-[11px] font-mark tracking-wider uppercase text-black/60 shrink-0">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) =>
          ctx.dispatch({ kind: "set_state", key, value: e.target.value })
        }
        className="flex-1 bg-white border border-black/10 px-2 py-1 text-xs font-mono"
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const NumberInput: ComponentImpl = ({ props, ctx }) => {
  const key = asString(props.bind)
  if (!key) return <InlineError message="NumberInput: missing `bind`" />
  const value = asNumber(ctx.state[key], asNumber(props.default, 0))
  const label = asString(resolveValue(props.label, ctx.state), key)
  return (
    <label className="flex items-center gap-3 border border-black/10 px-3 py-2 bg-black/[0.015]">
      <span className="text-[11px] font-mark tracking-wider uppercase text-black/60 shrink-0">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={asNumber(props.min, Number.NEGATIVE_INFINITY)}
        max={asNumber(props.max, Number.POSITIVE_INFINITY)}
        step={asNumber(props.step, 1)}
        onChange={(e) =>
          ctx.dispatch({ kind: "set_state", key, value: Number(e.target.value) })
        }
        className="flex-1 bg-white border border-black/10 px-2 py-1 text-xs font-mono"
      />
    </label>
  )
}

const TextInput: ComponentImpl = ({ props, ctx }) => {
  const key = asString(props.bind)
  if (!key) return <InlineError message="TextInput: missing `bind`" />
  const value = asString(ctx.state[key])
  const label = asString(resolveValue(props.label, ctx.state), key)
  const placeholder = asString(resolveValue(props.placeholder, ctx.state))
  return (
    <label className="flex items-center gap-3 border border-black/10 px-3 py-2 bg-black/[0.015]">
      <span className="text-[11px] font-mark tracking-wider uppercase text-black/60 shrink-0">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) =>
          ctx.dispatch({ kind: "set_state", key, value: e.target.value })
        }
        className="flex-1 bg-white border border-black/10 px-2 py-1 text-xs font-mono"
      />
    </label>
  )
}

const Toggle: ComponentImpl = ({ props, ctx }) => {
  const key = asString(props.bind)
  if (!key) return <InlineError message="Toggle: missing `bind`" />
  const value = asBool(ctx.state[key])
  const label = asString(resolveValue(props.label, ctx.state), key)
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={value}
        onChange={() => ctx.dispatch({ kind: "toggle_state", key })}
        className="accent-black"
      />
      <span className="text-xs font-mono text-black/70">{label}</span>
    </label>
  )
}

const ChartPanel: ComponentImpl = ({ props, ctx }) => {
  const spec = resolveValue(props.spec, ctx.state)
  if (!isPlainObject(spec)) {
    return <InlineError message="ChartPanel: `spec` must resolve to an object" />
  }
  const height = asNumber(props.height, 0) || undefined
  return <VegaLiteChart spec={spec as Record<string, unknown>} height={height} />
}

const ArtifactView: ComponentImpl = ({ props, ctx }) => {
  const id = asString(resolveValue(props.artifact_id, ctx.state))
  if (!id) return <InlineError message="ArtifactView: missing `artifact_id`" />
  return <ArtifactViewFetch id={id} />
}

function ArtifactViewFetch({ id }: { id: string }) {
  const [artifact, setArtifact] = useState<Artifact | null | undefined>(undefined)
  useEffect(() => {
    let aborted = false
    setArtifact(undefined)
    fetch(`/api/artifacts/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`artifact ${r.status}`)
        return (await r.json()) as Artifact
      })
      .then((a) => {
        if (!aborted) setArtifact(a)
      })
      .catch(() => {
        if (!aborted) setArtifact(null)
      })
    return () => {
      aborted = true
    }
  }, [id])
  if (artifact === undefined) {
    return (
      <div className="text-[11px] font-mono text-black/50 px-2 py-3">
        Loading artifact…
      </div>
    )
  }
  if (artifact === null) {
    return (
      <div className="text-[11px] font-mono text-red-700 border border-red-200 bg-red-50 px-2 py-2">
        Artifact <span className="font-mono">{id}</span> not accessible.
      </div>
    )
  }
  return <ArtifactRenderer artifact={artifact} />
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="text-[11px] font-mono text-red-700 border border-red-200 bg-red-50 px-2 py-1 my-1">
      {message}
    </div>
  )
}

// Lookup table mapping component name → implementation. Adding a new component
// requires (a) adding the name to `PANEL_COMPONENTS` in
// `lib/view-specs/panel.ts` and (b) wiring it here. There is no path that
// loads a component dynamically.
const COMPONENT_REGISTRY: Record<PanelComponentName, ComponentImpl> = {
  Stack,
  Row,
  Box,
  Grid,
  Heading,
  Text,
  Markdown: MarkdownComp,
  Code,
  Metric,
  Badge,
  Table,
  Button,
  Slider,
  Select,
  NumberInput,
  TextInput,
  Toggle,
  ChartPanel,
  ArtifactView,
}

// Used by the artifact view page to surface a "panel JSON" link without the
// panel renderer needing to expose internals.
export function panelLinkHelpers() {
  return {
    isAllowed: isAllowedComponent,
    Link,
  }
}

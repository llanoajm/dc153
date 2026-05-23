"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { RendererProps } from "./types"

// MapLibre + OpenStreetMap geo-map renderer for ROADMAP §11.7.
//
// view_spec shape (any of these may be omitted; the renderer also falls back
// to /api/artifacts/<id>/topology if no inline topology is provided):
//   { renderer: "geo-map",
//     buses?: Array<{ id; x?; y?; carrier? }>,           // x=lon, y=lat
//     lines?: Array<{ source; target; s_nom?; carrier?; dc?: boolean }>,
//     counts?: { buses?; lines?; generators? },
//     dispatch?: {
//       hours: string[],                                  // ISO timestamps
//       lmps?: Record<string, number[]>,                  // busId → $/MWh per hour
//       flows?: Record<string, number[]>,                 // "src|tgt" or line index → MW per hour
//     },
//   }
//
// LMP color overlay + time slider are driven by `dispatch`. If absent, the
// map shows static topology + line-capacity styling.

interface RawBus {
  id: string
  x?: number
  y?: number
  carrier?: string
}
interface RawLine {
  source: string
  target: string
  s_nom?: number
  carrier?: string
  dc?: boolean
}
interface DispatchPayload {
  hours: string[]
  lmps?: Record<string, number[]>
  flows?: Record<string, number[]>
}
interface TopologyPayload {
  buses?: RawBus[]
  lines?: RawLine[]
  counts?: { buses?: number; lines?: number; generators?: number }
  truncated?: boolean
  dispatch?: DispatchPayload
}

type MapLibreModule = typeof import("maplibre-gl")
type MapLibreMap = import("maplibre-gl").Map

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster" as const,
      source: "osm",
      minzoom: 0,
      maxzoom: 22,
    },
  ],
}

export function GeoMapRenderer({ artifact }: RendererProps) {
  const spec = artifact.view_spec as TopologyPayload & { renderer?: string }
  const inline = useMemo(() => normalize(spec), [spec])
  const [loaded, setLoaded] = useState<TopologyPayload | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    if (inline) return
    let aborted = false
    fetch(`/api/artifacts/${artifact.id}/topology`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`topology ${r.status}`)
        return (await r.json()) as TopologyPayload
      })
      .then((data) => {
        if (!aborted) setLoaded(data)
      })
      .catch((e) => {
        if (!aborted) setLoadErr(String(e))
      })
    return () => {
      aborted = true
    }
  }, [artifact.id, inline])

  const payload = inline ?? loaded
  const pipelineStatus = readPipelineStatus(artifact.metadata)
  const dispatch = (inline?.dispatch ?? loaded?.dispatch) ?? (spec.dispatch as DispatchPayload | undefined)

  return (
    <div className="space-y-3">
      <Header artifact={artifact} payload={payload} pipelineStatus={pipelineStatus} />
      {payload ? (
        <MapBody payload={payload} dispatch={dispatch} />
      ) : loadErr ? (
        <div className="text-sm font-serif-soft text-black/50 border border-black/10 px-3 py-6 text-center">
          Could not load topology: <span className="font-mono">{loadErr}</span>
        </div>
      ) : (
        <div className="text-sm font-serif-soft text-black/50 border border-black/10 px-3 py-6 text-center">
          Loading topology…
        </div>
      )}
    </div>
  )
}

function normalize(spec: TopologyPayload | undefined): TopologyPayload | null {
  if (!spec) return null
  const buses = Array.isArray(spec.buses) ? spec.buses : null
  const lines = Array.isArray(spec.lines) ? spec.lines : null
  if (!buses && !lines && !spec.dispatch) return null
  return {
    buses: buses ?? [],
    lines: lines ?? [],
    counts: spec.counts,
    truncated: spec.truncated,
    dispatch: spec.dispatch,
  }
}

function readPipelineStatus(metadata: Record<string, unknown>): string | null {
  const v = metadata?.pipeline_status
  return typeof v === "string" ? v : null
}

function Header({
  artifact,
  payload,
  pipelineStatus,
}: {
  artifact: RendererProps["artifact"]
  payload: TopologyPayload | null
  pipelineStatus: string | null
}) {
  const counts = payload?.counts ?? {}
  const buses = counts.buses ?? payload?.buses?.length
  const lines = counts.lines ?? payload?.lines?.length
  const generators = counts.generators
  const stats: string[] = []
  if (typeof buses === "number") stats.push(`${buses} buses`)
  if (typeof lines === "number") stats.push(`${lines} lines`)
  if (typeof generators === "number") stats.push(`${generators} generators`)
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] font-mark tracking-wider uppercase text-black/60">
      <span>Geo map</span>
      {pipelineStatus ? (
        <span className="px-2 py-0.5 bg-black/[0.06] text-black/80 normal-case font-mono tracking-normal">
          {pipelineStatus}
        </span>
      ) : null}
      <span className="text-black/40">·</span>
      <span className="text-black/80">{stats.join(" · ") || "topology not embedded"}</span>
      {payload?.truncated ? (
        <span className="text-black/40">(downsampled for preview)</span>
      ) : null}
      {artifact.fs_path ? (
        <span className="ml-auto font-mono normal-case text-black/40 tracking-normal">
          {artifact.fs_path}
        </span>
      ) : null}
    </div>
  )
}

function MapBody({
  payload,
  dispatch,
}: {
  payload: TopologyPayload
  dispatch: DispatchPayload | undefined
}) {
  const buses = payload.buses ?? []
  const lines = payload.lines ?? []
  const haveGeo = buses.length > 0 && buses.every((b) => typeof b.x === "number" && typeof b.y === "number")

  const hours = dispatch?.hours ?? []
  const [hourIdx, setHourIdx] = useState(0)
  useEffect(() => {
    if (hourIdx >= Math.max(1, hours.length)) setHourIdx(0)
  }, [hours.length, hourIdx])

  if (!haveGeo) {
    return (
      <div className="space-y-2">
        <div className="text-sm font-serif-soft text-black/60 border border-black/10 px-3 py-3">
          This network has no bus lat/lon — falling back to the force-directed
          renderer. Add <span className="font-mono">x</span>/<span className="font-mono">y</span> to{" "}
          <span className="font-mono">buses.csv</span> to enable the map.
        </div>
        <FallbackGraph buses={buses} lines={lines} dispatch={dispatch} hourIdx={hourIdx} />
        {hours.length > 0 ? (
          <TimeSlider hours={hours} hourIdx={hourIdx} setHourIdx={setHourIdx} />
        ) : null}
        <Legend dispatch={dispatch} />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <MapLibreView buses={buses} lines={lines} dispatch={dispatch} hourIdx={hourIdx} />
      {hours.length > 0 ? (
        <TimeSlider hours={hours} hourIdx={hourIdx} setHourIdx={setHourIdx} />
      ) : null}
      <Legend dispatch={dispatch} />
    </div>
  )
}

function MapLibreView({
  buses,
  lines,
  dispatch,
  hourIdx,
}: {
  buses: RawBus[]
  lines: RawLine[]
  dispatch: DispatchPayload | undefined
  hourIdx: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const moduleRef = useRef<MapLibreModule | null>(null)
  const [ready, setReady] = useState(false)
  const [moduleErr, setModuleErr] = useState<string | null>(null)

  // Compute geojson — recomputed whenever topology or dispatch hour changes.
  const linesFc = useMemo(() => buildLinesGeoJson(buses, lines, dispatch, hourIdx), [buses, lines, dispatch, hourIdx])
  const busesFc = useMemo(() => buildBusesGeoJson(buses, dispatch, hourIdx), [buses, dispatch, hourIdx])
  const bounds = useMemo(() => computeBounds(buses), [buses])

  // Load maplibre-gl + CSS lazily, then instantiate the map once.
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    ;(async () => {
      try {
        const mod = (await import("maplibre-gl")) as MapLibreModule
        // CSS import: side-effect import; Next bundles the stylesheet on the
        // first execution. The dynamic form keeps it out of pages that don't
        // mount the geo-map.
        await import("maplibre-gl/dist/maplibre-gl.css")
        if (cancelled || !containerRef.current) return
        moduleRef.current = mod
        const map = new mod.Map({
          container: containerRef.current,
          style: OSM_STYLE,
          center: bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : [0, 20],
          zoom: 2,
          attributionControl: { compact: true },
        })
        map.addControl(new mod.NavigationControl({ visualizePitch: false }), "top-right")
        map.on("load", () => {
          if (cancelled) return
          map.addSource("lines", { type: "geojson", data: linesFc })
          map.addSource("buses", { type: "geojson", data: busesFc })
          map.addLayer({
            id: "lines",
            type: "line",
            source: "lines",
            paint: {
              "line-color": ["coalesce", ["get", "color"], "rgba(0,0,0,0.45)"],
              "line-width": ["coalesce", ["get", "width"], 1],
            },
            layout: {
              "line-cap": "round",
            },
          })
          map.addLayer({
            id: "lines-dc",
            type: "line",
            source: "lines",
            filter: ["==", ["get", "dc"], true],
            paint: {
              "line-color": ["coalesce", ["get", "color"], "rgba(0,0,0,0.7)"],
              "line-width": ["coalesce", ["get", "width"], 1.5],
              "line-dasharray": [2, 2],
            },
          })
          map.addLayer({
            id: "buses",
            type: "circle",
            source: "buses",
            paint: {
              "circle-radius": ["coalesce", ["get", "r"], 4],
              "circle-color": ["coalesce", ["get", "color"], "#111"],
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 1,
            },
          })
          // Tooltip
          const popup = new mod.Popup({ closeButton: false, closeOnClick: false })
          map.on("mouseenter", "buses", (e) => {
            map.getCanvas().style.cursor = "pointer"
            const f = e.features?.[0]
            if (!f) return
            const props = f.properties as { id?: string; carrier?: string; lmp?: number } | null
            const coords = (f.geometry as unknown as { coordinates: [number, number] }).coordinates
            const lines = [props?.id ?? ""]
            if (props?.carrier) lines.push(`carrier: ${props.carrier}`)
            if (typeof props?.lmp === "number") lines.push(`LMP: $${props.lmp.toFixed(2)}/MWh`)
            popup
              .setLngLat(coords)
              .setHTML(
                `<div style="font-family:monospace;font-size:11px;line-height:1.4">${lines.map(escapeHtml).join("<br>")}</div>`,
              )
              .addTo(map)
          })
          map.on("mouseleave", "buses", () => {
            map.getCanvas().style.cursor = ""
            popup.remove()
          })
          if (bounds) {
            map.fitBounds(
              [
                [bounds[0], bounds[1]],
                [bounds[2], bounds[3]],
              ],
              { padding: 32, duration: 0, maxZoom: 8 },
            )
          }
          mapRef.current = map
          setReady(true)
        })
      } catch (e) {
        if (!cancelled) setModuleErr(String(e))
      }
    })()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
    // We deliberately only instantiate the map once; topology and dispatch
    // updates flow through the data-update effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push fresh geojson into the map whenever the slider moves or topology
  // changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const linesSrc = map.getSource("lines") as { setData?: (d: unknown) => void } | undefined
    const busesSrc = map.getSource("buses") as { setData?: (d: unknown) => void } | undefined
    linesSrc?.setData?.(linesFc)
    busesSrc?.setData?.(busesFc)
  }, [ready, linesFc, busesFc])

  if (moduleErr) {
    return (
      <div className="text-sm font-serif-soft text-black/60 border border-black/10 px-3 py-6 text-center">
        Map library failed to load: <span className="font-mono">{moduleErr}</span>
      </div>
    )
  }

  return (
    <div className="border border-black/10 bg-black/[0.015] relative" style={{ height: 480 }}>
      <div ref={containerRef} className="absolute inset-0" />
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-[11px] font-mono text-black/50">
          loading map…
        </div>
      ) : null}
    </div>
  )
}

// Force-directed fallback when buses lack lat/lon. Lightweight SVG layout —
// mirrors the network-graph renderer but adds LMP/flow coloring.
function FallbackGraph({
  buses,
  lines,
  dispatch,
  hourIdx,
}: {
  buses: RawBus[]
  lines: RawLine[]
  dispatch: DispatchPayload | undefined
  hourIdx: number
}) {
  const W = 720
  const H = 480
  const positions = useMemo(() => forceLayout(buses, lines), [buses, lines])
  const proj = useMemo(() => projectUnit(positions, W, H), [positions])
  const lmpRange = useMemo(() => lmpExtent(dispatch), [dispatch])

  if (buses.length === 0) {
    return (
      <div className="text-sm font-serif-soft text-black/50 border border-black/10 px-3 py-6 text-center">
        No buses in topology.
      </div>
    )
  }

  return (
    <div className="border border-black/10 bg-black/[0.015]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" role="img" aria-label="Network map (fallback)">
        <g>
          {lines.map((l, i) => {
            const a = proj.get(l.source)
            const b = proj.get(l.target)
            if (!a || !b) return null
            const w = lineThickness(l.s_nom)
            const flow = lineFlow(dispatch, l, i, hourIdx)
            const stroke = flowColor(flow, l.s_nom)
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeWidth={w}
                strokeDasharray={isDc(l) ? "4,3" : undefined}
              />
            )
          })}
        </g>
        <g>
          {buses.map((bus) => {
            const p = proj.get(bus.id)
            if (!p) return null
            const lmp = busLmp(dispatch, bus.id, hourIdx)
            const fill = lmp !== undefined ? lmpColor(lmp, lmpRange) : "#111"
            return (
              <circle key={bus.id} cx={p.x} cy={p.y} r={3.5} fill={fill} stroke="#fff" strokeWidth={0.75}>
                <title>
                  {`bus ${bus.id}${bus.carrier ? ` (${bus.carrier})` : ""}${
                    lmp !== undefined ? ` — LMP $${lmp.toFixed(2)}/MWh` : ""
                  }`}
                </title>
              </circle>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

function TimeSlider({
  hours,
  hourIdx,
  setHourIdx,
}: {
  hours: string[]
  hourIdx: number
  setHourIdx: (i: number) => void
}) {
  const max = Math.max(0, hours.length - 1)
  const label = hours[hourIdx] ?? ""
  return (
    <div className="flex items-center gap-3 border border-black/10 px-3 py-2 bg-black/[0.015]">
      <span className="text-[11px] font-mark tracking-wider uppercase text-black/60 shrink-0">Hour</span>
      <input
        type="range"
        min={0}
        max={max}
        value={hourIdx}
        onChange={(e) => setHourIdx(Number(e.target.value))}
        className="flex-1 accent-black"
        aria-label="Dispatch hour"
      />
      <span className="text-[11px] font-mono text-black/70 shrink-0 tabular-nums">
        {hourIdx + 1} / {hours.length}
      </span>
      <span className="text-[11px] font-mono text-black/50 shrink-0">{label}</span>
    </div>
  )
}

function Legend({ dispatch }: { dispatch: DispatchPayload | undefined }) {
  const items: { swatch: string; label: string }[] = [
    { swatch: "linear-gradient(90deg,#111,#aaa)", label: "Bus (no LMP data)" },
  ]
  if (dispatch?.lmps && Object.keys(dispatch.lmps).length > 0) {
    items[0] = { swatch: "linear-gradient(90deg,#1F61A6,#F0F0E8,#C03A2B)", label: "LMP ($/MWh) low → high" }
  }
  if (dispatch?.flows && Object.keys(dispatch.flows).length > 0) {
    items.push({ swatch: "linear-gradient(90deg,#3CB371,#F0F0E8,#FF6347)", label: "Line flow (signed, MW)" })
  }
  items.push({ swatch: "repeating-linear-gradient(90deg,#000 0 4px,transparent 4px 7px)", label: "DC link (dashed)" })
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-black/60">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-2">
          <span className="inline-block w-6 h-2 align-middle" style={{ background: it.swatch }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

// ---------- helpers ----------

function isDc(line: RawLine): boolean {
  if (line.dc === true) return true
  if (typeof line.carrier === "string" && line.carrier.toUpperCase() === "DC") return true
  return false
}

function lineThickness(s_nom: number | undefined): number {
  if (typeof s_nom !== "number" || s_nom <= 0) return 0.75
  const v = Math.log10(s_nom + 1)
  return Math.min(3, Math.max(0.6, v * 0.7))
}

function busLmp(dispatch: DispatchPayload | undefined, busId: string, hourIdx: number): number | undefined {
  const arr = dispatch?.lmps?.[busId]
  if (!Array.isArray(arr)) return undefined
  const v = arr[hourIdx]
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function lineFlow(
  dispatch: DispatchPayload | undefined,
  line: RawLine,
  index: number,
  hourIdx: number,
): number | undefined {
  const flows = dispatch?.flows
  if (!flows) return undefined
  const keys = [`${line.source}|${line.target}`, `${line.target}|${line.source}`, String(index)]
  for (const k of keys) {
    const arr = flows[k]
    if (Array.isArray(arr)) {
      const v = arr[hourIdx]
      if (typeof v === "number" && Number.isFinite(v)) return v
    }
  }
  return undefined
}

function lmpExtent(dispatch: DispatchPayload | undefined): [number, number] | null {
  if (!dispatch?.lmps) return null
  let lo = Infinity
  let hi = -Infinity
  for (const arr of Object.values(dispatch.lmps)) {
    if (!Array.isArray(arr)) continue
    for (const v of arr) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  if (lo === hi) hi = lo + 1
  return [lo, hi]
}

// Diverging blue→cream→red palette, anchored on the dispatch LMP range.
function lmpColor(value: number, range: [number, number] | null): string {
  if (!range) return "#111"
  const [lo, hi] = range
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)))
  return divergingColor(t, [31, 97, 166], [240, 240, 232], [192, 58, 43])
}

// Color signed line flow by direction — green to red — scaled by capacity.
function flowColor(flow: number | undefined, capacity: number | undefined): string {
  if (typeof flow !== "number") return "rgba(0,0,0,0.45)"
  const c = typeof capacity === "number" && capacity > 0 ? capacity : Math.max(1, Math.abs(flow))
  const t = 0.5 + 0.5 * Math.max(-1, Math.min(1, flow / c))
  return divergingColor(t, [60, 179, 113], [240, 240, 232], [255, 99, 71])
}

function divergingColor(
  t: number,
  low: [number, number, number],
  mid: [number, number, number],
  high: [number, number, number],
): string {
  const mix = (a: number, b: number, u: number) => Math.round(a + (b - a) * u)
  let r: number, g: number, b: number
  if (t < 0.5) {
    const u = t / 0.5
    r = mix(low[0], mid[0], u)
    g = mix(low[1], mid[1], u)
    b = mix(low[2], mid[2], u)
  } else {
    const u = (t - 0.5) / 0.5
    r = mix(mid[0], high[0], u)
    g = mix(mid[1], high[1], u)
    b = mix(mid[2], high[2], u)
  }
  return `rgb(${r},${g},${b})`
}

function computeBounds(buses: RawBus[]): [number, number, number, number] | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let count = 0
  for (const b of buses) {
    if (typeof b.x !== "number" || typeof b.y !== "number") continue
    count++
    if (b.x < minX) minX = b.x
    if (b.x > maxX) maxX = b.x
    if (b.y < minY) minY = b.y
    if (b.y > maxY) maxY = b.y
  }
  if (count === 0) return null
  if (minX === maxX) {
    minX -= 0.1
    maxX += 0.1
  }
  if (minY === maxY) {
    minY -= 0.1
    maxY += 0.1
  }
  return [minX, minY, maxX, maxY]
}

function buildBusesGeoJson(
  buses: RawBus[],
  dispatch: DispatchPayload | undefined,
  hourIdx: number,
): GeoJsonFc {
  const range = lmpExtent(dispatch)
  const features: GeoJsonFeature[] = []
  for (const b of buses) {
    if (typeof b.x !== "number" || typeof b.y !== "number") continue
    const lmp = busLmp(dispatch, b.id, hourIdx)
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [b.x, b.y] },
      properties: {
        id: b.id,
        carrier: b.carrier ?? null,
        lmp: typeof lmp === "number" ? lmp : null,
        color: lmp !== undefined ? lmpColor(lmp, range) : "#111",
        r: 4,
      },
    })
  }
  return { type: "FeatureCollection", features }
}

function buildLinesGeoJson(
  buses: RawBus[],
  lines: RawLine[],
  dispatch: DispatchPayload | undefined,
  hourIdx: number,
): GeoJsonFc {
  const byId = new Map<string, RawBus>()
  for (const b of buses) byId.set(b.id, b)
  const features: GeoJsonFeature[] = []
  lines.forEach((l, i) => {
    const a = byId.get(l.source)
    const b = byId.get(l.target)
    if (!a || !b) return
    if (typeof a.x !== "number" || typeof a.y !== "number") return
    if (typeof b.x !== "number" || typeof b.y !== "number") return
    const flow = lineFlow(dispatch, l, i, hourIdx)
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[a.x, a.y], [b.x, b.y]] },
      properties: {
        source: l.source,
        target: l.target,
        s_nom: typeof l.s_nom === "number" ? l.s_nom : null,
        carrier: l.carrier ?? null,
        dc: isDc(l),
        color: flowColor(flow, l.s_nom),
        width: lineThickness(l.s_nom),
      },
    })
  })
  return { type: "FeatureCollection", features }
}

interface GeoJsonFeature {
  type: "Feature"
  geometry: { type: "Point"; coordinates: [number, number] } | { type: "LineString"; coordinates: [number, number][] }
  properties: Record<string, unknown>
}
interface GeoJsonFc {
  type: "FeatureCollection"
  features: GeoJsonFeature[]
}

// Project unit-coords (0..1) into an SVG viewbox.
function projectUnit(
  nodes: Map<string, { x: number; y: number }>,
  w: number,
  h: number,
): Map<string, { x: number; y: number }> {
  const pad = 24
  const out = new Map<string, { x: number; y: number }>()
  if (nodes.size === 0) return out
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of nodes.values()) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const dx = Math.max(1e-6, maxX - minX)
  const dy = Math.max(1e-6, maxY - minY)
  const sx = (w - 2 * pad) / dx
  const sy = (h - 2 * pad) / dy
  const s = Math.min(sx, sy)
  const offsetX = (w - s * dx) / 2
  const offsetY = (h - s * dy) / 2
  for (const [id, p] of nodes) {
    out.set(id, {
      x: offsetX + (p.x - minX) * s,
      y: offsetY + (p.y - minY) * s,
    })
  }
  return out
}

// Tiny deterministic Fruchterman-Reingold simulation for fallback layouts.
function forceLayout(buses: RawBus[], lines: RawLine[]): Map<string, { x: number; y: number }> {
  const nodes = new Map<string, { x: number; y: number }>()
  const n = buses.length
  if (n === 0) return nodes
  const phi = (1 + Math.sqrt(5)) / 2
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n) * 0.5
    const theta = i * 2 * Math.PI * phi
    nodes.set(buses[i].id, { x: 0.5 + r * Math.cos(theta), y: 0.5 + r * Math.sin(theta) })
  }
  const ids = [...nodes.keys()]
  const idIdx = new Map(ids.map((id, i) => [id, i]))
  const pos = ids.map((id) => nodes.get(id)!)
  const edges: [number, number][] = []
  for (const l of lines) {
    const i = idIdx.get(l.source)
    const j = idIdx.get(l.target)
    if (i !== undefined && j !== undefined && i !== j) edges.push([i, j])
  }
  const k = Math.sqrt(1 / Math.max(1, n))
  const iters = n <= 60 ? 200 : n <= 300 ? 130 : 90
  let t = 0.1
  const cool = t / iters
  const disp = ids.map(() => ({ x: 0, y: 0 }))
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < pos.length; i++) {
      disp[i].x = 0
      disp[i].y = 0
      for (let j = 0; j < pos.length; j++) {
        if (i === j) continue
        let dx = pos[i].x - pos[j].x
        let dy = pos[i].y - pos[j].y
        let d = Math.sqrt(dx * dx + dy * dy)
        if (d < 1e-4) {
          dx = (i - j) * 1e-4
          dy = (i + j) * 1e-4
          d = Math.sqrt(dx * dx + dy * dy) || 1e-4
        }
        const f = (k * k) / d
        disp[i].x += (dx / d) * f
        disp[i].y += (dy / d) * f
      }
    }
    for (const [i, j] of edges) {
      let dx = pos[i].x - pos[j].x
      let dy = pos[i].y - pos[j].y
      let d = Math.sqrt(dx * dx + dy * dy)
      if (d < 1e-4) d = 1e-4
      const f = (d * d) / k
      disp[i].x -= (dx / d) * f
      disp[i].y -= (dy / d) * f
      disp[j].x += (dx / d) * f
      disp[j].y += (dy / d) * f
    }
    for (let i = 0; i < pos.length; i++) {
      const d = Math.sqrt(disp[i].x * disp[i].x + disp[i].y * disp[i].y) || 1e-4
      const lim = Math.min(d, t)
      pos[i].x += (disp[i].x / d) * lim
      pos[i].y += (disp[i].y / d) * lim
      pos[i].x = Math.min(1, Math.max(0, pos[i].x))
      pos[i].y = Math.min(1, Math.max(0, pos[i].y))
    }
    t = Math.max(0, t - cool)
  }
  for (let i = 0; i < ids.length; i++) nodes.set(ids[i], pos[i])
  return nodes
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

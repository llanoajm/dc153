"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { RendererProps } from "./types"

// view_spec shape (any of these may be omitted):
//   { renderer: "network-graph",
//     buses?: Array<{ id: string; x?: number; y?: number; carrier?: string }>,
//     lines?: Array<{ source: string; target: string; s_nom?: number; carrier?: string }>,
//     counts?: { buses?: number; lines?: number; generators?: number },
//     fallback_renderer?: string, fallback_source?: string }
//
// Topology can also be loaded lazily from /api/artifacts/<id>/topology, which
// parses the PyPSA CSV folder at artifact.fs_path. The renderer chooses inline
// data when present.

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
}
interface TopologyPayload {
  buses?: RawBus[]
  lines?: RawLine[]
  counts?: { buses?: number; lines?: number; generators?: number }
  truncated?: boolean
}

const VIEW_W = 720
const VIEW_H = 480

export function NetworkGraphRenderer({ artifact }: RendererProps) {
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

  return (
    <div className="space-y-3">
      <Header artifact={artifact} payload={payload} pipelineStatus={pipelineStatus} />
      {payload ? (
        <Graph payload={payload} />
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
  if (!buses && !lines) return null
  return {
    buses: buses ?? [],
    lines: lines ?? [],
    counts: spec.counts,
    truncated: spec.truncated,
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
      <span>Network graph</span>
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

function Graph({ payload }: { payload: TopologyPayload }) {
  const buses = payload.buses ?? []
  const lines = payload.lines ?? []
  const positions = useLayout(buses, lines)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<string | null>(null)

  if (buses.length === 0) {
    return (
      <div className="text-sm font-serif-soft text-black/50 border border-black/10 px-3 py-6 text-center">
        No buses in topology.
      </div>
    )
  }

  const projected = projectToViewport(positions)

  return (
    <div className="border border-black/10 bg-black/[0.015]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block w-full h-auto"
        role="img"
        aria-label="Network topology"
      >
        <g>
          {lines.map((l, i) => {
            const a = projected.get(l.source)
            const b = projected.get(l.target)
            if (!a || !b) return null
            const w = lineThickness(l.s_nom)
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={w}
              />
            )
          })}
        </g>
        <g>
          {buses.map((bus) => {
            const p = projected.get(bus.id)
            if (!p) return null
            const isHover = hover === bus.id
            return (
              <circle
                key={bus.id}
                cx={p.x}
                cy={p.y}
                r={isHover ? 4 : 2.5}
                fill="#111"
                stroke={isHover ? "#1F8FFF" : "rgba(0,0,0,0.1)"}
                strokeWidth={isHover ? 2 : 0.5}
                onMouseEnter={() => setHover(bus.id)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`bus ${bus.id}${bus.carrier ? ` (${bus.carrier})` : ""}`}</title>
              </circle>
            )
          })}
        </g>
      </svg>
      <div className="px-3 py-2 border-t border-black/10 text-[11px] font-mono text-black/50 flex justify-between">
        <span>{buses.length} drawn buses · {lines.length} drawn lines</span>
        <span>{positions.geoProjected ? "geo projection" : "force-directed"}</span>
      </div>
    </div>
  )
}

function lineThickness(s_nom: number | undefined): number {
  if (typeof s_nom !== "number" || s_nom <= 0) return 0.75
  // Map capacity (MW) onto a thin stroke range. Power flows vary by orders of
  // magnitude, so log-scaled.
  const v = Math.log10(s_nom + 1)
  return Math.min(2.5, Math.max(0.5, v * 0.5))
}

// Project the simulation/geo coordinates into the viewbox with a uniform
// margin and aspect ratio preservation.
function projectToViewport(
  layout: LayoutResult,
): Map<string, { x: number; y: number }> & { geoProjected: boolean } {
  const pad = 24
  const nodes = layout.nodes
  if (nodes.size === 0) {
    const m = new Map() as Map<string, { x: number; y: number }> & { geoProjected: boolean }
    m.geoProjected = layout.geoProjected
    return m
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of nodes.values()) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const dx = Math.max(1e-6, maxX - minX)
  const dy = Math.max(1e-6, maxY - minY)
  const sx = (VIEW_W - 2 * pad) / dx
  const sy = (VIEW_H - 2 * pad) / dy
  const s = Math.min(sx, sy)
  const offsetX = (VIEW_W - s * dx) / 2
  const offsetY = (VIEW_H - s * dy) / 2
  const out = new Map<string, { x: number; y: number }>() as Map<string, { x: number; y: number }> &
    { geoProjected: boolean }
  for (const [id, p] of nodes) {
    // For geo data, y axis is latitude (north = up), so flip.
    const projX = offsetX + (p.x - minX) * s
    const projY = layout.geoProjected
      ? offsetY + (maxY - p.y) * s
      : offsetY + (p.y - minY) * s
    out.set(id, { x: projX, y: projY })
  }
  out.geoProjected = layout.geoProjected
  return out
}

interface LayoutResult {
  nodes: Map<string, { x: number; y: number }>
  geoProjected: boolean
}

// Layout — either lat/lon-projected (if all buses have x,y) or
// Fruchterman-Reingold force simulation. Memoize on inputs.
function useLayout(buses: RawBus[], lines: RawLine[]): LayoutResult {
  return useMemo(() => layout(buses, lines), [buses, lines])
}

function layout(buses: RawBus[], lines: RawLine[]): LayoutResult {
  const haveGeo = buses.length > 0 && buses.every((b) => typeof b.x === "number" && typeof b.y === "number")
  const nodes = new Map<string, { x: number; y: number }>()
  if (haveGeo) {
    for (const b of buses) nodes.set(b.id, { x: b.x as number, y: b.y as number })
    return { nodes, geoProjected: true }
  }
  // Force-directed. Seed deterministically (golden-ratio) so the layout is
  // stable across renders without depending on Math.random.
  const n = buses.length
  const w = 1
  const h = 1
  const area = w * h
  const k = Math.sqrt(area / Math.max(1, n))
  const phi = (1 + Math.sqrt(5)) / 2
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n) * 0.5
    const theta = i * 2 * Math.PI * phi
    nodes.set(buses[i].id, {
      x: 0.5 + r * Math.cos(theta),
      y: 0.5 + r * Math.sin(theta),
    })
  }
  const edges: Array<[string, string]> = []
  for (const l of lines) {
    if (nodes.has(l.source) && nodes.has(l.target) && l.source !== l.target) {
      edges.push([l.source, l.target])
    }
  }
  // Pre-bucket repulsion targets into a grid to keep n^2 down for medium n.
  const iters = n <= 60 ? 250 : n <= 300 ? 160 : 100
  const minDist = 1e-4
  let t = w / 10
  const cool = t / iters
  const ids = [...nodes.keys()]
  const pos = ids.map((id) => nodes.get(id)!)
  const idIdx = new Map(ids.map((id, i) => [id, i]))
  const disp: Array<{ x: number; y: number }> = ids.map(() => ({ x: 0, y: 0 }))
  for (let it = 0; it < iters; it++) {
    // repulsive
    for (let i = 0; i < pos.length; i++) {
      disp[i].x = 0
      disp[i].y = 0
      for (let j = 0; j < pos.length; j++) {
        if (i === j) continue
        let dx = pos[i].x - pos[j].x
        let dy = pos[i].y - pos[j].y
        let d = Math.sqrt(dx * dx + dy * dy)
        if (d < minDist) {
          dx = (i - j) * 1e-4
          dy = (i + j) * 1e-4
          d = Math.sqrt(dx * dx + dy * dy) || minDist
        }
        const f = (k * k) / d
        disp[i].x += (dx / d) * f
        disp[i].y += (dy / d) * f
      }
    }
    // attractive
    for (const [a, b] of edges) {
      const i = idIdx.get(a)!
      const j = idIdx.get(b)!
      let dx = pos[i].x - pos[j].x
      let dy = pos[i].y - pos[j].y
      let d = Math.sqrt(dx * dx + dy * dy)
      if (d < minDist) d = minDist
      const f = (d * d) / k
      disp[i].x -= (dx / d) * f
      disp[i].y -= (dy / d) * f
      disp[j].x += (dx / d) * f
      disp[j].y += (dy / d) * f
    }
    // limit displacement by temperature
    for (let i = 0; i < pos.length; i++) {
      const d = Math.sqrt(disp[i].x * disp[i].x + disp[i].y * disp[i].y) || minDist
      const lim = Math.min(d, t)
      pos[i].x += (disp[i].x / d) * lim
      pos[i].y += (disp[i].y / d) * lim
      // soft bound
      pos[i].x = Math.min(1, Math.max(0, pos[i].x))
      pos[i].y = Math.min(1, Math.max(0, pos[i].y))
    }
    t = Math.max(0, t - cool)
  }
  for (let i = 0; i < ids.length; i++) {
    nodes.set(ids[i], pos[i])
  }
  return { nodes, geoProjected: false }
}

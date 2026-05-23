"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { Artifact } from "@/lib/artifacts"

export function RunsPanel() {
  const [runs, setRuns] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/artifacts?kind=run&limit=200")
      if (!r.ok) throw new Error(`list failed: ${r.status}`)
      setRuns(await r.json())
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggleSelected = (id: string) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (next.size >= 2) {
          const first = next.values().next().value as string | undefined
          if (first) next.delete(first)
        }
        next.add(id)
      }
      return next
    })
  }

  const compareHref = useMemo(() => {
    const ids = Array.from(selected)
    if (ids.length !== 2) return null
    return `/app/runs/compare?a=${ids[0]}&b=${ids[1]}`
  }, [selected])

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-6">
        <div>
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Runs
          </div>
          <h1 className="font-serif-soft text-2xl mt-1">Dispatch runs</h1>
          <p className="font-serif-soft text-sm text-black/60 mt-2 max-w-prose">
            Solve results from canonical and uploaded networks. Click a row to see
            time-series charts (LMPs, dispatch by carrier, line flows). Tick two
            rows to compare them side-by-side.
          </p>
        </div>

        {error ? (
          <div className="text-xs text-red-600 font-mono">{error}</div>
        ) : null}

        <div className="flex items-center gap-3">
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            {loading ? "Loading…" : `${runs.length} run${runs.length === 1 ? "" : "s"}`}
          </div>
          {selected.size > 0 ? (
            <div className="text-[11px] font-mono text-black/60">
              {selected.size}/2 selected
            </div>
          ) : null}
          {compareHref ? (
            <Link
              href={compareHref}
              className="text-[11px] font-mark tracking-wider uppercase text-black hover:underline"
            >
              compare →
            </Link>
          ) : null}
        </div>

        {runs.length === 0 && !loading ? (
          <div className="text-sm font-serif-soft text-black/50 px-2 py-6 text-center border border-dashed border-black/15">
            No runs yet. Solve dispatch on a network (canonical or uploaded) and a
            run artifact will land here.
          </div>
        ) : (
          <ul className="border border-black/10 divide-y divide-black/5">
            {runs.map((a) => (
              <li key={a.id} className="flex items-stretch">
                <label className="px-3 py-3 flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggleSelected(a.id)}
                    className="accent-black"
                  />
                </label>
                <Link
                  href={`/app/runs/${a.id}`}
                  className="flex-1 px-2 py-3 hover:bg-black/[0.03] flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-serif-soft truncate">{a.name}</div>
                    <div className="text-[11px] font-mono text-black/40 truncate">
                      {runSubtitle(a)}
                    </div>
                  </div>
                  <RunStatus artifact={a} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function runSubtitle(a: Artifact): string {
  const meta = (a.metadata ?? {}) as Record<string, unknown>
  const parts: string[] = []
  if (typeof meta.network_name === "string") parts.push(meta.network_name)
  else if (typeof meta.network_slug === "string") parts.push(meta.network_slug)
  if (typeof meta.hours === "number") parts.push(`${meta.hours}h`)
  if (typeof meta.solver === "string") parts.push(meta.solver)
  if (typeof meta.elapsed_s === "number") parts.push(`${meta.elapsed_s.toFixed(2)}s`)
  if (parts.length === 0 && a.slug) parts.push(a.slug)
  parts.push(new Date(a.created_at).toLocaleString())
  return parts.join(" · ")
}

function RunStatus({ artifact }: { artifact: Artifact }) {
  const tone =
    artifact.status === "failed_validation"
      ? "bg-red-100 text-red-700"
      : artifact.status === "canonical"
      ? "bg-emerald-100 text-emerald-700"
      : "bg-black/[0.06] text-black/70"
  return (
    <span className={`text-[10px] font-mono px-2 py-1 ${tone}`}>{artifact.status}</span>
  )
}

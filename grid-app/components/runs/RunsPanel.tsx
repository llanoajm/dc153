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
    <div className="h-full overflow-y-auto" style={{ background: "var(--bg-app)" }}>
      <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-6">
        <div>
          <div className="label-pane">Runs &amp; Plans</div>
          <h1 className="h-page-title mt-1">Dispatch runs</h1>
          <p
            className="mt-2 max-w-prose"
            style={{
              fontFamily: "var(--font-sora)",
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--fg-mute-2)",
            }}
          >
            Solve results from canonical and uploaded networks. Click a row to see
            time-series charts (LMPs, dispatch by carrier, line flows). Tick two
            rows to compare them side-by-side.
          </p>
        </div>

        {error ? <div className="error-toast inline-block">{error}</div> : null}

        <div className="flex items-center gap-3">
          <div className="label-pane">
            {loading ? "Loading…" : `${runs.length} run${runs.length === 1 ? "" : "s"}`}
          </div>
          {selected.size > 0 ? (
            <div
              style={{
                fontFamily: "var(--font-jetbrains)",
                fontSize: 11,
                color: "var(--fg-mute-2)",
              }}
            >
              {selected.size}/2 selected
            </div>
          ) : null}
          {compareHref ? (
            <Link
              href={compareHref}
              className="font-mark hover:underline"
              style={{
                fontSize: 11,
                letterSpacing: "var(--track-nav)",
                color: "var(--navy-pop)",
              }}
            >
              compare →
            </Link>
          ) : null}
        </div>

        {runs.length === 0 && !loading ? (
          <div
            className="px-4 py-8 text-center"
            style={{
              fontFamily: "var(--font-sora)",
              fontSize: 13,
              color: "var(--fg-mute-4)",
              background: "var(--bg-card)",
              border: "1px dashed var(--bor-4)",
              borderRadius: "var(--r-3)",
            }}
          >
            No runs yet. Solve dispatch on a network (canonical or uploaded) and a
            run artifact will land here.
          </div>
        ) : (
          <ul
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--bor-1)",
              borderRadius: "var(--r-3)",
              overflow: "hidden",
            }}
          >
            {runs.map((a, i) => (
              <li
                key={a.id}
                className="flex items-stretch"
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--bg-hairline)",
                }}
              >
                <label className="px-3 py-3 flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggleSelected(a.id)}
                    style={{ accentColor: "var(--ink-app)" }}
                  />
                </label>
                <Link
                  href={`/app/runs/${a.id}`}
                  className="flex-1 px-2 py-3 flex items-center gap-3"
                  style={{ transition: "background var(--t-hover)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--bg-hairline)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="truncate"
                      style={{
                        fontFamily: "var(--font-sora)",
                        fontSize: 13,
                        color: "var(--ink-app)",
                      }}
                    >
                      {a.name}
                    </div>
                    <div
                      className="truncate"
                      style={{
                        fontFamily: "var(--font-jetbrains)",
                        fontSize: 11,
                        color: "var(--fg-mute-4)",
                      }}
                    >
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
  let bg = "var(--bg-tint)"
  let fg = "var(--fg-mute)"
  if (artifact.status === "failed_validation") {
    bg = "var(--err-bg)"
    fg = "var(--err-fg)"
  } else if (artifact.status === "canonical") {
    bg = "#E6F1F1"
    fg = "var(--peacock)"
  }
  return (
    <span
      style={{
        fontFamily: "var(--font-jetbrains)",
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: "var(--r-2)",
        background: bg,
        color: fg,
      }}
    >
      {artifact.status}
    </span>
  )
}

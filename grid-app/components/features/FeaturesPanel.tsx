"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { Artifact } from "@/lib/artifacts"

type StatusFilter = "all" | "draft" | "canonical" | "deprecated"

// Features panel (ROADMAP §4 / LOOP_QUEUE item 12).
//
// Lists all `kind='feature'` artifacts. Status pill + approve / reject / edit
// per row. Approve flips status='canonical'; reject flips to 'deprecated' (and
// the server renames the file to `_<slug>.py` so the MCP server stops
// exposing it). Edit drops the row into a textarea so the user can refine the
// drafted code before approving.
//
// Lineage view: when a draft has `parent_id` pointing at a source_document
// artifact, we render a "From: <source>" link with the heading the drafter
// latched onto, so the user can trace a feature back to the PDF that spawned
// it.
export function FeaturesPanel() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>("all")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingCode, setEditingCode] = useState("")
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [autoPromote, setAutoPromote] = useState<boolean>(false)
  const [policyLoaded, setPolicyLoaded] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/features?limit=200")
      if (!r.ok) throw new Error(`list failed: ${r.status}`)
      setArtifacts(await r.json())
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshPolicy = useCallback(async () => {
    try {
      const r = await fetch("/api/review-policy")
      if (!r.ok) return
      const j = await r.json()
      setAutoPromote(Boolean(j.auto_promote))
      setPolicyLoaded(true)
    } catch {
      // non-fatal — leave the toggle at its default
    }
  }, [])

  useEffect(() => {
    refresh()
    refreshPolicy()
  }, [refresh, refreshPolicy])

  const togglePolicy = async () => {
    const next = !autoPromote
    setAutoPromote(next)
    try {
      const r = await fetch("/api/review-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_promote: next }),
      })
      if (!r.ok) throw new Error(`policy save failed: ${r.status}`)
    } catch (e) {
      setError(String(e))
      setAutoPromote(!next)
    }
  }

  const rerunReview = async (id: string) => {
    setPendingId(id)
    setError(null)
    try {
      const r = await fetch(`/api/features/${id}/review`, { method: "POST" })
      if (!r.ok) throw new Error(`review failed: ${r.status}`)
      // Reviewer runs detached; poll once after a short delay so the user
      // sees the updated status/summary without a manual refresh.
      setTimeout(refresh, 1500)
    } catch (e) {
      setError(String(e))
    } finally {
      setPendingId(null)
    }
  }

  const filtered = useMemo(() => {
    if (filter === "all") return artifacts
    return artifacts.filter((a) => a.status === filter)
  }, [artifacts, filter])

  const mutate = useCallback(
    async (
      id: string,
      body: { status?: "canonical" | "deprecated" | "draft"; code?: string },
    ) => {
      setPendingId(id)
      setError(null)
      try {
        const r = await fetch(`/api/features/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error ?? `patch failed: ${r.status}`)
        }
        const updated = (await r.json()) as Artifact
        setArtifacts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      } catch (e) {
        setError(String(e))
      } finally {
        setPendingId(null)
      }
    },
    [],
  )

  const startEdit = (a: Artifact) => {
    setEditingId(a.id)
    const source = (a.view_spec as Record<string, unknown>).source
    setEditingCode(typeof source === "string" ? source : "")
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingCode("")
  }

  const saveEdit = async (id: string) => {
    await mutate(id, { code: editingCode })
    setEditingId(null)
  }

  const counts = useMemo(() => ({
    all: artifacts.length,
    draft: artifacts.filter((a) => a.status === "draft").length,
    canonical: artifacts.filter((a) => a.status === "canonical").length,
    deprecated: artifacts.filter((a) => a.status === "deprecated").length,
  }), [artifacts])

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-6">
        <div>
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Skills / Features
          </div>
          <h1 className="font-serif-soft text-2xl mt-1">Features</h1>
          <p className="font-serif-soft text-sm text-black/60 mt-2 max-w-prose">
            Code the agent (or you) wrote. Drafts are auto-generated by the
            source-ingestion pipeline when a document contains concrete math.
            Approve a draft to flip it to{" "}
            <code className="font-mono text-[11px]">canonical</code> — the agent
            can then invoke it by name. Reject a draft to flip it to{" "}
            <code className="font-mono text-[11px]">deprecated</code>; the file
            is renamed{" "}
            <code className="font-mono text-[11px]">_&lt;slug&gt;.py</code> so the
            MCP server stops listing it.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1 text-[11px] font-mark tracking-wider">
            {(["all", "draft", "canonical", "deprecated"] as StatusFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 border ${
                  filter === f
                    ? "border-black bg-black text-white"
                    : "border-black/20 text-black/60 hover:border-black/40"
                }`}
              >
                {f} ({counts[f]})
              </button>
            ))}
          </div>
          <label
            className={`flex items-center gap-2 text-[11px] font-mark tracking-wider px-3 py-1.5 border ${
              policyLoaded ? "border-black/30 text-black/80" : "border-black/10 text-black/40"
            } cursor-pointer select-none`}
            title="When on, the reviewer auto-promotes passing drafts to canonical. When off, you approve manually here."
          >
            <input
              type="checkbox"
              checked={autoPromote}
              onChange={togglePolicy}
              className="accent-black"
            />
            auto-promote on review pass
          </label>
        </div>

        {error ? <div className="text-xs text-red-600 font-mono">{error}</div> : null}

        {loading ? (
          <div className="text-sm font-serif-soft text-black/50">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm font-serif-soft text-black/50 px-2 py-6 text-center">
            No {filter === "all" ? "" : filter + " "}features yet. Upload a PDF
            with concrete math under{" "}
            <Link href="/app/sources" className="underline">
              Sources
            </Link>{" "}
            and the intake drafter will populate this panel.
          </div>
        ) : (
          <ul className="border border-black/10 divide-y divide-black/5">
            {filtered.map((a) => (
              <FeatureRow
                key={a.id}
                artifact={a}
                pending={pendingId === a.id}
                editing={editingId === a.id}
                editingCode={editingCode}
                setEditingCode={setEditingCode}
                onStartEdit={() => startEdit(a)}
                onCancelEdit={cancelEdit}
                onSaveEdit={() => saveEdit(a.id)}
                onApprove={() => mutate(a.id, { status: "canonical" })}
                onReject={() => mutate(a.id, { status: "deprecated" })}
                onUnreject={() => mutate(a.id, { status: "draft" })}
                onReview={() => rerunReview(a.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function FeatureRow({
  artifact,
  pending,
  editing,
  editingCode,
  setEditingCode,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onApprove,
  onReject,
  onUnreject,
  onReview,
}: {
  artifact: Artifact
  pending: boolean
  editing: boolean
  editingCode: string
  setEditingCode: (s: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onApprove: () => void
  onReject: () => void
  onUnreject: () => void
  onReview: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const meta = (artifact.metadata ?? {}) as Record<string, unknown>
  const view = (artifact.view_spec ?? {}) as Record<string, unknown>
  const heading = typeof meta.heading === "string" ? meta.heading : null
  const sourceLabel = typeof meta.source_label === "string" ? meta.source_label : null
  const sourceArtifactId =
    typeof meta.source_artifact_id === "string" ? meta.source_artifact_id : null
  const draftedBy = typeof meta.drafted_by === "string" ? meta.drafted_by : null
  const source = typeof view.source === "string" ? view.source : ""
  const filePath = typeof view.path === "string" ? view.path : artifact.fs_path ?? null
  const lastReview =
    meta.last_review && typeof meta.last_review === "object"
      ? (meta.last_review as { outcome?: string; summary?: string; at?: string })
      : null

  return (
    <li className="px-4 py-3 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-serif-soft flex items-center gap-2">
            <span className="truncate">{artifact.name}</span>
            <StatusPill status={artifact.status} />
          </div>
          <div className="text-[11px] font-mono text-black/40 mt-0.5 truncate">
            {filePath ?? artifact.slug ?? "—"}
          </div>
          {(sourceLabel || sourceArtifactId || draftedBy) ? (
            <div className="text-[11px] font-serif-soft text-black/50 mt-1">
              <span>from </span>
              {sourceArtifactId ? (
                <Link
                  href={`/app/artifacts/${sourceArtifactId}`}
                  className="underline"
                >
                  {sourceLabel ?? sourceArtifactId.slice(0, 8)}
                </Link>
              ) : (
                <span>{sourceLabel ?? "—"}</span>
              )}
              {heading ? <span> · heading: <em>{heading}</em></span> : null}
              {draftedBy ? <span> · {draftedBy}</span> : null}
            </div>
          ) : null}
          {lastReview && lastReview.outcome ? (
            <div className="text-[11px] font-mono text-black/50 mt-1">
              review: <ReviewBadge outcome={lastReview.outcome} />{" "}
              <span>{lastReview.summary ?? ""}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setExpanded((x) => !x)}
            className="text-[11px] font-mark tracking-wider px-2 py-1 border border-black/20 text-black/70 hover:border-black/40"
          >
            {expanded ? "hide" : "code"}
          </button>
          <Link
            href={`/app/artifacts/${artifact.id}`}
            className="text-[11px] font-mark tracking-wider px-2 py-1 border border-black/20 text-black/70 hover:border-black/40"
          >
            open
          </Link>
          {artifact.status !== "canonical" ? (
            <button
              disabled={pending}
              onClick={onApprove}
              className="text-[11px] font-mark tracking-wider px-2 py-1 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              approve
            </button>
          ) : null}
          {artifact.status !== "deprecated" ? (
            <button
              disabled={pending}
              onClick={onReject}
              className="text-[11px] font-mark tracking-wider px-2 py-1 border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              reject
            </button>
          ) : (
            <button
              disabled={pending}
              onClick={onUnreject}
              className="text-[11px] font-mark tracking-wider px-2 py-1 border border-black/20 text-black/70 hover:border-black/40 disabled:opacity-50"
            >
              un-reject
            </button>
          )}
          {!editing ? (
            <button
              onClick={onStartEdit}
              className="text-[11px] font-mark tracking-wider px-2 py-1 border border-black/20 text-black/70 hover:border-black/40"
            >
              edit
            </button>
          ) : null}
          <button
            disabled={pending}
            onClick={onReview}
            className="text-[11px] font-mark tracking-wider px-2 py-1 border border-black/20 text-black/70 hover:border-black/40 disabled:opacity-50"
            title="Re-run the reviewer agent on this feature"
          >
            review
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={editingCode}
            onChange={(e) => setEditingCode(e.target.value)}
            spellCheck={false}
            className="w-full h-72 font-mono text-[12px] leading-relaxed border border-black/20 p-2 bg-black/[0.02]"
          />
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={onCancelEdit}
              className="text-[11px] font-mark tracking-wider px-2 py-1 border border-black/20 text-black/70 hover:border-black/40"
            >
              cancel
            </button>
            <button
              disabled={pending}
              onClick={onSaveEdit}
              className="text-[11px] font-mark tracking-wider px-2 py-1 bg-black text-white hover:bg-black/80 disabled:opacity-50"
            >
              save
            </button>
          </div>
        </div>
      ) : expanded ? (
        <pre className="font-mono text-[11px] leading-relaxed border border-black/10 p-2 bg-black/[0.02] overflow-x-auto whitespace-pre max-h-96">
          {source || "(empty file)"}
        </pre>
      ) : null}
    </li>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "canonical"
      ? "bg-emerald-100 text-emerald-700"
      : status === "deprecated"
        ? "bg-black/[0.06] text-black/50"
        : status === "failed_validation"
          ? "bg-red-100 text-red-700"
          : "bg-amber-100 text-amber-800"
  return <span className={`text-[10px] font-mono px-2 py-0.5 ${tone}`}>{status}</span>
}

function ReviewBadge({ outcome }: { outcome: string }) {
  const tone =
    outcome === "passed"
      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
      : outcome === "passed_with_warnings"
        ? "bg-amber-50 text-amber-800 border border-amber-200"
        : outcome === "failed"
          ? "bg-red-50 text-red-700 border border-red-200"
          : "bg-black/[0.04] text-black/60 border border-black/10"
  return <span className={`px-1.5 py-0.5 text-[10px] ${tone}`}>{outcome}</span>
}

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
    <div className="h-full overflow-y-auto" style={{ background: "var(--bg-app)" }}>
      <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-6">
        <div>
          <div className="label-pane">Objectives</div>
          <h1 className="h-page-title mt-1">Objectives</h1>
          <p
            className="mt-2 max-w-prose"
            style={{
              fontFamily: "var(--font-sora)",
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--fg-mute-2)",
            }}
          >
            Differentiable metrics the agent (or you) authored — the goals a Run
            or Plan optimizes against. Drafts are auto-generated by the
            source-ingestion pipeline when a document contains concrete math.
            Approve a draft to flip it to <code className="case-tag">canonical</code>
            {" "}— the agent can then invoke it by name. Reject a draft to flip it
            to <code className="case-tag">deprecated</code>; the file is renamed{" "}
            <code className="case-tag">_&lt;slug&gt;.py</code> so the MCP server
            stops listing it.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div
            className="flex items-center"
            style={{
              background: "var(--bg-tint)",
              padding: 2,
              borderRadius: "var(--r-3)",
              gap: 2,
            }}
          >
            {(["all", "draft", "canonical", "deprecated"] as StatusFilter[]).map((f) => {
              const isActive = filter === f
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="font-mark"
                  style={{
                    fontSize: 11,
                    letterSpacing: "var(--track-meta)",
                    padding: "5px 12px",
                    borderRadius: "var(--r-2)",
                    background: isActive ? "var(--ink-app)" : "transparent",
                    color: isActive ? "var(--bg-card)" : "var(--fg-mute)",
                    transition: "background var(--t-hover), color var(--t-hover)",
                  }}
                >
                  {f} ({counts[f]})
                </button>
              )
            })}
          </div>
          <label
            className="flex items-center gap-2 cursor-pointer select-none px-3 py-1.5"
            style={{
              fontFamily: "var(--font-sora)",
              fontSize: 11,
              letterSpacing: "var(--track-meta)",
              border: "1px solid var(--bor-3)",
              borderRadius: "var(--r-3)",
              color: policyLoaded ? "var(--ink-app)" : "var(--fg-mute-4)",
              background: "var(--bg-card)",
            }}
            title="When on, the reviewer auto-promotes passing drafts to canonical. When off, you approve manually here."
          >
            <input
              type="checkbox"
              checked={autoPromote}
              onChange={togglePolicy}
              style={{ accentColor: "var(--ink-app)" }}
            />
            auto-promote on review pass
          </label>
        </div>

        {error ? <div className="error-toast inline-block">{error}</div> : null}

        {loading ? (
          <div
            style={{
              fontFamily: "var(--font-sora)",
              fontSize: 13,
              color: "var(--fg-mute-4)",
            }}
          >
            Loading…
          </div>
        ) : filtered.length === 0 ? (
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
            No {filter === "all" ? "" : filter + " "}objectives yet. Upload a PDF
            with concrete math under{" "}
            <Link
              href="/app/sources"
              style={{ color: "var(--navy-pop)", textDecoration: "underline" }}
            >
              Sources
            </Link>{" "}
            and the intake drafter will populate this panel.
          </div>
        ) : (
          <ul
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--bor-1)",
              borderRadius: "var(--r-3)",
              overflow: "hidden",
              listStyle: "none",
              padding: 0,
              margin: 0,
            }}
          >
            {filtered.map((a, i) => (
              <FeatureRow
                key={a.id}
                artifact={a}
                isFirst={i === 0}
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
  isFirst = false,
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
  isFirst?: boolean
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
    <li
      className="px-4 py-3 space-y-3"
      style={{ borderTop: isFirst ? "none" : "1px solid var(--bg-hairline)" }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div
            className="flex items-center gap-2"
            style={{
              fontFamily: "var(--font-sora)",
              fontSize: 13,
              color: "var(--ink-app)",
            }}
          >
            <span className="truncate">{artifact.name}</span>
            <StatusPill status={artifact.status} />
          </div>
          <div
            className="mt-0.5 truncate"
            style={{
              fontFamily: "var(--font-jetbrains)",
              fontSize: 11,
              color: "var(--fg-mute-4)",
            }}
          >
            {filePath ?? artifact.slug ?? "—"}
          </div>
          {(sourceLabel || sourceArtifactId || draftedBy) ? (
            <div
              className="mt-1"
              style={{
                fontFamily: "var(--font-sora)",
                fontSize: 11,
                color: "var(--fg-mute-2)",
              }}
            >
              <span>from </span>
              {sourceArtifactId ? (
                <Link
                  href={`/app/artifacts/${sourceArtifactId}`}
                  style={{
                    color: "var(--navy-pop)",
                    textDecoration: "underline",
                  }}
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
            <div
              className="mt-1"
              style={{
                fontFamily: "var(--font-jetbrains)",
                fontSize: 11,
                color: "var(--fg-mute-2)",
              }}
            >
              review: <ReviewBadge outcome={lastReview.outcome} />{" "}
              <span>{lastReview.summary ?? ""}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <ActionButton onClick={() => setExpanded((x) => !x)}>
            {expanded ? "hide" : "code"}
          </ActionButton>
          <ActionLink href={`/app/artifacts/${artifact.id}`}>open</ActionLink>
          {artifact.status !== "canonical" ? (
            <ActionButton disabled={pending} onClick={onApprove} variant="solid">
              approve
            </ActionButton>
          ) : null}
          {artifact.status !== "deprecated" ? (
            <ActionButton disabled={pending} onClick={onReject} variant="danger">
              reject
            </ActionButton>
          ) : (
            <ActionButton disabled={pending} onClick={onUnreject}>
              un-reject
            </ActionButton>
          )}
          {!editing ? (
            <ActionButton onClick={onStartEdit}>edit</ActionButton>
          ) : null}
          <ActionButton
            disabled={pending}
            onClick={onReview}
            title="Re-run the reviewer agent on this feature"
          >
            review
          </ActionButton>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={editingCode}
            onChange={(e) => setEditingCode(e.target.value)}
            spellCheck={false}
            className="w-full h-72 p-2"
            style={{
              fontFamily: "var(--font-jetbrains)",
              fontSize: 12,
              lineHeight: 1.55,
              border: "1px solid var(--bor-3)",
              borderRadius: "var(--r-3)",
              background: "var(--bg-hairline)",
              outline: "none",
            }}
          />
          <div className="flex items-center justify-end gap-1">
            <ActionButton onClick={onCancelEdit}>cancel</ActionButton>
            <ActionButton disabled={pending} onClick={onSaveEdit} variant="solid">
              save
            </ActionButton>
          </div>
        </div>
      ) : expanded ? (
        <pre
          className="overflow-x-auto whitespace-pre max-h-96 p-2"
          style={{
            fontFamily: "var(--font-jetbrains)",
            fontSize: 11,
            lineHeight: 1.55,
            border: "1px solid var(--bor-1)",
            borderRadius: "var(--r-3)",
            background: "var(--bg-hairline)",
            color: "var(--ink-app)",
          }}
        >
          {source || "(empty file)"}
        </pre>
      ) : null}
    </li>
  )
}

function actionButtonStyle(
  variant: "ghost" | "solid" | "danger",
  disabled = false,
): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: "var(--font-sora)",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "var(--track-meta)",
    padding: "4px 10px",
    borderRadius: "var(--r-2)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "background var(--t-hover), color var(--t-hover), border-color var(--t-hover)",
  }
  if (variant === "solid") {
    return {
      ...base,
      background: "var(--ink-app)",
      color: "var(--bg-card)",
      border: "1px solid var(--ink-app)",
    }
  }
  if (variant === "danger") {
    return {
      ...base,
      background: "var(--bg-card)",
      color: "var(--err-fg)",
      border: "1px solid var(--err-border)",
    }
  }
  return {
    ...base,
    background: "var(--bg-card)",
    color: "var(--fg-mute)",
    border: "1px solid var(--bor-3)",
  }
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = "ghost",
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: "ghost" | "solid" | "danger"
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={actionButtonStyle(variant, disabled)}
    >
      {children}
    </button>
  )
}

function ActionLink({
  children,
  href,
}: {
  children: React.ReactNode
  href: string
}) {
  return (
    <Link href={href} style={actionButtonStyle("ghost")}>
      {children}
    </Link>
  )
}

function StatusPill({ status }: { status: string }) {
  let bg = "#FFE6C8"
  let fg = "var(--terracotta)"
  if (status === "canonical") {
    bg = "#E6F1F1"
    fg = "var(--peacock)"
  } else if (status === "deprecated") {
    bg = "var(--bg-tint)"
    fg = "var(--fg-mute-4)"
  } else if (status === "failed_validation") {
    bg = "var(--err-bg)"
    fg = "var(--err-fg)"
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
      {status}
    </span>
  )
}

function ReviewBadge({ outcome }: { outcome: string }) {
  let bg = "var(--bg-tint)"
  let fg = "var(--fg-mute-2)"
  let bor = "var(--bor-1)"
  if (outcome === "passed") {
    bg = "#E6F1F1"
    fg = "var(--peacock)"
    bor = "#9DC8C7"
  } else if (outcome === "passed_with_warnings") {
    bg = "#FFF4E5"
    fg = "var(--terracotta)"
    bor = "var(--apricot)"
  } else if (outcome === "failed") {
    bg = "var(--err-bg)"
    fg = "var(--err-fg)"
    bor = "var(--err-border)"
  }
  return (
    <span
      style={{
        fontFamily: "var(--font-jetbrains)",
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: "var(--r-2)",
        background: bg,
        color: fg,
        border: `1px solid ${bor}`,
      }}
    >
      {outcome}
    </span>
  )
}

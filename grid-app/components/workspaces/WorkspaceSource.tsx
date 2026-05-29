"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { Artifact } from "@/lib/artifacts"
import { NetworkGraphRenderer } from "@/components/renderers/network-graph"

// Data Source tab UI (WORKSPACE_REDESIGN.md §5; REDESIGN_ROADMAP §11). Renders
// the workspace's single anchored grid (topology + bus/line/carrier counts) and
// lets the user swap it for another visible reference network (PATCHing
// workspaces.primary_network_id) or defer to the chat to fetch/upload one.
// "Add a source" is intentionally a hand-off to the chat — the agent's existing
// fetch_network / upload pipeline does acquisition; this tab just anchors which
// network the study is about.

export interface NetworkOption {
  id: string
  name: string
  subtitle: string
}

interface CarrierCounts {
  buses: number
  lines: number
  carriers: number
  carrierList: string[]
}

interface TopologyResponse {
  buses?: Array<{ carrier?: string }>
  lines?: Array<{ carrier?: string }>
  counts?: { buses?: number; lines?: number; generators?: number }
}

export function WorkspaceSource({
  workspaceId,
  primaryNetwork,
  options,
}: {
  workspaceId: string
  primaryNetwork: Artifact | null
  options: NetworkOption[]
}) {
  const router = useRouter()
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectNetwork = useCallback(
    async (networkId: string | null) => {
      if (saving) return
      if (networkId === (primaryNetwork?.id ?? null)) {
        setPicking(false)
        return
      }
      setSaving(true)
      setError(null)
      try {
        const r = await fetch(`/api/workspaces/${workspaceId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ primary_network_id: networkId }),
        })
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? `update failed: ${r.status}`)
        }
        setPicking(false)
        // Re-fetch the server component so the anchored network (and the rail's
        // single-network label) reflect the swap.
        router.refresh()
      } catch (e) {
        setError(String(e))
      } finally {
        setSaving(false)
      }
    },
    [workspaceId, primaryNetwork?.id, saving, router],
  )

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="h-page-title" style={{ marginBottom: 6 }}>
            Data source
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sora)",
              fontSize: 14,
              lineHeight: 1.55,
              color: "var(--fg-mute)",
              maxWidth: 540,
            }}
          >
            The one grid this workspace is about. Runs and plans solve against it
            unless you swap it here.
          </p>
        </div>
        {primaryNetwork ? (
          <button type="button" onClick={() => setPicking((p) => !p)} style={ghostBtnStyle}>
            {picking ? "Cancel" : "Swap"}
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          className="mb-4"
          style={{ fontFamily: "var(--font-jetbrains)", fontSize: 12, color: "#b42318" }}
        >
          {error}
        </div>
      ) : null}

      {primaryNetwork && !picking ? (
        <AnchoredNetwork artifact={primaryNetwork} />
      ) : null}

      {!primaryNetwork && !picking ? (
        <EmptyState onPick={() => setPicking(true)} hasOptions={options.length > 0} />
      ) : null}

      {picking ? (
        <NetworkPicker
          options={options}
          currentId={primaryNetwork?.id ?? null}
          saving={saving}
          onSelect={selectNetwork}
        />
      ) : null}

      <AskAgentEntry workspaceId={workspaceId} />
    </div>
  )
}

// The anchored grid: a real topology graph (reusing the network renderer, which
// pulls bus/line data from the artifact's view_spec or its PyPSA folder) plus a
// counts strip that adds carrier counts the renderer's own header omits.
function AnchoredNetwork({ artifact }: { artifact: Artifact }) {
  const counts = useCarrierCounts(artifact)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div
          style={{
            fontFamily: "var(--font-sora)",
            fontSize: 17,
            fontWeight: 600,
            color: "var(--ink-app)",
          }}
        >
          {artifact.name}
        </div>
        <CountsStrip counts={counts} />
      </div>
      <NetworkGraphRenderer artifact={artifact} />
    </div>
  )
}

function CountsStrip({ counts }: { counts: CarrierCounts | null }) {
  if (!counts) {
    return (
      <div
        style={{
          fontFamily: "var(--font-jetbrains)",
          fontSize: 11,
          color: "var(--fg-mute-3)",
          marginTop: 4,
        }}
      >
        Loading counts…
      </div>
    )
  }
  const chips = [
    `${counts.buses} buses`,
    `${counts.lines} lines`,
    `${counts.carriers} ${counts.carriers === 1 ? "carrier" : "carriers"}`,
  ]
  return (
    <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 6 }}>
      {chips.map((c) => (
        <span
          key={c}
          style={{
            fontFamily: "var(--font-jetbrains)",
            fontSize: 11,
            color: "var(--fg-mute)",
            background: "var(--bg-hairline)",
            border: "1px solid var(--bor-1)",
            borderRadius: "var(--r-2)",
            padding: "3px 8px",
          }}
        >
          {c}
        </span>
      ))}
      {counts.carrierList.length > 0 ? (
        <span
          style={{
            fontFamily: "var(--font-jetbrains)",
            fontSize: 11,
            color: "var(--fg-mute-3)",
          }}
          title={counts.carrierList.join(", ")}
        >
          {counts.carrierList.slice(0, 6).join(" · ")}
          {counts.carrierList.length > 6 ? " · …" : ""}
        </span>
      ) : null}
    </div>
  )
}

function NetworkPicker({
  options,
  currentId,
  saving,
  onSelect,
}: {
  options: NetworkOption[]
  currentId: string | null
  saving: boolean
  onSelect: (id: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <SourceOption
        label="No grid"
        subtitle="Clear the anchored network; add one later from the chat."
        selected={currentId === null}
        disabled={saving}
        onClick={() => onSelect(null)}
      />
      {options.map((n) => (
        <SourceOption
          key={n.id}
          label={n.name}
          subtitle={n.subtitle}
          selected={currentId === n.id}
          disabled={saving}
          onClick={() => onSelect(n.id)}
        />
      ))}
      {options.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--font-sora)",
            fontSize: 12,
            color: "var(--fg-mute-3)",
            padding: "4px 2px",
          }}
        >
          No reference networks available yet — ask the agent in the chat to
          fetch one, or upload your own.
        </p>
      ) : null}
    </div>
  )
}

function EmptyState({ onPick, hasOptions }: { onPick: () => void; hasOptions: boolean }) {
  return (
    <div
      style={{
        border: "1px dashed var(--bor-3)",
        borderRadius: "var(--r-4)",
        padding: "28px 22px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--ink-app)",
          marginBottom: 4,
        }}
      >
        No grid anchored yet
      </div>
      <p
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 13,
          color: "var(--fg-mute)",
          marginBottom: 16,
          maxWidth: 420,
          marginInline: "auto",
        }}
      >
        Pick a reference network to anchor this workspace, or ask the agent in
        the chat to fetch a real grid (PyPSA-USA, PyPSA-Eur, an ISO portal …).
      </p>
      <button type="button" onClick={onPick} style={primaryBtnStyle(false)}>
        {hasOptions ? "Choose a network" : "Browse options"}
      </button>
    </div>
  )
}

function AskAgentEntry({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  return (
    <div
      className="mt-8 flex items-center justify-between gap-4"
      style={{ borderTop: "1px solid var(--bor-1)", paddingTop: 16 }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-sora)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink-app)",
          }}
        >
          Need a different grid?
        </div>
        <div
          style={{
            fontFamily: "var(--font-sora)",
            fontSize: 12.5,
            color: "var(--fg-mute)",
          }}
        >
          Ask the agent to fetch a network by name, or upload your own from the
          chat composer.
        </div>
      </div>
      <button
        type="button"
        onClick={() => router.push(`/app/w/${workspaceId}?new=${Date.now()}`)}
        style={ghostBtnStyle}
      >
        Ask the agent
      </button>
    </div>
  )
}

function SourceOption({
  label,
  subtitle,
  selected,
  disabled,
  onClick,
}: {
  label: string
  subtitle: string
  selected: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className="text-left flex flex-col gap-0.5"
      style={{
        border: `1px solid ${selected ? "var(--ink-app)" : "var(--bor-3)"}`,
        background: selected ? "var(--bg-tint-warm)" : "var(--bg-card)",
        borderRadius: "var(--r-4)",
        padding: "11px 14px",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled && !selected ? 0.6 : 1,
        transition: "border-color var(--t-hover), background var(--t-hover)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 13.5,
          fontWeight: 600,
          color: "var(--ink-app)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-jetbrains)",
          fontSize: 11,
          color: "var(--fg-mute-2)",
        }}
      >
        {subtitle}
      </span>
    </button>
  )
}

// Resolve carrier counts for the anchored network. Prefer inline topology in
// view_spec; otherwise fetch the same /api/artifacts/<id>/topology endpoint the
// graph renderer uses (parses the PyPSA folder). Carriers are the distinct set
// across buses + lines.
function useCarrierCounts(artifact: Artifact): CarrierCounts | null {
  const inline = useMemo(() => fromSpec(artifact.view_spec), [artifact.view_spec])
  const [counts, setCounts] = useState<CarrierCounts | null>(inline)

  useEffect(() => {
    if (inline) {
      setCounts(inline)
      return
    }
    let aborted = false
    setCounts(null)
    fetch(`/api/artifacts/${artifact.id}/topology`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`topology ${r.status}`)
        return (await r.json()) as TopologyResponse
      })
      .then((data) => {
        if (!aborted) setCounts(deriveCounts(data))
      })
      .catch(() => {
        if (!aborted) setCounts(null)
      })
    return () => {
      aborted = true
    }
  }, [artifact.id, inline])

  return counts
}

function fromSpec(spec: Record<string, unknown> | undefined): CarrierCounts | null {
  if (!spec) return null
  const buses = Array.isArray(spec.buses) ? (spec.buses as Array<{ carrier?: string }>) : null
  const lines = Array.isArray(spec.lines) ? (spec.lines as Array<{ carrier?: string }>) : null
  if (!buses && !lines) return null
  return deriveCounts({
    buses: buses ?? [],
    lines: lines ?? [],
    counts: spec.counts as TopologyResponse["counts"],
  })
}

function deriveCounts(data: TopologyResponse): CarrierCounts {
  const carriers = new Set<string>()
  for (const b of data.buses ?? []) if (b.carrier) carriers.add(b.carrier)
  for (const l of data.lines ?? []) if (l.carrier) carriers.add(l.carrier)
  const carrierList = [...carriers].sort()
  return {
    buses: data.counts?.buses ?? data.buses?.length ?? 0,
    lines: data.counts?.lines ?? data.lines?.length ?? 0,
    carriers: carrierList.length,
    carrierList,
  }
}

const ghostBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-sora)",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--fg-mute)",
  background: "transparent",
  border: "1px solid var(--bor-3)",
  borderRadius: "var(--r-3)",
  padding: "8px 16px",
  cursor: "pointer",
}

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-sora)",
    fontSize: 13,
    fontWeight: 500,
    color: "#fff",
    background: disabled ? "var(--bor-4)" : "var(--ink-app)",
    border: "1px solid transparent",
    borderRadius: "var(--r-3)",
    padding: "8px 18px",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.85 : 1,
  }
}

"use client"

import { useCallback, useEffect, useState } from "react"
import type { PinnedDashboard } from "./types"
import { ProfileMenu } from "./ProfileMenu"

export interface RailSection {
  key: string
  label: string
}

// The five legible nouns of the workspace ontology (WORKSPACE_REDESIGN.md §3,§5):
// Data Source · Chats · Objectives · Runs & Plans · Library. Chats is its own
// top-level history list and the single network anchors Data Source at the top
// of the rail, so the nouns surfaced here are the three studies (Data Source,
// Objectives, Runs & Plans). The generic panels demote into a secondary Library
// group below — their routes still resolve, they're just no longer the spine.
const PRIMARY_SECTIONS: RailSection[] = [
  { key: "networks", label: "Data Source" },
  { key: "skills", label: "Objectives" },
  { key: "runs", label: "Runs & Plans" },
]

// Demoted generic panels — the old "artifacts of any kind" surfaces. Kept
// reachable under "Library" so old routes still resolve (item 16 acceptance).
const LIBRARY_SECTIONS: RailSection[] = [
  { key: "sources", label: "Sources" },
  { key: "glossary", label: "Glossary" },
  { key: "dashboards", label: "Dashboards" },
  { key: "panels", label: "Panels" },
  { key: "orgs", label: "Orgs" },
  { key: "settings", label: "Settings" },
]

export interface ChatSummary {
  id: string
  title: string
}

const railStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  borderRight: "1px solid var(--bor-1)",
}

const headerStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--bor-1)",
}

const itemBase: React.CSSProperties = {
  fontFamily: "var(--font-sora)",
  fontSize: 13,
  transition: "background-color var(--t-hover), color var(--t-hover)",
}

export function LeftRail({
  collapsed,
  onToggle,
  primarySections = PRIMARY_SECTIONS,
  librarySections = LIBRARY_SECTIONS,
  active,
  onSelect,
  pinnedDashboards = [],
  email,
  primaryNetworkName,
  workspaceId,
  activeChatId,
  onNewChat,
  onOpenChat,
}: {
  collapsed: boolean
  onToggle: () => void
  primarySections?: RailSection[]
  librarySections?: RailSection[]
  active?: string
  onSelect?: (key: string) => void
  pinnedDashboards?: PinnedDashboard[]
  email?: string | null
  primaryNetworkName?: string | null
  workspaceId?: string | null
  activeChatId?: string | null
  onNewChat?: () => void
  onOpenChat?: (id: string) => void
}) {
  const [internalActive, setInternalActive] = useState(primarySections[0]?.key ?? "")
  const current = active ?? internalActive
  const select = (key: string) => {
    setInternalActive(key)
    onSelect?.(key)
  }

  const [chats, setChats] = useState<ChatSummary[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)

  const renderSectionButton = (s: RailSection) => {
    const isActive = current === s.key
    return (
      <button
        key={s.key}
        onClick={() => select(s.key)}
        className="w-full text-left px-3 py-1.5"
        style={{
          ...itemBase,
          fontSize: 12.5,
          background: isActive ? "var(--bg-tint)" : "transparent",
          color: isActive ? "var(--ink-app)" : "var(--fg-mute)",
          fontWeight: isActive ? 500 : 400,
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = "var(--bg-hairline)"
            e.currentTarget.style.color = "var(--ink-app)"
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = "transparent"
            e.currentTarget.style.color = "var(--fg-mute)"
          }
        }}
      >
        {s.label}
      </button>
    )
  }

  const loadChats = useCallback(async () => {
    try {
      const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ""
      const r = await fetch(`/api/chats${qs}`)
      if (!r.ok) return
      const rows: Array<{ id: string; title?: string }> = await r.json()
      setChats(rows.map((c) => ({ id: c.id, title: c.title || "New chat" })))
    } catch {
      // non-fatal: the history list just stays empty
    }
  }, [workspaceId])

  // Load on mount + whenever the workspace changes; refresh when the active
  // chat changes (a new chat was just persisted on first message).
  useEffect(() => {
    void loadChats()
  }, [loadChats, activeChatId])

  if (collapsed) {
    return (
      <aside
        className="w-9 flex flex-col items-center py-2 shrink-0"
        style={railStyle}
      >
        <button
          onClick={onToggle}
          aria-label="Expand left rail"
          className="font-mono"
          style={{ fontSize: 12, color: "var(--fg-mute-4)" }}
        >
          {">"}
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-56 flex flex-col shrink-0" style={railStyle}>
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={headerStyle}
      >
        <span className="label-pane">Workspace</span>
        <button
          onClick={onToggle}
          aria-label="Collapse left rail"
          className="font-mono"
          style={{ fontSize: 12, color: "var(--fg-mute-4)" }}
        >
          {"<"}
        </button>
      </div>

      {/* Single network — the workspace anchors one grid (WORKSPACE_REDESIGN §10). */}
      <button
        type="button"
        onClick={() => select("networks")}
        className="mx-2 mt-2 px-3 py-2 text-left rounded"
        style={{
          background: current === "networks" ? "var(--bg-tint)" : "var(--bg-hairline)",
          border: "1px solid var(--bor-1)",
          borderRadius: "var(--r-3)",
        }}
        title={primaryNetworkName ?? "No network selected"}
      >
        <div className="label-pane" style={{ fontSize: 9, marginBottom: 2 }}>
          Network
        </div>
        <div
          className="truncate"
          style={{
            fontFamily: "var(--font-sora)",
            fontSize: 13,
            fontWeight: 500,
            color: primaryNetworkName ? "var(--ink-app)" : "var(--fg-mute-4)",
          }}
        >
          {primaryNetworkName ?? "No network yet"}
        </div>
      </button>

      {/* Chats history. */}
      <div className="px-3 pt-3 pb-1 flex items-center justify-between">
        <span className="label-pane" style={{ fontSize: 9 }}>
          Chats
        </span>
        <button
          type="button"
          onClick={() => onNewChat?.()}
          aria-label="New chat"
          title="New chat"
          className="leading-none"
          style={{
            fontFamily: "var(--font-sora)",
            fontSize: 16,
            color: "var(--fg-mute-3)",
            transition: "color var(--t-hover)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink-app)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg-mute-3)")}
        >
          +
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto pb-2">
        {chats.length === 0 ? (
          <div
            className="px-3 py-1.5"
            style={{
              fontFamily: "var(--font-sora)",
              fontSize: 12,
              color: "var(--fg-mute-4)",
            }}
          >
            No chats yet
          </div>
        ) : (
          chats.map((c) => {
            const isActive = c.id === activeChatId
            return (
              <button
                key={c.id}
                onClick={() => onOpenChat?.(c.id)}
                title={c.title}
                className="w-full text-left px-3 py-1.5 truncate"
                style={{
                  ...itemBase,
                  background: isActive ? "var(--bg-tint)" : "transparent",
                  color: isActive ? "var(--ink-app)" : "var(--fg-mute)",
                  fontWeight: isActive ? 500 : 400,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "var(--bg-hairline)"
                    e.currentTarget.style.color = "var(--ink-app)"
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "transparent"
                    e.currentTarget.style.color = "var(--fg-mute)"
                  }
                }}
              >
                {c.title}
              </button>
            )
          })
        )}

        {pinnedDashboards.length > 0 ? (
          <div
            className="mt-3 pt-2"
            style={{ borderTop: "1px solid var(--bor-1)" }}
          >
            <div className="px-3 pb-1 label-pane" style={{ fontSize: 10 }}>
              Pinned
            </div>
            {pinnedDashboards.map((d) => {
              const key = `pin:${d.id}`
              const isActive = current === key
              return (
                <button
                  key={d.id}
                  onClick={() => select(key)}
                  title={d.name}
                  className="w-full text-left px-3 py-1.5 truncate"
                  style={{
                    ...itemBase,
                    background: isActive ? "var(--bg-tint)" : "transparent",
                    color: isActive ? "var(--ink-app)" : "var(--fg-mute)",
                    fontWeight: isActive ? 500 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "var(--bg-hairline)"
                      e.currentTarget.style.color = "var(--ink-app)"
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "transparent"
                      e.currentTarget.style.color = "var(--fg-mute)"
                    }
                  }}
                >
                  {d.name}
                </button>
              )
            })}
          </div>
        ) : null}

        {/* The workspace nouns (WORKSPACE_REDESIGN.md §3,§5): Data Source,
            Objectives, Runs & Plans — shown directly under the chat history. */}
        <div className="mt-3 pt-2" style={{ borderTop: "1px solid var(--bor-1)" }}>
          <div className="px-3 pb-1 label-pane" style={{ fontSize: 9 }}>
            Workspace
          </div>
          {primarySections.map(renderSectionButton)}
        </div>

        {/* Demoted generic panels — collapsed by default under "Library" so the
            five nouns stay the spine; their routes still resolve. */}
        <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--bor-1)" }}>
          <button
            type="button"
            onClick={() => setLibraryOpen((o) => !o)}
            className="w-full text-left px-3 py-1 flex items-center gap-1"
            style={{
              fontFamily: "var(--font-sora)",
              fontSize: 10,
              letterSpacing: "var(--track-pane)",
              textTransform: "uppercase",
              color: "var(--fg-mute-3)",
            }}
            aria-expanded={libraryOpen}
          >
            <span style={{ fontSize: 9 }}>{libraryOpen ? "▾" : "▸"}</span>
            <span>Library</span>
          </button>
          {libraryOpen ? librarySections.map(renderSectionButton) : null}
        </div>
      </nav>

      {/* Profile pinned bottom-left — account + Sign out (no header logout). */}
      <div
        className="px-3 py-2"
        style={{ borderTop: "1px solid var(--bor-1)" }}
      >
        <ProfileMenu email={email ?? null} />
      </div>
    </aside>
  )
}

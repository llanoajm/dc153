"use client"

import { useState } from "react"
import type { PinnedDashboard } from "./types"

export interface RailSection {
  key: string
  label: string
}

const DEFAULT_SECTIONS: RailSection[] = [
  { key: "chats", label: "Chats" },
  { key: "sources", label: "Sources" },
  { key: "networks", label: "Networks" },
  { key: "datasets", label: "Datasets" },
  { key: "runs", label: "Runs" },
  { key: "reports", label: "Reports" },
  { key: "skills", label: "Skills / Features" },
  { key: "glossary", label: "Glossary" },
  { key: "orgs", label: "Orgs" },
  { key: "dashboards", label: "Dashboards" },
  { key: "panels", label: "Panels" },
  { key: "settings", label: "Settings" },
]

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
  sections = DEFAULT_SECTIONS,
  active,
  onSelect,
  pinnedDashboards = [],
}: {
  collapsed: boolean
  onToggle: () => void
  sections?: RailSection[]
  active?: string
  onSelect?: (key: string) => void
  pinnedDashboards?: PinnedDashboard[]
}) {
  const [internalActive, setInternalActive] = useState(sections[0]?.key ?? "")
  const current = active ?? internalActive
  const select = (key: string) => {
    setInternalActive(key)
    onSelect?.(key)
  }

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
    <aside className="w-52 flex flex-col shrink-0" style={railStyle}>
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
      <nav className="flex-1 overflow-y-auto py-2">
        {sections.map((s) => {
          const isActive = current === s.key
          return (
            <button
              key={s.key}
              onClick={() => select(s.key)}
              className="w-full text-left px-3 py-1.5"
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
              {s.label}
            </button>
          )
        })}
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
      </nav>
      <div
        className="px-3 py-2 flex items-center gap-2"
        style={{ borderTop: "1px solid var(--bor-1)" }}
      >
        <span className="mono-kbd">⌘K</span>
        <span
          className="font-mono"
          style={{ fontSize: 10.5, color: "var(--fg-mute-4)" }}
        >
          to search
        </span>
      </div>
    </aside>
  )
}

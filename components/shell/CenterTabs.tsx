"use client"

import { ReactNode } from "react"

export interface CenterTab {
  id: string
  label: string
  content: ReactNode
  closable?: boolean
}

export function CenterTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: CenterTab[]
  activeId: string
  onSelect: (id: string) => void
  onClose?: (id: string) => void
}) {
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0]

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <div
        className="flex items-end px-2 gap-px overflow-x-auto"
        style={{
          background: "var(--bg-card)",
          borderBottom: "1px solid var(--bor-1)",
        }}
      >
        {tabs.map((t) => {
          const isActive = t.id === activeTab?.id
          return (
            <div
              key={t.id}
              className="group flex items-center gap-2 px-3 py-2 cursor-pointer whitespace-nowrap"
              style={{
                fontFamily: "var(--font-sora)",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "var(--track-pane)",
                color: isActive ? "var(--ink-app)" : "var(--fg-mute-3)",
                borderBottom: isActive
                  ? "2px solid var(--ink-app)"
                  : "2px solid transparent",
                marginBottom: -1,
                transition: "color var(--t-hover)",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = "var(--ink-app)"
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = "var(--fg-mute-3)"
              }}
              onClick={() => onSelect(t.id)}
            >
              <span>{t.label}</span>
              {t.closable && onClose ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(t.id)
                  }}
                  className="opacity-0 group-hover:opacity-100"
                  style={{
                    color: "var(--fg-mute-4)",
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                  aria-label={`Close ${t.label}`}
                >
                  ×
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        {activeTab ? activeTab.content : null}
      </div>
    </div>
  )
}

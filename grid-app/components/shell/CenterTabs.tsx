"use client"

import { ReactNode, useState } from "react"

export interface CenterTab {
  id: string
  label: string
  content: ReactNode
  closable?: boolean
}

export function CenterTabs({
  initialTabs,
  defaultTabId,
}: {
  initialTabs: CenterTab[]
  defaultTabId?: string
}) {
  const [tabs, setTabs] = useState<CenterTab[]>(initialTabs)
  const [activeId, setActiveId] = useState<string>(defaultTabId ?? initialTabs[0]?.id ?? "")
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0]

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (id === activeId && next.length > 0) {
        setActiveId(next[0].id)
      }
      return next
    })
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <div className="flex items-end border-b border-black/10 px-2 gap-px overflow-x-auto">
        {tabs.map((t) => {
          const isActive = t.id === activeTab?.id
          return (
            <div
              key={t.id}
              className={`group flex items-center gap-2 px-3 py-2 text-xs font-mark tracking-wider cursor-pointer whitespace-nowrap ${
                isActive
                  ? "text-black border-b-2 border-black -mb-px"
                  : "text-black/40 hover:text-black"
              }`}
              onClick={() => setActiveId(t.id)}
            >
              <span>{t.label}</span>
              {t.closable ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                  className="text-black/30 hover:text-black opacity-0 group-hover:opacity-100"
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

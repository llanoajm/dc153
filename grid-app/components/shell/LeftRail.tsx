"use client"

import { useState } from "react"

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
]

export function LeftRail({
  collapsed,
  onToggle,
  sections = DEFAULT_SECTIONS,
  active,
  onSelect,
}: {
  collapsed: boolean
  onToggle: () => void
  sections?: RailSection[]
  active?: string
  onSelect?: (key: string) => void
}) {
  const [internalActive, setInternalActive] = useState(sections[0]?.key ?? "")
  const current = active ?? internalActive
  const select = (key: string) => {
    setInternalActive(key)
    onSelect?.(key)
  }

  if (collapsed) {
    return (
      <aside className="w-9 border-r border-black/10 flex flex-col items-center py-2 shrink-0">
        <button
          onClick={onToggle}
          aria-label="Expand left rail"
          className="text-black/40 hover:text-black text-xs font-mark"
        >
          {">"}
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-52 border-r border-black/10 flex flex-col shrink-0">
      <div className="px-3 py-2 flex items-center justify-between border-b border-black/10">
        <span className="text-[11px] font-mark text-black/40">Workspace</span>
        <button
          onClick={onToggle}
          aria-label="Collapse left rail"
          className="text-black/40 hover:text-black text-xs font-mark"
        >
          {"<"}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => select(s.key)}
            className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
              current === s.key
                ? "bg-black/[0.06] text-black"
                : "text-black/70 hover:text-black hover:bg-black/[0.03]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="border-t border-black/10 px-3 py-2 text-[10px] font-serif-soft">
        ⌘K to search
      </div>
    </aside>
  )
}

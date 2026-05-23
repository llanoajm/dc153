"use client"

export function RightRail({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  if (collapsed) {
    return (
      <aside className="w-9 border-l border-black/10 flex flex-col items-center py-2 shrink-0">
        <button
          onClick={onToggle}
          aria-label="Expand right rail"
          className="text-black/40 hover:text-black text-xs font-mark"
        >
          {"<"}
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-72 border-l border-black/10 flex flex-col shrink-0">
      <div className="px-3 py-2 flex items-center justify-between border-b border-black/10">
        <span className="text-[11px] font-mark text-black/40">Context</span>
        <button
          onClick={onToggle}
          aria-label="Collapse right rail"
          className="text-black/40 hover:text-black text-xs font-mark"
        >
          {">"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 text-xs font-serif-soft space-y-3">
        <p>
          Contextual panels for the active surface will appear here — review
          and diff for the current chat, mini map of a referenced network,
          related artifacts, etc.
        </p>
        <p className="text-black/40">
          The agent can populate this rail with whatever is contextually
          useful for what you&rsquo;re working on.
        </p>
      </div>
    </aside>
  )
}

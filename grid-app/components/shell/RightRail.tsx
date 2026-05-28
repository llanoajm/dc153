"use client"

const railStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  borderLeft: "1px solid var(--bor-1)",
}

export function RightRail({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  if (collapsed) {
    return (
      <aside
        className="w-9 flex flex-col items-center py-2 shrink-0"
        style={railStyle}
      >
        <button
          onClick={onToggle}
          aria-label="Expand right rail"
          className="font-mono"
          style={{ fontSize: 12, color: "var(--fg-mute-4)" }}
        >
          {"<"}
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-72 flex flex-col shrink-0" style={railStyle}>
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--bor-1)" }}
      >
        <span className="label-pane">Context</span>
        <button
          onClick={onToggle}
          aria-label="Collapse right rail"
          className="font-mono"
          style={{ fontSize: 12, color: "var(--fg-mute-4)" }}
        >
          {">"}
        </button>
      </div>
      <div
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 12,
          lineHeight: 1.5,
          color: "var(--fg-mute-2)",
        }}
      >
        <p>
          Contextual panels for the active surface will appear here — review
          and diff for the current chat, mini map of a referenced network,
          related artifacts.
        </p>
        <p style={{ color: "var(--fg-mute-4)" }}>
          The agent can populate this rail with whatever is contextually useful
          for what you&rsquo;re working on.
        </p>
      </div>
    </aside>
  )
}

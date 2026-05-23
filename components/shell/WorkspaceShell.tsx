"use client"

import { ReactNode, useState } from "react"
import { LeftRail } from "./LeftRail"
import { CenterTabs, type CenterTab } from "./CenterTabs"
import { RightRail } from "./RightRail"
import { CommandPalette } from "./CommandPalette"

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(true)

  const initialTabs: CenterTab[] = [
    { id: "chat", label: "Chat", content: children, closable: false },
  ]

  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      <LeftRail
        collapsed={leftCollapsed}
        onToggle={() => setLeftCollapsed((c) => !c)}
      />
      <CenterTabs initialTabs={initialTabs} defaultTabId="chat" />
      <RightRail
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed((c) => !c)}
      />
      <CommandPalette />
    </div>
  )
}

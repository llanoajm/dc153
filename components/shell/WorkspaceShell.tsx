"use client"

import { ReactNode, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { LeftRail } from "./LeftRail"
import { CenterTabs, type CenterTab } from "./CenterTabs"
import { RightRail } from "./RightRail"
import { CommandPalette } from "./CommandPalette"

// Maps each left-rail section key to its route. Sections that don't have a
// dedicated route yet stay no-op so the rail item still highlights without
// breaking navigation.
const RAIL_ROUTES: Record<string, string> = {
  chats: "/app",
  sources: "/app/sources",
  networks: "/app/networks",
  runs: "/app/runs",
  glossary: "/app/glossary",
  skills: "/app/features",
  orgs: "/app/orgs",
}

function currentRailKey(pathname: string): string {
  if (pathname.startsWith("/app/sources")) return "sources"
  if (pathname.startsWith("/app/networks")) return "networks"
  if (pathname.startsWith("/app/runs")) return "runs"
  if (pathname.startsWith("/app/glossary")) return "glossary"
  if (pathname.startsWith("/app/features")) return "skills"
  if (pathname.startsWith("/app/orgs")) return "orgs"
  if (pathname.startsWith("/app/artifacts/")) return "networks"
  return "chats"
}

function primaryTabLabel(pathname: string): string {
  if (pathname.startsWith("/app/sources")) return "Sources"
  if (pathname.startsWith("/app/networks")) return "Networks"
  if (pathname.startsWith("/app/runs/compare")) return "Compare runs"
  if (pathname.startsWith("/app/runs/")) return "Run"
  if (pathname === "/app/runs") return "Runs"
  if (pathname.startsWith("/app/glossary")) return "Glossary"
  if (pathname.startsWith("/app/features")) return "Features"
  if (pathname.startsWith("/app/orgs")) return "Orgs"
  if (pathname.startsWith("/app/artifacts/")) return "Artifact"
  return "Chat"
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(true)

  const tabs: CenterTab[] = [
    { id: "primary", label: primaryTabLabel(pathname), content: children, closable: false },
  ]

  const handleRailSelect = (key: string) => {
    const href = RAIL_ROUTES[key]
    if (href) router.push(href)
  }

  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      <LeftRail
        collapsed={leftCollapsed}
        onToggle={() => setLeftCollapsed((c) => !c)}
        active={currentRailKey(pathname)}
        onSelect={handleRailSelect}
      />
      <CenterTabs tabs={tabs} activeId="primary" onSelect={() => {}} />
      <RightRail
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed((c) => !c)}
      />
      <CommandPalette />
    </div>
  )
}

"use client"

import { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { WorkspaceShell, type PinnedDashboard } from "./WorkspaceShell"

// Decides which chrome wraps an /app route. The workspace gallery (`/app`) and
// the creation wizard (`/app/new`) are account-level, full-bleed surfaces with
// NO chat sidebar (WORKSPACE_REDESIGN.md §5). Every other /app route — the
// workspace chat (`/app/w/[id]`) and the legacy secondary panels — keeps the
// WorkspaceShell so its left rail / chats / single-network chrome still works.
function isFullBleed(pathname: string): boolean {
  return pathname === "/app" || pathname === "/app/new"
}

export function AppChrome({
  children,
  pinnedDashboards = [],
  email,
}: {
  children: ReactNode
  pinnedDashboards?: PinnedDashboard[]
  email?: string | null
}) {
  const pathname = usePathname()
  if (isFullBleed(pathname)) {
    return <div className="flex-1 min-h-0 min-w-0 overflow-y-auto">{children}</div>
  }
  return (
    <WorkspaceShell pinnedDashboards={pinnedDashboards} email={email}>
      {children}
    </WorkspaceShell>
  )
}

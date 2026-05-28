"use client"

import { ReactNode, Suspense, useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { LeftRail } from "./LeftRail"
import { CenterTabs, type CenterTab } from "./CenterTabs"
import { CommandPalette } from "./CommandPalette"
import type { PinnedDashboard } from "./types"

export type { PinnedDashboard }

const ACTIVE_NETWORK_STORAGE_KEY = "steinmetz.activeNetworkId"

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
  dashboards: "/app/dashboards",
  panels: "/app/panels",
  demos: "/demos",
  settings: "/app/settings",
}

function currentRailKey(pathname: string, pinned: PinnedDashboard[]): string {
  if (pathname.startsWith("/app/sources")) return "sources"
  if (pathname.startsWith("/app/networks")) return "networks"
  if (pathname.startsWith("/app/runs")) return "runs"
  if (pathname.startsWith("/app/glossary")) return "glossary"
  if (pathname.startsWith("/app/features")) return "skills"
  if (pathname.startsWith("/app/orgs")) return "orgs"
  if (pathname.startsWith("/app/dashboards")) return "dashboards"
  if (pathname.startsWith("/app/panels")) return "panels"
  if (pathname.startsWith("/app/settings")) return "settings"
  if (pathname.startsWith("/app/artifacts/")) {
    const id = pathname.split("/")[3]
    const hit = pinned.find((d) => d.id === id)
    if (hit) return `pin:${hit.id}`
    return "networks"
  }
  return "chats"
}

function primaryTabLabel(pathname: string, pinned: PinnedDashboard[]): string {
  if (pathname.startsWith("/app/sources")) return "Sources"
  if (pathname.startsWith("/app/networks")) return "Networks"
  if (pathname.startsWith("/app/runs/compare")) return "Compare runs"
  if (pathname.startsWith("/app/runs/")) return "Run"
  if (pathname === "/app/runs") return "Runs"
  if (pathname.startsWith("/app/glossary")) return "Glossary"
  if (pathname.startsWith("/app/features")) return "Features"
  if (pathname.startsWith("/app/orgs")) return "Orgs"
  if (pathname.startsWith("/app/dashboards")) return "Dashboards"
  if (pathname.startsWith("/app/panels")) return "Panels"
  if (pathname.startsWith("/app/settings")) return "Settings"
  if (pathname.startsWith("/app/artifacts/")) {
    const id = pathname.split("/")[3]
    const hit = pinned.find((d) => d.id === id)
    if (hit) return hit.name
    return "Artifact"
  }
  return "Chat"
}

export function WorkspaceShell(props: {
  children: ReactNode
  pinnedDashboards?: PinnedDashboard[]
  email?: string | null
}) {
  // useSearchParams must sit under a Suspense boundary so a future `next build`
  // doesn't bail out of static optimization (the route is already dynamic via
  // the auth'd layout, but this keeps the component build-safe in isolation).
  return (
    <Suspense fallback={null}>
      <WorkspaceShellInner {...props} />
    </Suspense>
  )
}

function WorkspaceShellInner({
  children,
  pinnedDashboards = [],
  email,
}: {
  children: ReactNode
  pinnedDashboards?: PinnedDashboard[]
  email?: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [primaryNetworkName, setPrimaryNetworkName] = useState<string | null>(null)

  const activeChatId = searchParams.get("chat")

  // Resolve the workspace's single network to show at the top of the rail. No
  // workspace is bound yet (REDESIGN items 9-10), so mirror the chat composer:
  // the active-network selection (localStorage) is the closest legible answer
  // to "which network?". Once workspaces land, this reads the bound network.
  useEffect(() => {
    let aborted = false
    ;(async () => {
      let savedId: string | null = null
      try {
        savedId = localStorage.getItem(ACTIVE_NETWORK_STORAGE_KEY)
      } catch {
        savedId = null
      }
      if (!savedId) {
        if (!aborted) setPrimaryNetworkName(null)
        return
      }
      try {
        const r = await fetch("/api/artifacts?kind=network&limit=200")
        if (!r.ok) return
        const rows: Array<{ id: string; name: string }> = await r.json()
        if (aborted) return
        const hit = rows.find((n) => n.id === savedId)
        setPrimaryNetworkName(hit?.name ?? null)
      } catch {
        // non-fatal: the rail just shows "No network yet"
      }
    })()
    return () => {
      aborted = true
    }
  }, [pathname, activeChatId])

  const tabs: CenterTab[] = [
    {
      id: "primary",
      label: primaryTabLabel(pathname, pinnedDashboards),
      content: children,
      closable: false,
    },
  ]

  const handleRailSelect = (key: string) => {
    if (key.startsWith("pin:")) {
      const id = key.slice("pin:".length)
      router.push(`/app/artifacts/${id}`)
      return
    }
    const href = RAIL_ROUTES[key]
    if (href) router.push(href)
  }

  const handleNewChat = () => {
    // Unique value so repeated clicks always re-bootstrap a fresh session even
    // when already on /app (the chat page keys its bootstrap effect on ?new).
    router.push(`/app?new=${Date.now()}`)
  }

  const handleOpenChat = (id: string) => {
    router.push(`/app?chat=${encodeURIComponent(id)}`)
  }

  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      <LeftRail
        collapsed={leftCollapsed}
        onToggle={() => setLeftCollapsed((c) => !c)}
        active={currentRailKey(pathname, pinnedDashboards)}
        onSelect={handleRailSelect}
        pinnedDashboards={pinnedDashboards}
        email={email}
        primaryNetworkName={primaryNetworkName}
        activeChatId={activeChatId}
        onNewChat={handleNewChat}
        onOpenChat={handleOpenChat}
      />
      <CenterTabs tabs={tabs} activeId="primary" onSelect={() => {}} />
      <CommandPalette />
    </div>
  )
}

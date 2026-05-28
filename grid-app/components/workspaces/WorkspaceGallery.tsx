"use client"

import { useRouter } from "next/navigation"
import type { WorkspaceCard } from "@/lib/workspaces"

// The workspace gallery grid (WORKSPACE_REDESIGN.md §5). Each card shows a cover,
// the workspace name, its anchored grid, focus chips, and last activity. A "New
// workspace" card leads to the creation wizard. Cards open /app/w/[id].

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return "just now"
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

// A calm, deterministic cover gradient derived from the workspace name, so
// cards read as distinct without shipping image assets or external requests.
function coverGradient(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  const a = h
  const b = (h + 40) % 360
  return `linear-gradient(135deg, hsl(${a} 28% 90%), hsl(${b} 24% 82%))`
}

export function WorkspaceGallery({ workspaces }: { workspaces: WorkspaceCard[] }) {
  const router = useRouter()

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="h-page-title" style={{ marginBottom: 6 }}>
          Workspaces
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sora)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--fg-mute)",
            maxWidth: 560,
          }}
        >
          Each workspace anchors one grid and an intent. Open one to plan, run,
          and analyze in plain language.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NewWorkspaceCard onClick={() => router.push("/app/new")} />
        {workspaces.map((w) => (
          <WorkspaceCardView
            key={w.id}
            workspace={w}
            onClick={() => router.push(`/app/w/${w.id}`)}
          />
        ))}
      </div>
    </div>
  )
}

function WorkspaceCardView({
  workspace,
  onClick,
}: {
  workspace: WorkspaceCard
  onClick: () => void
}) {
  const cover = workspace.cover_image_url
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left flex flex-col overflow-hidden"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--bor-1)",
        borderRadius: "var(--r-4)",
        transition: "border-color var(--t-hover), box-shadow var(--t-hover)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--bor-4)"
        e.currentTarget.style.boxShadow = "0 1px 8px rgba(0,0,0,0.04)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--bor-1)"
        e.currentTarget.style.boxShadow = "none"
      }}
    >
      <div
        className="w-full"
        style={{
          height: 96,
          background: cover ? undefined : coverGradient(workspace.name),
          backgroundImage: cover ? `url(${cover})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="flex flex-col gap-2 px-4 py-3.5 flex-1">
        <div
          className="truncate"
          style={{
            fontFamily: "var(--font-sora)",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--ink-app)",
          }}
        >
          {workspace.name}
        </div>
        <div
          className="truncate"
          style={{
            fontFamily: "var(--font-jetbrains)",
            fontSize: 11,
            color: workspace.primary_network_name
              ? "var(--fg-mute-2)"
              : "var(--fg-mute-4)",
          }}
        >
          {workspace.primary_network_name ?? "No grid yet"}
        </div>
        {workspace.focus.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {workspace.focus.map((f) => (
              <span
                key={f}
                style={{
                  fontFamily: "var(--font-sora)",
                  fontSize: 10.5,
                  color: "var(--fg-mute)",
                  background: "var(--bg-tint)",
                  border: "1px solid var(--bor-1)",
                  borderRadius: "999px",
                  padding: "2px 9px",
                }}
              >
                {f}
              </span>
            ))}
          </div>
        ) : null}
        <div
          className="mt-auto pt-1"
          style={{
            fontFamily: "var(--font-jetbrains)",
            fontSize: 10,
            color: "var(--fg-mute-4)",
          }}
        >
          {relativeTime(workspace.updated_at)}
        </div>
      </div>
    </button>
  )
}

function NewWorkspaceCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-2"
      style={{
        minHeight: 220,
        background: "var(--bg-hairline)",
        border: "1px dashed var(--bor-4)",
        borderRadius: "var(--r-4)",
        transition: "border-color var(--t-hover), background var(--t-hover)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-tint-warm)"
        e.currentTarget.style.borderColor = "var(--ink-app)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--bg-hairline)"
        e.currentTarget.style.borderColor = "var(--bor-4)"
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 26,
          lineHeight: 1,
          color: "var(--fg-mute-3)",
        }}
      >
        +
      </span>
      <span
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--fg-mute-2)",
        }}
      >
        New workspace
      </span>
    </button>
  )
}

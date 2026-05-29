"use client"

import { useEffect, useRef, useState } from "react"

// Bottom-left profile control (WORKSPACE_REDESIGN.md §10). Replaces the
// top-right header Sign out: the account + Sign out now live behind a profile
// circle pinned to the bottom of the left rail. The circle shows the user's
// initial; clicking it opens a small popover with the account email, a link to
// settings, and the Sign out form (POST /auth/signout, unchanged).
export function ProfileMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape so the popover doesn't get stuck open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const initial = (email?.trim()?.[0] ?? "?").toUpperCase()

  return (
    <div ref={ref} className="relative">
      {open ? (
        <div
          role="menu"
          className="absolute left-0 bottom-full mb-2 w-48 py-1.5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--bor-1)",
            borderRadius: "var(--r-3)",
            boxShadow: "0 8px 28px rgba(0,0,0,0.12)",
          }}
        >
          <div className="px-3 py-1.5">
            <div className="label-pane" style={{ fontSize: 9 }}>
              Account
            </div>
            <div
              className="truncate"
              title={email ?? undefined}
              style={{
                fontFamily: "var(--font-jetbrains)",
                fontSize: 11.5,
                color: "var(--ink-app)",
              }}
            >
              {email ?? "Signed in"}
            </div>
          </div>
          <div
            className="my-1"
            style={{ borderTop: "1px solid var(--bor-1)" }}
          />
          <a
            href="/app/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block w-full text-left px-3 py-1.5"
            style={{
              fontFamily: "var(--font-sora)",
              fontSize: 12.5,
              color: "var(--fg-mute)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hairline)"
              e.currentTarget.style.color = "var(--ink-app)"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent"
              e.currentTarget.style.color = "var(--fg-mute)"
            }}
          >
            Settings
          </a>
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              role="menuitem"
              className="block w-full text-left px-3 py-1.5"
              style={{
                fontFamily: "var(--font-sora)",
                fontSize: 12.5,
                color: "var(--fg-mute)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hairline)"
                e.currentTarget.style.color = "var(--ink-app)"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent"
                e.currentTarget.style.color = "var(--fg-mute)"
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-left"
        style={{ fontFamily: "var(--font-sora)", fontSize: 12.5 }}
      >
        <span
          className="flex items-center justify-center shrink-0"
          style={{
            width: 28,
            height: 28,
            borderRadius: "9999px",
            background: "var(--ink-app)",
            color: "var(--bg-card)",
            fontFamily: "var(--font-sora)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {initial}
        </span>
        <span
          className="truncate"
          style={{ color: "var(--fg-mute)", flex: 1 }}
          title={email ?? undefined}
        >
          {email ?? "Account"}
        </span>
      </button>
    </div>
  )
}

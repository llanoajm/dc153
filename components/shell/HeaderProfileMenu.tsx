"use client"

import { useEffect, useRef, useState } from "react"

// Top-right header account control. Distinct from the bottom-of-rail
// ProfileMenu (which opens upward and inlines the email beside the avatar):
// this one is a bare circle that drops a right-aligned menu DOWNWARD when
// clicked. For now the menu only has Log out; extend by adding more
// <Link>/<button> children inside the menu container (the sign-out <form> is
// self-contained, so other items won't interact with it).
export function HeaderProfileMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center transition"
        style={{
          width: 32,
          height: 32,
          borderRadius: "9999px",
          background: "var(--ink-app)",
          color: "var(--bg-card)",
          fontFamily: "var(--font-sora)",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {initial}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-52 py-1.5 z-50"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--bor-1)",
            borderRadius: "var(--r-3)",
            boxShadow: "0 8px 28px rgba(0,0,0,0.12)",
          }}
        >
          {email ? (
            <>
              <div className="px-3 py-1.5">
                <div className="label-pane" style={{ fontSize: 9 }}>
                  Account
                </div>
                <div
                  className="truncate"
                  title={email}
                  style={{
                    fontFamily: "var(--font-jetbrains)",
                    fontSize: 11.5,
                    color: "var(--ink-app)",
                  }}
                >
                  {email}
                </div>
              </div>
              <div
                className="my-1"
                style={{ borderTop: "1px solid var(--bor-1)" }}
              />
            </>
          ) : null}
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
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}

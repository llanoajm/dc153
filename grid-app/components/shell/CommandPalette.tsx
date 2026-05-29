"use client"

import { useEffect, useState } from "react"

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"
      if (isCmdK) {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === "Escape" && open) {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open])

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      style={{ background: "rgba(0,0,0,0.20)" }}
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] max-w-[90vw] overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--bor-3)",
          borderRadius: "var(--r-4)",
          boxShadow: "var(--shadow-pop)",
        }}
        role="dialog"
        aria-label="Command palette"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats, artifacts, skills, commands…"
          className="w-full px-4 py-3 outline-none"
          style={{
            fontFamily: "var(--font-sora)",
            fontSize: 13,
            color: "var(--ink-app)",
            background: "transparent",
            borderBottom: "1px solid var(--bor-1)",
          }}
        />
        <div
          className="px-4 py-6 text-center"
          style={{
            fontFamily: "var(--font-sora)",
            fontSize: 12,
            color: "var(--fg-mute-4)",
          }}
        >
          {query
            ? "No matches."
            : "Type to search. The palette is empty for now — entries populate as you add chats, artifacts, and skills."}
        </div>
        <div
          className="px-3 py-2 flex items-center justify-between"
          style={{
            borderTop: "1px solid var(--bor-1)",
            fontFamily: "var(--font-jetbrains)",
            fontSize: 10,
            color: "var(--fg-mute-4)",
          }}
        >
          <span>type to filter · enter to run</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  )
}

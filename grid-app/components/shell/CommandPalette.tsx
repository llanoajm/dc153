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
      className="fixed inset-0 z-50 bg-black/20 flex items-start justify-center pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] max-w-[90vw] bg-white border border-black/20 shadow-xl"
        role="dialog"
        aria-label="Command palette"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats, artifacts, skills, commands…"
          className="w-full px-4 py-3 text-sm outline-none border-b border-black/10 font-sans"
        />
        <div className="px-4 py-6 text-xs font-serif-soft text-center">
          {query
            ? "No matches."
            : "Type to search. The palette is empty for now — entries populate as you add chats, artifacts, and skills."}
        </div>
        <div className="border-t border-black/10 px-3 py-2 flex items-center justify-between text-[10px] font-mark text-black/40">
          <span>Cmd / Ctrl + K</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  )
}

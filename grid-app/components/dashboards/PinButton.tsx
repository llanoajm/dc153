"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

// Pin / unpin a dashboard. Hits /api/artifacts/<id>/pin and refreshes the
// route tree so the workspace shell picks up the new pinned list on the
// server-rendered layout pass.
export function PinButton({
  id,
  initialPinned,
  size = "sm",
}: {
  id: string
  initialPinned: boolean
  size?: "sm" | "md"
}) {
  const [pinned, setPinned] = useState(initialPinned)
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()

  const toggle = () => {
    const next = !pinned
    setErr(null)
    setPinned(next)
    startTransition(async () => {
      try {
        const r = await fetch(`/api/artifacts/${id}/pin`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pinned: next }),
        })
        if (!r.ok) {
          setPinned(!next)
          const body = await r.json().catch(() => ({}))
          setErr(typeof body.error === "string" ? body.error : `pin failed (${r.status})`)
          return
        }
        router.refresh()
      } catch (e) {
        setPinned(!next)
        setErr(e instanceof Error ? e.message : String(e))
      }
    })
  }

  const padding = size === "md" ? "px-3 py-1.5 text-xs" : "px-2 py-1 text-[11px]"
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`${padding} font-mark tracking-wider uppercase border transition-colors ${
          pinned
            ? "bg-black text-white border-black"
            : "bg-white text-black/70 border-black/20 hover:bg-black/[0.04] hover:text-black"
        }`}
      >
        {pinned ? "Pinned" : "Pin to rail"}
      </button>
      {err ? <span className="text-[10px] font-mono text-red-700">{err}</span> : null}
    </div>
  )
}

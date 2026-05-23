"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { Artifact } from "@/lib/artifacts"

// Promote-to-skill button. Last rung of the ladder (ephemeral → pinned →
// callable skill). Hits POST /api/artifacts/<id>/promote-skill which writes
// `.opencode/skills/panel-<slug>/SKILL.md` into the user's workspace and
// creates a `skill` artifact row whose parent_id points at the panel.
export function PromoteToSkillButton({ artifact }: { artifact: Artifact }) {
  const initiallyPromoted = artifact.metadata?.promoted_to_skill === true
  const [promoted, setPromoted] = useState(initiallyPromoted)
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()

  const onClick = () => {
    setErr(null)
    startTransition(async () => {
      try {
        const r = await fetch(`/api/artifacts/${artifact.id}/promote-skill`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          setErr(typeof body.error === "string" ? body.error : `promote failed (${r.status})`)
          return
        }
        setPromoted(true)
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending || promoted}
        className={`px-3 py-1.5 text-xs font-mark tracking-wider uppercase border transition-colors ${
          promoted
            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
            : "bg-white text-black/70 border-black/20 hover:bg-black/[0.04] hover:text-black"
        } disabled:opacity-60`}
        title="Write a SKILL.md so the agent can re-emit this panel by name in future sessions."
      >
        {promoted ? "Skill installed" : "Promote to skill"}
      </button>
      {err ? <span className="text-[10px] font-mono text-red-700">{err}</span> : null}
    </div>
  )
}

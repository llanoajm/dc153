"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { OrgMembership } from "@/lib/orgs"

// Workspace-shell org switcher (HARDENING §1.3 / LOOP_QUEUE item 1.3). Flips
// `profiles.active_org_id` server-side, then refreshes the route so the new
// overlay files load on the next render and any session created after the
// switch boots with the right org context.
export function OrgSwitcher({
  memberships,
  activeOrgId,
}: {
  memberships: OrgMembership[]
  activeOrgId: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (memberships.length === 0) return null

  const onChange = (value: string) => {
    const next = value === "personal" ? null : value
    setError(null)
    startTransition(async () => {
      const res = await fetch("/api/orgs/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_org_id: next }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? res.statusText)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] font-mark tracking-wider uppercase text-black/40">
        Org
      </label>
      <select
        value={activeOrgId ?? "personal"}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="border border-black/15 bg-white text-xs font-mono px-2 py-1 focus:outline-none focus:border-black disabled:opacity-50"
      >
        <option value="personal">Personal</option>
        {memberships.map((m) => (
          <option key={m.org_id} value={m.org_id}>
            {m.org.name}
          </option>
        ))}
      </select>
      {error ? (
        <span className="text-[10px] font-mono text-red-600" title={error}>
          err
        </span>
      ) : null}
    </div>
  )
}

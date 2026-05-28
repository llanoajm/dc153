"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import type { OrgMembership } from "@/lib/orgs"

// Orgs panel (ROADMAP §10 / LOOP_QUEUE item 14). Lists the user's
// memberships, lets owners/admins create an org, invite members by email,
// and edit the org's canonical glossary + context_doc — the same content
// that gets composed into the agent's session at /app load via
// syncOrgContextOverlays().
export function OrgsPanel({
  initialMemberships,
}: {
  initialMemberships: OrgMembership[]
}) {
  const [memberships, setMemberships] = useState(initialMemberships)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(
    initialMemberships[0]?.org_id ?? null,
  )

  const refresh = useCallback(async () => {
    const r = await fetch("/api/orgs")
    if (r.ok) {
      const list = (await r.json()) as OrgMembership[]
      setMemberships(list)
      if (!selectedOrgId && list[0]) setSelectedOrgId(list[0].org_id)
    }
  }, [selectedOrgId])

  const createOrg = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setCreating(true)
    try {
      const r = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? r.statusText)
      }
      setNewName("")
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  const selected = memberships.find((m) => m.org_id === selectedOrgId) ?? null

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full px-6 py-8 space-y-8">
        <div>
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Orgs &amp; teams
          </div>
          <h1 className="font-soft text-2xl mt-1">Orgs</h1>
          <p className="font-soft text-sm text-black/60 mt-2 max-w-prose">
            Orgs share canonical features, glossary, and company-context with
            their members. New members see the org&apos;s canonical features
            and glossary on first login; their personal glossary layers on
            top of the org&apos;s.
          </p>
        </div>

        <section className="border border-black/10">
          <header className="px-4 py-2 border-b border-black/10 bg-black/[0.03]">
            <span className="font-mono text-[12px] text-black/80">Your orgs</span>
          </header>
          {memberships.length === 0 ? (
            <div className="p-6 text-sm font-soft text-black/50">
              You&apos;re not in any orgs yet. Create one below to share
              features and glossary with a team.
            </div>
          ) : (
            <ul className="divide-y divide-black/5">
              {memberships.map((m) => (
                <li
                  key={m.org_id}
                  className={`px-4 py-3 flex items-center gap-3 cursor-pointer ${
                    selectedOrgId === m.org_id ? "bg-black/[0.04]" : ""
                  }`}
                  onClick={() => setSelectedOrgId(m.org_id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-soft text-sm truncate">
                      {m.org.name}
                    </div>
                    <div className="font-mono text-[11px] text-black/40 truncate">
                      {m.org.slug}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-black/50 uppercase tracking-wider">
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={createOrg}
            className="border-t border-black/10 p-4 flex items-end gap-2"
          >
            <div className="flex-1">
              <label className="text-[11px] font-mark tracking-wider uppercase text-black/50">
                Create a new org
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Acme Power Co."
                className="mt-1 w-full border border-black/20 px-2 py-1.5 text-sm font-soft focus:outline-none focus:border-black"
              />
            </div>
            <button
              type="submit"
              disabled={!newName.trim() || creating}
              className="px-3 py-1.5 bg-black text-white text-[11px] font-mark tracking-wider hover:bg-black/80 disabled:opacity-40"
            >
              {creating ? "creating…" : "create"}
            </button>
          </form>
          {error ? (
            <div className="px-4 py-2 text-xs font-mono text-red-600 border-t border-black/10">
              {error}
            </div>
          ) : null}
        </section>

        {selected ? (
          <OrgDetail
            key={selected.org_id}
            membership={selected}
            onMembersChanged={refresh}
          />
        ) : null}
      </div>
    </div>
  )
}

function OrgDetail({
  membership,
  onMembersChanged,
}: {
  membership: OrgMembership
  onMembersChanged: () => void
}) {
  const canManage = membership.role === "owner" || membership.role === "admin"
  const [members, setMembers] = useState<OrgMembership[]>([])
  const [glossary, setGlossary] = useState("")
  const [context, setContext] = useState("")
  const [inviteEmail, setInviteEmail] = useState("")
  const [savingKind, setSavingKind] = useState<"glossary" | "context_doc" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshMembers = useCallback(async () => {
    const r = await fetch(`/api/orgs/${membership.org_id}/members`)
    if (r.ok) setMembers(await r.json())
  }, [membership.org_id])

  const refreshContext = useCallback(async () => {
    const r = await fetch(`/api/orgs/${membership.org_id}/context`)
    if (!r.ok) return
    const rows = (await r.json()) as Array<{
      kind: string
      view_spec: Record<string, unknown>
    }>
    const g = rows.find((x) => x.kind === "glossary")
    const c = rows.find((x) => x.kind === "context_doc")
    setGlossary(typeof g?.view_spec?.text === "string" ? g.view_spec.text : "")
    setContext(typeof c?.view_spec?.text === "string" ? c.view_spec.text : "")
  }, [membership.org_id])

  useEffect(() => {
    refreshMembers()
    refreshContext()
  }, [refreshMembers, refreshContext])

  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const r = await fetch(`/api/orgs/${membership.org_id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: "member" }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? r.statusText)
      }
      setInviteEmail("")
      await refreshMembers()
      onMembersChanged()
    } catch (e) {
      setError(String(e))
    }
  }

  const removeMember = async (userId: string) => {
    setError(null)
    const r = await fetch(`/api/orgs/${membership.org_id}/members/${userId}`, {
      method: "DELETE",
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      setError(j.error ?? r.statusText)
      return
    }
    await refreshMembers()
    onMembersChanged()
  }

  const saveDoc = async (kind: "glossary" | "context_doc") => {
    setSavingKind(kind)
    setError(null)
    try {
      const text = kind === "glossary" ? glossary : context
      const r = await fetch(`/api/orgs/${membership.org_id}/context`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, text }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? r.statusText)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setSavingKind(null)
    }
  }

  return (
    <section className="border border-black/10">
      <header className="px-4 py-2 border-b border-black/10 bg-black/[0.03] flex items-center justify-between">
        <span className="font-mono text-[12px] text-black/80">
          {membership.org.name}{" "}
          <span className="text-black/40">/ {membership.org.slug}</span>
        </span>
        <span className="font-mono text-[10px] text-black/50 uppercase tracking-wider">
          you are {membership.role}
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        <div className="space-y-2">
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Members ({members.length})
          </div>
          <ul className="border border-black/10 divide-y divide-black/5 max-h-48 overflow-y-auto">
            {members.map((m) => (
              <li
                key={m.user_id}
                className="px-3 py-2 flex items-center gap-2 text-sm font-mono"
              >
                <span className="flex-1 truncate text-[11px]">{m.user_id}</span>
                <span className="text-[10px] text-black/50 uppercase tracking-wider">
                  {m.role}
                </span>
                {canManage || m.user_id === membership.user_id ? (
                  <button
                    onClick={() => removeMember(m.user_id)}
                    className="text-[10px] text-red-700 underline"
                  >
                    {m.user_id === membership.user_id ? "leave" : "remove"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canManage ? (
            <form onSubmit={invite} className="flex items-center gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="member@example.com"
                className="flex-1 border border-black/20 px-2 py-1 text-sm font-mono focus:outline-none focus:border-black"
              />
              <button
                type="submit"
                disabled={!inviteEmail.trim()}
                className="px-2 py-1 bg-black text-white text-[11px] font-mark tracking-wider hover:bg-black/80 disabled:opacity-40"
              >
                invite
              </button>
            </form>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            What this org shares
          </div>
          <p className="font-soft text-xs text-black/60">
            These two markdown documents are loaded into every member&apos;s
            agent session before their personal glossary / context. Org
            canonical features (under{" "}
            <Link href="/app/features" className="underline">
              Skills / Features
            </Link>
            ) become visible to all members too.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 pt-0">
        <DocEditor
          title="org glossary"
          value={glossary}
          onChange={setGlossary}
          onSave={() => saveDoc("glossary")}
          saving={savingKind === "glossary"}
          disabled={!canManage}
        />
        <DocEditor
          title="org company-context"
          value={context}
          onChange={setContext}
          onSave={() => saveDoc("context_doc")}
          saving={savingKind === "context_doc"}
          disabled={!canManage}
        />
      </div>

      {error ? (
        <div className="px-4 py-2 text-xs font-mono text-red-600 border-t border-black/10">
          {error}
        </div>
      ) : null}
    </section>
  )
}

function DocEditor({
  title,
  value,
  onChange,
  onSave,
  saving,
  disabled,
}: {
  title: string
  value: string
  onChange: (s: string) => void
  onSave: () => void
  saving: boolean
  disabled: boolean
}) {
  return (
    <div className="border border-black/10">
      <header className="px-3 py-1.5 border-b border-black/10 bg-black/[0.02] flex items-center justify-between">
        <span className="font-mono text-[11px] text-black/70">{title}</span>
        {!disabled ? (
          <button
            onClick={onSave}
            disabled={saving}
            className="text-[10px] font-mark tracking-wider px-2 py-0.5 bg-black text-white hover:bg-black/80 disabled:opacity-40"
          >
            {saving ? "saving…" : "save canonical"}
          </button>
        ) : null}
      </header>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
        placeholder={
          disabled
            ? "Org owners/admins can edit this."
            : "Markdown. Layered first into every member's agent session."
        }
        className="w-full h-48 px-3 py-2 font-mono text-[12px] leading-relaxed focus:outline-none disabled:bg-black/[0.03]"
      />
    </div>
  )
}

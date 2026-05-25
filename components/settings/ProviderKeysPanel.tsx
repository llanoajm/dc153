"use client"

import { useCallback, useState } from "react"
import type { ProviderKeyRow } from "@/lib/provider-keys"

// Settings panel for per-user provider API keys (HARDENING §1.4). The
// plaintext key is sent to /api/settings/provider-keys POST once on save and
// never round-trips back to the browser; the panel only ever displays
// `key_hint` (masked tail).
//
// Provider key bills usage against the user's own account; until a key is
// set, opencode falls back to the shared OpenRouter key in its env (which
// goes away in Phase 2). The "where to get one" copy below should grow as
// more providers are supported.
const PROVIDER_LABELS: Record<string, { name: string; where: string }> = {
  openrouter: {
    name: "OpenRouter",
    where: "https://openrouter.ai/keys — paste the key starting with sk-or-",
  },
}

export function ProviderKeysPanel({
  initialKeys,
  supported,
}: {
  initialKeys: ProviderKeyRow[]
  supported: string[]
}) {
  const [keys, setKeys] = useState<ProviderKeyRow[]>(initialKeys)
  const [pendingProvider, setPendingProvider] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    const r = await fetch("/api/settings/provider-keys")
    if (r.ok) {
      const j = (await r.json()) as { keys: ProviderKeyRow[] }
      setKeys(j.keys)
    }
  }, [])

  const save = async (provider: string) => {
    const key = (drafts[provider] ?? "").trim()
    if (!key) {
      setError("paste a key first")
      return
    }
    setError(null)
    setPendingProvider(provider)
    try {
      const r = await fetch("/api/settings/provider-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? r.statusText)
      }
      setDrafts((d) => ({ ...d, [provider]: "" }))
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setPendingProvider(null)
    }
  }

  const remove = async (provider: string) => {
    if (!confirm(`Remove your ${provider} key? Sessions will fall back to the shared key.`)) {
      return
    }
    setError(null)
    setPendingProvider(provider)
    try {
      const r = await fetch(
        `/api/settings/provider-keys?provider=${encodeURIComponent(provider)}`,
        { method: "DELETE" },
      )
      if (!r.ok && r.status !== 204) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? r.statusText)
      }
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setPendingProvider(null)
    }
  }

  const stored = new Map(keys.map((k) => [k.provider, k]))

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-6 py-8 space-y-8">
        <div>
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Account
          </div>
          <h1 className="font-serif-soft text-2xl mt-1">Settings</h1>
          <p className="font-serif-soft text-sm text-black/60 mt-2 max-w-prose">
            Provider keys are stored encrypted and used only by your own
            sessions. Until you add one, your sessions bill against the shared
            OpenRouter key in the server&apos;s environment.
          </p>
        </div>

        <section className="border border-black/10">
          <header className="px-4 py-2 border-b border-black/10 bg-black/[0.03]">
            <span className="font-mono text-[12px] text-black/80">
              Provider API keys
            </span>
          </header>

          <ul className="divide-y divide-black/5">
            {supported.map((provider) => {
              const meta = PROVIDER_LABELS[provider] ?? {
                name: provider,
                where: "",
              }
              const row = stored.get(provider)
              const pending = pendingProvider === provider
              return (
                <li key={provider} className="p-4 space-y-3">
                  <div className="flex items-baseline gap-3">
                    <span className="font-serif-soft text-sm">{meta.name}</span>
                    <span className="font-mono text-[11px] text-black/40">
                      {provider}
                    </span>
                  </div>
                  {row ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-mono text-[12px] text-black/70">
                        Stored: {row.key_hint ?? "(no hint)"}
                      </div>
                      <button
                        onClick={() => remove(provider)}
                        disabled={pending}
                        className="px-3 py-1 border border-black/20 text-[11px] font-mark tracking-wider hover:bg-black/[0.04] disabled:opacity-40"
                      >
                        {pending ? "removing…" : "remove"}
                      </button>
                    </div>
                  ) : (
                    <div className="text-[12px] font-serif-soft text-black/50">
                      No key set — using shared env key.
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[11px] font-mark tracking-wider uppercase text-black/50">
                      {row ? "Replace key" : "Add key"}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        autoComplete="off"
                        value={drafts[provider] ?? ""}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [provider]: e.target.value }))
                        }
                        placeholder="paste your key"
                        className="flex-1 border border-black/20 px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-black"
                      />
                      <button
                        onClick={() => save(provider)}
                        disabled={pending || !(drafts[provider] ?? "").trim()}
                        className="px-3 py-1.5 bg-black text-white text-[11px] font-mark tracking-wider hover:bg-black/80 disabled:opacity-40"
                      >
                        {pending ? "saving…" : row ? "replace" : "save"}
                      </button>
                    </div>
                    {meta.where ? (
                      <div className="text-[11px] font-serif-soft text-black/40">
                        {meta.where}
                      </div>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>

          {error ? (
            <div className="px-4 py-2 text-xs font-mono text-red-600 border-t border-black/10">
              {error}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ToolCallCard } from "@/components/chat/ToolCallCard"
import type { ToolPart, ToolState } from "@/components/chat/cards/types"

// ---------- shared types (a minimal mirror of opencode's Part union) ----------

type TextPart = { id: string; type: "text"; text: string; synthetic?: boolean; ignored?: boolean }
type ReasoningPart = { id: string; type: "reasoning"; text: string }
type StepStartPart = { id: string; type: "step-start" }
type StepFinishPart = { id: string; type: "step-finish"; reason?: string }
type AgentPart = { id: string; type: "agent"; name?: string }
type AnyPart =
  | TextPart
  | ReasoningPart
  | StepStartPart
  | StepFinishPart
  | AgentPart
  | ToolPart
  | { id: string; type: string; [k: string]: unknown }

interface MessageInfo {
  id: string
  role: "user" | "assistant"
  time?: { created?: number; completed?: number }
  agent?: string
  modelID?: string
  providerID?: string
}

interface UiMessage {
  info: MessageInfo
  parts: AnyPart[]
  partIndex: Map<string, number>
}

interface NetworkOption {
  id: string
  name: string
  status: string
}

// ---------- active-network context ----------
// The chat has no implicit "current network": solve_opf needs a network
// artifact uuid. When the user picks one in the composer we prepend a compact
// context line to the prompt so the agent defaults to it (and can pass the id
// straight to solve_opf without calling list_networks). The same marker is
// stripped back out for display so the transcript shows a tidy "on <network>"
// chip instead of the raw preamble.
const NETWORK_CTX_PREFIX = "[active-network]"
const ACTIVE_NETWORK_STORAGE_KEY = "steinmetz.activeNetworkId"
const NETWORK_CTX_RE =
  /^\[active-network\] "(.+?)" \(network_artifact_id: ([0-9a-fA-F-]{36})\)[^\n]*\n\n([\s\S]*)$/

function buildNetworkContext(name: string, id: string): string {
  return `${NETWORK_CTX_PREFIX} "${name}" (network_artifact_id: ${id}) — use this network for any solve or analysis unless I specify another.`
}

function splitNetworkContext(
  text: string,
): { networkName: string; body: string } | null {
  if (!text.startsWith(NETWORK_CTX_PREFIX)) return null
  const m = text.match(NETWORK_CTX_RE)
  if (!m) return null
  return { networkName: m[1], body: m[3] }
}

// ---------- chat ----------

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const messagesRef = useRef<UiMessage[]>([])
  const messageIndex = useRef<Map<string, number>>(new Map())

  const [input, setInput] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(true)
  const [networks, setNetworks] = useState<NetworkOption[]>([])
  const [activeNetworkId, setActiveNetworkId] = useState<string | null>(null)
  const messagesEnd = useRef<HTMLDivElement>(null)

  // Load the networks the user can see for the composer picker, and restore
  // the last selection if that network still exists.
  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        const r = await fetch("/api/artifacts?kind=network&limit=200")
        if (!r.ok) return
        const rows: Array<{ id: string; name: string; status: string }> = await r.json()
        if (aborted) return
        const opts = rows.map((a) => ({ id: a.id, name: a.name, status: a.status }))
        setNetworks(opts)
        const saved = localStorage.getItem(ACTIVE_NETWORK_STORAGE_KEY)
        if (saved && opts.some((o) => o.id === saved)) setActiveNetworkId(saved)
      } catch {
        // non-fatal: the picker just shows empty and the agent falls back to
        // list_networks / asking.
      }
    })()
    return () => {
      aborted = true
    }
  }, [])

  const onPickNetwork = useCallback((id: string) => {
    const next = id || null
    setActiveNetworkId(next)
    try {
      if (next) localStorage.setItem(ACTIVE_NETWORK_STORAGE_KEY, next)
      else localStorage.removeItem(ACTIVE_NETWORK_STORAGE_KEY)
    } catch {
      // localStorage unavailable (private mode) — selection still works in-memory.
    }
  }, [])

  // Keep a ref in lockstep so the SSE handler can mutate without stale closures.
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const bootstrapSession = useCallback(async (signal?: AbortSignal) => {
    setBootstrapping(true)
    setError(null)
    try {
      const r = await fetch("/api/opencode/session", { method: "POST", signal })
      const data = await r.json().catch(() => ({}) as { id?: string; error?: string })
      if (signal?.aborted) return
      if (!r.ok || data.error) {
        setError(data.error ?? `session bootstrap failed: HTTP ${r.status}`)
        return
      }
      if (!data.id) {
        setError("session bootstrap failed: server returned no session id")
        return
      }
      setSessionId(data.id)
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return
      setError(String(e))
    } finally {
      if (!signal?.aborted) setBootstrapping(false)
    }
  }, [])

  // Create the session on mount.
  useEffect(() => {
    const ac = new AbortController()
    bootstrapSession(ac.signal)
    return () => ac.abort()
  }, [bootstrapSession])

  // Initial backfill: GET existing messages so reloads aren't blank. Then
  // open the SSE stream.
  useEffect(() => {
    if (!sessionId) return
    let aborted = false
    const ac = new AbortController()

    ;(async () => {
      try {
        const r = await fetch(`/api/opencode/session/${sessionId}/message`, { signal: ac.signal })
        if (!r.ok) return
        const data: Array<{ info: MessageInfo; parts: AnyPart[] }> = await r.json()
        if (aborted) return
        const next: UiMessage[] = []
        const idx = new Map<string, number>()
        for (const m of data) {
          const ui: UiMessage = {
            info: m.info,
            parts: m.parts,
            partIndex: new Map(m.parts.map((p, i) => [p.id, i])),
          }
          idx.set(m.info.id, next.length)
          next.push(ui)
        }
        messageIndex.current = idx
        setMessages(next)
      } catch {
        // ignore — the stream will catch us up
      }
    })()

    return () => {
      aborted = true
      ac.abort()
    }
  }, [sessionId])

  // Stream events for this session and reduce them into UI state.
  useEffect(() => {
    if (!sessionId) return
    const es = new EventSource(`/api/opencode/session/${sessionId}/stream`)
    es.onmessage = (e) => {
      try {
        handleEvent(JSON.parse(e.data))
      } catch {
        // ignore malformed frames
      }
    }
    es.addEventListener("proxy.error", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        setError(data.error)
      } catch {}
    })
    es.onerror = () => {
      // EventSource will auto-reconnect; only surface an error if the page
      // currently expects an active stream.
    }
    return () => {
      es.close()
    }

    function handleEvent(ev: { type: string; properties: Record<string, unknown> }) {
      switch (ev.type) {
        case "message.updated":
          upsertMessage(ev.properties.info as MessageInfo)
          if ((ev.properties.info as MessageInfo).role === "assistant" && (ev.properties.info as MessageInfo).time?.completed) {
            setPending(false)
          }
          break
        case "message.removed":
          removeMessage(ev.properties.messageID as string)
          break
        case "message.part.updated":
          upsertPart(ev.properties.part as AnyPart & { messageID: string })
          break
        case "message.part.delta":
          applyDelta(ev.properties as { messageID: string; partID: string; field: string; delta: string })
          break
        case "message.part.removed":
          removePart(ev.properties.messageID as string, ev.properties.partID as string)
          break
        case "session.idle":
          setPending(false)
          break
        case "session.error": {
          const err = ev.properties.error as { data?: { message?: string } } | undefined
          setError(err?.data?.message ?? "Session error")
          setPending(false)
          break
        }
      }
    }

    function withMessage(messageID: string, mut: (m: UiMessage, list: UiMessage[]) => void) {
      setMessages((prev) => {
        const list = prev.slice()
        const at = messageIndex.current.get(messageID)
        if (at === undefined) return prev
        const m: UiMessage = { ...list[at], parts: list[at].parts.slice(), partIndex: new Map(list[at].partIndex) }
        list[at] = m
        mut(m, list)
        return list
      })
    }

    function upsertMessage(info: MessageInfo) {
      setMessages((prev) => {
        const at = messageIndex.current.get(info.id)
        if (at === undefined) {
          const ui: UiMessage = { info, parts: [], partIndex: new Map() }
          messageIndex.current.set(info.id, prev.length)
          return [...prev, ui]
        }
        const list = prev.slice()
        list[at] = { ...list[at], info }
        return list
      })
    }

    function removeMessage(messageID: string) {
      setMessages((prev) => {
        const at = messageIndex.current.get(messageID)
        if (at === undefined) return prev
        const list = prev.slice()
        list.splice(at, 1)
        messageIndex.current = new Map(list.map((m, i) => [m.info.id, i]))
        return list
      })
    }

    function upsertPart(part: AnyPart & { messageID: string }) {
      withMessage(part.messageID, (m) => {
        const at = m.partIndex.get(part.id)
        if (at === undefined) {
          m.partIndex.set(part.id, m.parts.length)
          m.parts.push(part)
        } else {
          m.parts[at] = part
        }
      })
    }

    function removePart(messageID: string, partID: string) {
      withMessage(messageID, (m) => {
        const at = m.partIndex.get(partID)
        if (at === undefined) return
        m.parts.splice(at, 1)
        m.partIndex = new Map(m.parts.map((p, i) => [p.id, i]))
      })
    }

    function applyDelta({
      messageID,
      partID,
      field,
      delta,
    }: {
      messageID: string
      partID: string
      field: string
      delta: string
    }) {
      withMessage(messageID, (m) => {
        const at = m.partIndex.get(partID)
        if (at === undefined) return
        const p = { ...m.parts[at] } as Record<string, unknown>
        const current = typeof p[field] === "string" ? (p[field] as string) : ""
        p[field] = current + delta
        m.parts[at] = p as AnyPart
      })
    }
  }, [sessionId])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!input.trim() || !sessionId || pending) return
      const raw = input.trim()
      const active = networks.find((n) => n.id === activeNetworkId)
      const text = active ? `${buildNetworkContext(active.name, active.id)}\n\n${raw}` : raw
      setInput("")
      setPending(true)
      setError(null)
      try {
        // Fire-and-forget — the SSE stream is the source of truth for what
        // happens next, so we don't wait on the prompt response body.
        const r = await fetch(`/api/opencode/session/${sessionId}/prompt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        })
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          setError(body.error ?? `prompt failed: ${r.status}`)
          setPending(false)
        }
      } catch (e) {
        setError(String(e))
        setPending(false)
      }
    },
    [input, sessionId, pending, networks, activeNetworkId],
  )

  const hasAnyRenderableContent = useMemo(
    () => messages.some((m) => m.parts.some((p) => isRenderablePart(p))),
    [messages],
  )

  return (
    <div
      className="h-full flex flex-col max-w-3xl mx-auto w-full"
      style={{ background: "var(--bg-app)" }}
    >
      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-5">
        {!hasAnyRenderableContent && !pending ? (
          <div className="mt-24 mx-auto max-w-md">
            <p
              className="label-eyebrow"
              style={{ color: "var(--navy-pop)", marginBottom: 10 }}
            >
              Steinmetz Studio
            </p>
            <p
              style={{
                fontFamily: "var(--font-sora)",
                fontSize: 14,
                lineHeight: 1.55,
                color: "var(--fg-mute)",
              }}
            >
              {sessionId
                ? "Describe what you want — an objective, a constraint, an analysis. The agent will build it in your workspace."
                : "Preparing your workspace…"}
            </p>
            {error && sessionId ? (
              <p
                className="font-mono"
                style={{ fontSize: 11, color: "var(--err)", marginTop: 12 }}
              >
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
        {messages.map((m) => (
          <MessageBlock key={m.info.id} message={m} />
        ))}
        {pending ? (
          <div className="max-w-[85%]">
            <span
              className="chat-msg-role"
              style={{ marginBottom: 4, display: "block" }}
            >
              Agent
            </span>
            <span
              style={{
                fontFamily: "var(--font-sora)",
                fontSize: 12,
                fontStyle: "italic",
                color: "var(--fg-mute-4)",
              }}
            >
              thinking…
            </span>
          </div>
        ) : null}
        {error && hasAnyRenderableContent ? (
          <div className="error-toast inline-block">{error}</div>
        ) : null}
        <div ref={messagesEnd} />
      </div>
      {!sessionId && error ? (
        <div
          role="alert"
          className="px-4 py-3 flex items-start justify-between gap-3"
          style={{
            background: "var(--err-bg)",
            borderTop: "1px solid var(--err-border)",
          }}
        >
          <div style={{ color: "var(--err-fg)" }}>
            <p
              className="font-mark"
              style={{ fontSize: 11, letterSpacing: "var(--track-nav)" }}
            >
              Chat is offline
            </p>
            <p
              className="font-mono mt-1 break-words"
              style={{ fontSize: 12 }}
            >
              {error}
            </p>
          </div>
          <button
            type="button"
            onClick={() => bootstrapSession()}
            disabled={bootstrapping}
            className="shrink-0 px-3 py-1 font-mark disabled:opacity-40"
            style={{
              fontSize: 11,
              letterSpacing: "var(--track-nav)",
              color: "var(--err-fg)",
              border: "1px solid var(--err-border)",
              borderRadius: "var(--r-2)",
              background: "var(--bg-card)",
            }}
          >
            {bootstrapping ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : null}
      <form
        onSubmit={onSubmit}
        className="p-4"
        style={{
          background: "var(--bg-card)",
          borderTop: "1px solid var(--bor-1)",
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <label
            htmlFor="active-network"
            className="font-mark"
            style={{
              fontSize: 10,
              letterSpacing: "var(--track-meta)",
              textTransform: "uppercase",
              color: "var(--fg-mute-4)",
            }}
          >
            Network
          </label>
          <select
            id="active-network"
            value={activeNetworkId ?? ""}
            onChange={(e) => onPickNetwork(e.target.value)}
            className="px-2 py-1 outline-none"
            style={{
              fontFamily: "var(--font-jetbrains)",
              fontSize: 11,
              color: "var(--ink-app)",
              background: "var(--bg-card)",
              border: "1px solid var(--bor-3)",
              borderRadius: "var(--r-2)",
              maxWidth: 320,
            }}
          >
            <option value="">— none (agent will ask) —</option>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
                {n.status !== "canonical" && n.status !== "ready" ? ` · ${n.status}` : ""}
              </option>
            ))}
          </select>
          {networks.length === 0 ? (
            <span
              style={{
                fontFamily: "var(--font-jetbrains)",
                fontSize: 10.5,
                color: "var(--fg-mute-4)",
              }}
            >
              no networks yet — add one in Networks
            </span>
          ) : null}
        </div>
        <div className="flex gap-2 items-stretch">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              sessionId
                ? "Ask the agent — describe an objective, a constraint, or an analysis"
                : error
                  ? "Chat is offline — see error above"
                  : "Loading…"
            }
            disabled={!sessionId || pending}
            rows={3}
            className="flex-1 outline-none resize-none px-3 py-2"
            style={{
              fontFamily: "var(--font-sora)",
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--ink-app)",
              background: "var(--bg-card)",
              border: "1px solid var(--bor-3)",
              borderRadius: "var(--r-3)",
              transition: "border-color var(--t-input)",
            }}
            onFocus={(e) =>
              (e.currentTarget.style.borderColor = "var(--ink-app)")
            }
            onBlur={(e) =>
              (e.currentTarget.style.borderColor = "var(--bor-3)")
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSubmit(e)
              }
            }}
          />
          <button
            type="submit"
            disabled={!sessionId || pending || !input.trim()}
            className="font-mark px-5 disabled:opacity-40"
            style={{
              fontSize: 11,
              letterSpacing: "var(--track-meta)",
              background: "var(--ink-app)",
              color: "var(--bg-card)",
              borderRadius: "var(--r-2)",
              transition: "background var(--t-hover)",
            }}
          >
            Send
          </button>
        </div>
        <p
          className="mt-2 flex items-center gap-2"
          style={{
            fontFamily: "var(--font-jetbrains)",
            fontSize: 10.5,
            color: "var(--fg-mute-4)",
          }}
        >
          <span className="mono-kbd">⌘</span>
          <span className="mono-kbd">⏎</span>
          <span>to send · agent runs on Claude Sonnet via OpenRouter</span>
        </p>
      </form>
    </div>
  )
}

// ---------- rendering helpers ----------

function MessageBlock({ message }: { message: UiMessage }) {
  const role = message.info.role
  const parts = message.parts.filter(isRenderablePart)
  if (parts.length === 0) return null
  const isUser = role === "user"
  return (
    <div
      className={`w-full flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
    >
      <span className="chat-msg-role">{isUser ? "you" : "agent"}</span>
      <div
        className={`${isUser ? "max-w-[85%]" : "max-w-full w-full"} flex flex-col gap-2`}
      >
        {parts.map((p) => (
          <PartView key={p.id} part={p} role={role} />
        ))}
      </div>
    </div>
  )
}

function PartView({ part, role }: { part: AnyPart; role: "user" | "assistant" }) {
  if (part.type === "text") {
    const text = (part as TextPart).text
    if (!text) return null
    const isUser = role === "user"
    const ctx = splitNetworkContext(text)
    const body = ctx ? ctx.body : text
    return (
      <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        {ctx ? (
          <span
            className="font-mono"
            style={{ fontSize: 10, color: "var(--fg-mute-4)" }}
          >
            ↳ on {ctx.networkName}
          </span>
        ) : null}
        <div
          className="whitespace-pre-wrap"
          style={{
            fontFamily: "var(--font-sora)",
            fontSize: 12.5,
            lineHeight: 1.5,
            padding: "8px 12px",
            borderRadius: "var(--r-4)",
            background: isUser ? "var(--ink-app)" : "var(--bg-tint-warm)",
            color: isUser ? "var(--bg-card)" : "var(--ink-app)",
          }}
        >
          {body}
        </div>
      </div>
    )
  }
  if (part.type === "reasoning") {
    const text = (part as ReasoningPart).text
    if (!text) return null
    return (
      <details
        className="py-1"
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 11,
          borderLeft: "2px solid var(--bor-1)",
          paddingLeft: 12,
        }}
      >
        <summary
          className="cursor-pointer select-none"
          style={{
            color: "var(--fg-mute-4)",
            textTransform: "uppercase",
            letterSpacing: "var(--track-pane)",
            fontSize: 9,
            fontWeight: 600,
          }}
        >
          reasoning
        </summary>
        <div
          className="mt-1 whitespace-pre-wrap"
          style={{ color: "var(--fg-mute-2)" }}
        >
          {text}
        </div>
      </details>
    )
  }
  if (part.type === "tool") {
    return <ToolCallCard part={part as ToolPart} />
  }
  return null
}

function isRenderablePart(p: AnyPart): boolean {
  if (p.type === "text") {
    const tp = p as TextPart
    return Boolean(tp.text && !tp.synthetic && !tp.ignored)
  }
  if (p.type === "reasoning") return Boolean((p as ReasoningPart).text)
  if (p.type === "tool") {
    // Hide tool parts that haven't begun (no input yet) so the UI doesn't
    // flash empty cards during the first model turn.
    const tp = p as ToolPart
    const st = tp.state as ToolState
    return st.status !== "pending" || Object.keys(st.input ?? {}).length > 0
  }
  return false
}

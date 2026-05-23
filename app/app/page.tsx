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

// ---------- chat ----------

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const messagesRef = useRef<UiMessage[]>([])
  const messageIndex = useRef<Map<string, number>>(new Map())

  const [input, setInput] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEnd = useRef<HTMLDivElement>(null)

  // Keep a ref in lockstep so the SSE handler can mutate without stale closures.
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Create the session on mount.
  useEffect(() => {
    let cancelled = false
    fetch("/api/opencode/session", { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.error) setError(data.error)
        else setSessionId(data.id)
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [])

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
      const text = input.trim()
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
    [input, sessionId, pending],
  )

  const hasAnyRenderableContent = useMemo(
    () => messages.some((m) => m.parts.some((p) => isRenderablePart(p))),
    [messages],
  )

  return (
    <div className="h-full flex flex-col max-w-3xl mx-auto w-full">
      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
        {!hasAnyRenderableContent && !pending ? (
          <div className="text-center text-sm font-serif-soft mt-24">
            <p className="text-base text-black/60">
              {sessionId
                ? "Describe what you want — an objective, a constraint, an analysis. The agent will build it in your workspace."
                : "Preparing your workspace…"}
            </p>
            {error ? <p className="text-red-600 mt-3">{error}</p> : null}
          </div>
        ) : null}
        {messages.map((m) => (
          <MessageBlock key={m.info.id} message={m} />
        ))}
        {pending ? (
          <div className="max-w-[85%]">
            <div className="px-4 py-3 text-sm bg-black/[0.04] text-black/60">Working…</div>
          </div>
        ) : null}
        {error && hasAnyRenderableContent ? (
          <div className="text-xs text-red-600 font-mono">{error}</div>
        ) : null}
        <div ref={messagesEnd} />
      </div>
      <form onSubmit={onSubmit} className="border-t border-black/10 p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              sessionId
                ? "Describe a feature… ('add a nitrogen-emissions objective', etc.)"
                : "Loading…"
            }
            disabled={!sessionId || pending}
            rows={3}
            className="flex-1 border border-black/20 focus:border-black px-3 py-2 outline-none text-sm font-sans resize-none"
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
            className="bg-black text-white px-5 text-sm font-mark tracking-wider disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="mt-2 text-[11px] font-serif-soft">
          ⌘/Ctrl+Enter to send. Agent runs on Claude Sonnet via OpenRouter.
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
  return (
    <div className={`w-full ${role === "user" ? "flex justify-end" : ""}`}>
      <div className={`${role === "user" ? "max-w-[85%]" : "max-w-full w-full"} space-y-2`}>
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
    return (
      <div
        className={`px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
          role === "user" ? "bg-black text-white" : "bg-black/[0.04] text-black"
        }`}
      >
        {text}
      </div>
    )
  }
  if (part.type === "reasoning") {
    const text = (part as ReasoningPart).text
    if (!text) return null
    return (
      <details className="text-[11px] font-serif-soft border-l-2 border-black/15 pl-3 py-1">
        <summary className="cursor-pointer text-black/50 select-none">reasoning</summary>
        <div className="mt-1 whitespace-pre-wrap text-black/70">{text}</div>
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

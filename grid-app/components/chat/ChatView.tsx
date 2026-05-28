"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ToolCallCard } from "@/components/chat/ToolCallCard"
import type { ToolPart, ToolState } from "@/components/chat/cards/types"
import {
  ATTACH_ACCEPT,
  encodeAttachments,
  formatBytes,
  isSupportedAttachment,
  splitAttachments,
  type PendingAttachment,
  type SentAttachment,
} from "@/lib/chat-upload"

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

// Empty-state suggestions — phrased as the redesign wants the user to talk to
// the harness (no "zap", no UUID; the workspace network is the implicit
// subject). Clicking one drops it into the composer for editing.
const SUGGESTED_PROMPTS: ReadonlyArray<string> = [
  "Get me the power generation schedules for the next couple of days.",
  "Plan some expansion in this area, optimizing for cost and emissions.",
  "Show me where the grid is most congested and why.",
  "Estimate the cost of adding 200 MW of solar near the busiest bus.",
]

// ---------- chat ----------

export function ChatView({ workspaceId = null }: { workspaceId?: string | null }) {
  // useSearchParams (reads ?chat / ?new from the sidebar) must sit under a
  // Suspense boundary to stay build-safe.
  return (
    <Suspense fallback={null}>
      <ChatViewInner workspaceId={workspaceId} />
    </Suspense>
  )
}

function ChatViewInner({ workspaceId }: { workspaceId: string | null }) {
  const searchParams = useSearchParams()
  const chatParam = searchParams.get("chat")
  const newParam = searchParams.get("new")

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const messagesRef = useRef<UiMessage[]>([])
  const messageIndex = useRef<Map<string, number>>(new Map())
  // The persisted chat row (REDESIGN §4). Null until the first message creates
  // it. workspace_id is null until the gallery/wizard (items 9-10) bind a chat
  // to a workspace — the column is nullable by design.
  const chatIdRef = useRef<string | null>(null)

  const [input, setInput] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(true)
  const [networks, setNetworks] = useState<NetworkOption[]>([])
  const [activeNetworkId, setActiveNetworkId] = useState<string | null>(null)
  // Files attached in the composer, awaiting (or just finished) upload. Cleared
  // once they're sent with a message. (WORKSPACE_REDESIGN §10.)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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

  // Upload one attached file through the existing source-document route so it
  // also lands in the Sources tab; track its status as a chip in the composer.
  const uploadAttachment = useCallback(async (file: File) => {
    const localId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setAttachments((prev) => [
      ...prev,
      {
        localId,
        filename: file.name,
        bytes: file.size,
        status: "uploading",
      },
    ])
    try {
      const fd = new FormData()
      fd.append("file", file)
      const r = await fetch("/api/upload/source", { method: "POST", body: fd })
      const data = await r.json().catch(() => ({}) as { id?: string; error?: string })
      if (!r.ok || !data.id) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.localId === localId
              ? { ...a, status: "error", error: data.error ?? `upload failed: ${r.status}` }
              : a,
          ),
        )
        return
      }
      setAttachments((prev) =>
        prev.map((a) =>
          a.localId === localId ? { ...a, status: "ready", artifactId: data.id } : a,
        ),
      )
    } catch (e) {
      setAttachments((prev) =>
        prev.map((a) =>
          a.localId === localId ? { ...a, status: "error", error: String(e) } : a,
        ),
      )
    }
  }, [])

  const onPickFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return
      for (const file of Array.from(fileList)) {
        if (!isSupportedAttachment(file)) {
          setError(`unsupported file type: ${file.name}`)
          continue
        }
        void uploadAttachment(file)
      }
    },
    [uploadAttachment],
  )

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => prev.filter((a) => a.localId !== localId))
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

  // Reopen a past chat (sidebar → /app?chat=<id>): fetch its opencode
  // session id and adopt it instead of bootstrapping a fresh one. The initial
  // message backfill + SSE effects below key off sessionId, so they reload the
  // transcript automatically once it's set.
  const reopenChat = useCallback(
    async (chatId: string, signal?: AbortSignal) => {
      setBootstrapping(true)
      setError(null)
      try {
        const r = await fetch(`/api/chats/${chatId}`, { signal })
        const data = await r
          .json()
          .catch(() => ({}) as { session_id?: string; error?: string })
        if (signal?.aborted) return
        if (!r.ok || data.error || !data.session_id) {
          setError(data.error ?? `could not open chat: HTTP ${r.status}`)
          return
        }
        chatIdRef.current = chatId
        setMessages([])
        setAttachments([])
        messageIndex.current = new Map()
        setSessionId(data.session_id)
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return
        setError(String(e))
      } finally {
        if (!signal?.aborted) setBootstrapping(false)
      }
    },
    [],
  )

  // On mount / when the sidebar changes the ?chat or ?new param: reopen the
  // requested chat, or start a fresh session otherwise.
  useEffect(() => {
    const ac = new AbortController()
    if (chatParam) {
      void reopenChat(chatParam, ac.signal)
    } else {
      // Fresh chat (default, or explicit ?new=1): clear any prior reopened
      // chat handle so the next first message persists a new row.
      chatIdRef.current = null
      bootstrapSession(ac.signal)
    }
    return () => ac.abort()
    // newParam is included so clicking "New chat" while already on a fresh
    // session still re-bootstraps a brand-new session.
  }, [bootstrapSession, reopenChat, chatParam, newParam])

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

  // Auto-grow the composer textarea with its content (capped by maxHeight CSS),
  // so it reads as a single line at rest and expands like a modern chat input.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [input])

  // Create the chat row on first message, then touch it on every later one so
  // it floats to the top of the sidebar history. Best-effort: a persistence
  // hiccup must not break the conversation, which lives in opencode regardless.
  const persistChat = useCallback(async (session: string, firstMessage: string) => {
    try {
      if (!chatIdRef.current) {
        const r = await fetch("/api/chats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspaceId,
            session_id: session,
            first_message: firstMessage,
          }),
        })
        if (r.ok) {
          const chat = await r.json().catch(() => null)
          if (chat?.id) chatIdRef.current = chat.id as string
        }
      } else {
        await fetch(`/api/chats/${chatIdRef.current}`, { method: "PATCH" })
      }
    } catch {
      // non-fatal — the chat just won't appear in history until next message
    }
  }, [workspaceId])

  const readyAttachments = useMemo(
    () => attachments.filter((a) => a.status === "ready"),
    [attachments],
  )
  const hasUploading = useMemo(
    () => attachments.some((a) => a.status === "uploading"),
    [attachments],
  )

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!sessionId || pending || hasUploading) return
      const raw = input.trim()
      // Allow sending when there's text OR at least one finished upload.
      if (!raw && readyAttachments.length === 0) return
      const sent: SentAttachment[] = readyAttachments.map((a) => ({
        filename: a.filename,
        artifactId: a.artifactId as string,
      }))
      const body = encodeAttachments(raw, sent)
      const active = networks.find((n) => n.id === activeNetworkId)
      const text = active ? `${buildNetworkContext(active.name, active.id)}\n\n${body}` : body
      setInput("")
      setAttachments([])
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
          const errBody = await r.json().catch(() => ({}))
          setError(errBody.error ?? `prompt failed: ${r.status}`)
          setPending(false)
        } else {
          // Persist the chat on its first message (REDESIGN §4) so it shows up
          // in the sidebar history; bump recency on subsequent messages.
          void persistChat(sessionId, raw || sent.map((a) => a.filename).join(", "))
        }
      } catch (e) {
        setError(String(e))
        setPending(false)
      }
    },
    [
      input,
      sessionId,
      pending,
      hasUploading,
      readyAttachments,
      networks,
      activeNetworkId,
      persistChat,
    ],
  )

  const hasAnyRenderableContent = useMemo(
    () => messages.some((m) => m.parts.some((p) => isRenderablePart(p))),
    [messages],
  )

  // Empty-state suggested prompts drop their text into the composer (focused)
  // so the user can edit before sending — they don't auto-send.
  const applySuggestion = useCallback((text: string) => {
    setInput(text)
    // Defer focus to after the textarea is interactive.
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const showEmptyState = !hasAnyRenderableContent && !pending
  const sendDisabled =
    !sessionId ||
    pending ||
    hasUploading ||
    (!input.trim() && readyAttachments.length === 0)

  return (
    <div
      className="h-full flex flex-col w-full"
      style={{ background: "var(--bg-app)" }}
    >
      {/* Thread (or the calm empty state, vertically centered). */}
      <div className="flex-1 overflow-y-auto">
        {showEmptyState ? (
          <div className="h-full flex items-center justify-center px-6">
            <div className="w-full max-w-2xl text-center">
              <p
                className="h-page-title"
                style={{ marginBottom: 10 }}
              >
                {sessionId ? "What can I help you build?" : "Preparing your workspace…"}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-sora)",
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: "var(--fg-mute)",
                  maxWidth: 460,
                  margin: "0 auto",
                }}
              >
                {sessionId
                  ? "Describe an objective, a constraint, or an analysis — in plain language. The agent runs it against your network and builds the result in your workspace."
                  : "Setting things up. This only takes a moment."}
              </p>
              {sessionId ? (
                <div className="mt-7 grid gap-2.5 sm:grid-cols-2 text-left">
                  {SUGGESTED_PROMPTS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="suggest-chip"
                      onClick={() => applySuggestion(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
              {error && sessionId ? (
                <p
                  className="font-mono mt-6"
                  style={{ fontSize: 11, color: "var(--err)" }}
                >
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-6 py-8 flex flex-col gap-7">
            {messages.map((m) => (
              <MessageBlock key={m.info.id} message={m} />
            ))}
            {pending ? (
              <div className="w-full flex flex-col gap-1.5 items-start">
                <span className="chat-msg-role">agent</span>
                <span className="typing-dots" aria-label="Agent is thinking">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            ) : null}
            {error && hasAnyRenderableContent ? (
              <div className="error-toast inline-block self-start">{error}</div>
            ) : null}
            <div ref={messagesEnd} />
          </div>
        )}
      </div>

      {/* Offline banner: bootstrap failed and there's no session to talk to. */}
      {!sessionId && error ? (
        <div className="mx-auto w-full max-w-3xl px-6 pb-3">
          <div
            role="alert"
            className="px-4 py-3 flex items-start justify-between gap-3"
            style={{
              background: "var(--err-bg)",
              border: "1px solid var(--err-border)",
              borderRadius: "var(--r-4)",
            }}
          >
            <div style={{ color: "var(--err-fg)" }}>
              <p
                className="font-mark"
                style={{ fontSize: 11, letterSpacing: "var(--track-nav)" }}
              >
                Chat is offline
              </p>
              <p className="font-mono mt-1 break-words" style={{ fontSize: 12 }}>
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
        </div>
      ) : null}

      {/* Composer — a single focused pill, centered to match the thread. */}
      <div className="px-6 pb-5 pt-1">
        <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl">
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACH_ACCEPT}
            multiple
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              onPickFiles(e.target.files)
              // Reset so re-selecting the same file fires change again.
              e.target.value = ""
            }}
          />
          <div className="composer-shell px-2.5 py-2">
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2 px-1 pt-1 pb-2">
                {attachments.map((a) => (
                  <ComposerAttachmentChip
                    key={a.localId}
                    attachment={a}
                    onRemove={() => removeAttachment(a.localId)}
                  />
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-1.5">
              <button
                type="button"
                aria-label="Attach a file"
                title="Attach a file"
                disabled={!sessionId || pending}
                onClick={() => fileInputRef.current?.click()}
                className="composer-icon-btn shrink-0"
              >
                +
              </button>
              <textarea
                ref={textareaRef}
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
                rows={1}
                className="composer-input flex-1 py-1.5"
                style={{ maxHeight: 200, overflowY: "auto" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    onSubmit(e)
                  }
                }}
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={sendDisabled}
                className="composer-send shrink-0"
                title="Send (⌘↵)"
              >
                <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>
                  ↑
                </span>
              </button>
            </div>
          </div>
          {/* Controls row: implicit network subject + send hint. */}
          <div className="mt-2.5 flex items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2 min-w-0">
              <label
                htmlFor="active-network"
                className="font-mark shrink-0"
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
                className="px-2 py-1 outline-none min-w-0"
                style={{
                  fontFamily: "var(--font-jetbrains)",
                  fontSize: 11,
                  color: "var(--ink-app)",
                  background: "var(--bg-card)",
                  border: "1px solid var(--bor-3)",
                  borderRadius: "var(--r-2)",
                  maxWidth: 280,
                }}
              >
                <option value="">— none (agent will ask) —</option>
                {networks.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                    {n.status !== "canonical" && n.status !== "ready"
                      ? ` · ${n.status}`
                      : ""}
                  </option>
                ))}
              </select>
            </div>
            <p
              className="hidden sm:flex items-center gap-2 shrink-0"
              style={{
                fontFamily: "var(--font-jetbrains)",
                fontSize: 10.5,
                color: "var(--fg-mute-4)",
              }}
            >
              <span className="mono-kbd">⌘</span>
              <span className="mono-kbd">⏎</span>
              <span>to send</span>
            </p>
          </div>
        </form>
      </div>
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
      className={`w-full flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}
    >
      {isUser ? null : <span className="chat-msg-role">agent</span>}
      <div
        className={`${isUser ? "max-w-[80%]" : "max-w-full w-full"} flex flex-col gap-2`}
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
    const afterNetwork = ctx ? ctx.body : text
    // Attachments may lead the message body (after any network context line);
    // peel them off so they render as chips instead of raw preamble text.
    const att = splitAttachments(afterNetwork)
    const sentAttachments = att ? att.attachments : []
    const body = att ? att.body : afterNetwork
    const hasBody = body.trim().length > 0
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
        {sentAttachments.length > 0 ? (
          <div className={`flex flex-wrap gap-2 ${isUser ? "justify-end" : ""}`}>
            {sentAttachments.map((a) => (
              <SentAttachmentChip key={a.artifactId} attachment={a} />
            ))}
          </div>
        ) : null}
        {hasBody ? (
          <div
            className="whitespace-pre-wrap break-words"
            style={
              isUser
                ? {
                    fontFamily: "var(--font-sora)",
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    padding: "10px 15px",
                    borderRadius: "18px",
                    background: "var(--ink-app)",
                    color: "var(--bg-card)",
                  }
                : {
                    fontFamily: "var(--font-sora)",
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "var(--fg-body)",
                  }
            }
          >
            {body}
          </div>
        ) : null}
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

// ---------- attachment chips ----------

function chipShellStyle(): React.CSSProperties {
  return {
    fontFamily: "var(--font-jetbrains)",
    fontSize: 11,
    color: "var(--ink-app)",
    background: "var(--bg-card)",
    border: "1px solid var(--bor-3)",
    borderRadius: "var(--r-2)",
    padding: "4px 8px",
  }
}

// A chip in the composer for a file the user attached but hasn't sent yet.
// Shows upload progress / error and a remove (×) control.
function ComposerAttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment
  onRemove: () => void
}) {
  const { filename, bytes, status, error } = attachment
  return (
    <span
      className="inline-flex items-center gap-2 max-w-[260px]"
      style={chipShellStyle()}
      title={error ?? filename}
    >
      <span className="truncate" style={{ maxWidth: 150 }}>
        {filename}
      </span>
      <span style={{ color: "var(--fg-mute-4)", fontSize: 10 }}>
        {status === "uploading"
          ? "uploading…"
          : status === "error"
            ? "failed"
            : formatBytes(bytes)}
      </span>
      <button
        type="button"
        aria-label={`Remove ${filename}`}
        onClick={onRemove}
        className="shrink-0"
        style={{
          color: "var(--fg-mute-4)",
          fontSize: 13,
          lineHeight: 1,
          background: "transparent",
        }}
      >
        ×
      </button>
    </span>
  )
}

// A chip in a sent message: a link to the uploaded artifact's viewer.
function SentAttachmentChip({ attachment }: { attachment: SentAttachment }) {
  return (
    <a
      href={`/app/artifacts/${attachment.artifactId}`}
      className="inline-flex items-center gap-1.5 max-w-[260px] no-underline hover:opacity-80"
      style={chipShellStyle()}
      title={attachment.filename}
    >
      <span aria-hidden="true" style={{ color: "var(--fg-mute-4)" }}>
        ↟
      </span>
      <span className="truncate" style={{ maxWidth: 200 }}>
        {attachment.filename}
      </span>
    </a>
  )
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

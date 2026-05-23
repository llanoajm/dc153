"use client"

import { useCallback, useEffect, useRef, useState } from "react"

interface MessagePart {
  id?: string
  type?: string
  text?: string
  [k: string]: unknown
}

interface Message {
  info?: {
    id: string
    role: "user" | "assistant"
    time?: { created?: number }
  }
  parts?: MessagePart[]
}

function textFromParts(parts: MessagePart[] | undefined): string {
  if (!parts) return ""
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n\n")
    .trim()
}

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEnd = useRef<HTMLDivElement>(null)

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

  const refreshMessages = useCallback(async () => {
    if (!sessionId) return
    const r = await fetch(`/api/opencode/session/${sessionId}/message`)
    if (!r.ok) return
    const data: Message[] = await r.json()
    setMessages(data)
  }, [sessionId])

  // Poll while pending so tool calls show up incrementally.
  useEffect(() => {
    if (!sessionId || !pending) return
    const t = setInterval(() => refreshMessages(), 2500)
    return () => clearInterval(t)
  }, [sessionId, pending, refreshMessages])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || !sessionId || pending) return
    const text = input.trim()
    setInput("")
    setPending(true)
    setError(null)
    try {
      await fetch(`/api/opencode/session/${sessionId}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      })
      await refreshMessages()
    } catch (e) {
      setError(String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="h-full flex flex-col max-w-3xl mx-auto w-full">
      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
        {messages.length === 0 && !pending ? (
          <div className="text-center text-sm font-serif-soft mt-24">
            <p className="text-base text-black/60">
              {sessionId
                ? "Describe what you want — an objective, a constraint, an analysis. The agent will build it in your workspace."
                : "Preparing your workspace…"}
            </p>
            {error ? <p className="text-red-600 mt-3">{error}</p> : null}
          </div>
        ) : null}
        {messages.map((m, i) => {
          const role = m.info?.role
          const text = textFromParts(m.parts)
          if (!text) return null
          return (
            <div
              key={m.info?.id ?? i}
              className={`max-w-[85%] ${role === "user" ? "ml-auto" : ""}`}
            >
              <div
                className={`px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                  role === "user"
                    ? "bg-black text-white"
                    : "bg-black/[0.04] text-black"
                }`}
              >
                {text}
              </div>
            </div>
          )
        })}
        {pending ? (
          <div className="max-w-[85%]">
            <div className="px-4 py-3 text-sm bg-black/[0.04] text-black/60">
              Working…
            </div>
          </div>
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

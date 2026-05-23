"use client"

import { useState, type ReactNode } from "react"
import type { ToolState, ToolStatus } from "./types"

interface BaseCardProps {
  label: string
  state: ToolState
  title?: string
  // Inline summary shown next to the label (e.g. command, file path).
  subtitle?: ReactNode
  // Expanded body content. If omitted, the card is not collapsible.
  body?: ReactNode
  defaultExpanded?: boolean
}

export function BaseCard({ label, state, subtitle, body, defaultExpanded = false }: BaseCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const status = state.status
  return (
    <div className="border border-black/15 bg-white text-[12px]">
      <button
        type="button"
        onClick={() => body && setExpanded((e) => !e)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${
          body ? "cursor-pointer hover:bg-black/[0.03]" : "cursor-default"
        }`}
      >
        <StatusDot status={status} />
        <span className="font-mark text-[10px] tracking-wider text-black/70 shrink-0">{label}</span>
        {subtitle ? (
          <span className="truncate text-black/80 font-mono text-[11px]" title={typeof subtitle === "string" ? subtitle : undefined}>
            {subtitle}
          </span>
        ) : null}
        <span className="ml-auto text-black/40 text-[10px]">
          {status === "error" ? "failed" : status === "completed" ? "" : status}
          {body ? <span className="ml-2">{expanded ? "−" : "+"}</span> : null}
        </span>
      </button>
      {body && expanded ? <div className="border-t border-black/10 px-3 py-2">{body}</div> : null}
    </div>
  )
}

function StatusDot({ status }: { status: ToolStatus }) {
  const color =
    status === "completed"
      ? "bg-black"
      : status === "error"
        ? "bg-red-600"
        : status === "running"
          ? "bg-amber-500 animate-pulse"
          : "bg-black/30"
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} shrink-0`} aria-hidden />
}

export function Pre({ children }: { children: ReactNode }) {
  return (
    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-snug text-black/80 max-h-72 overflow-auto">
      {children}
    </pre>
  )
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2 text-[11px] py-0.5">
      <span className="font-mark text-[9px] tracking-wider text-black/50">{k}</span>
      <span className="font-mono text-black/80 break-all">{v}</span>
    </div>
  )
}

export function ErrorBlock({ error }: { error: string }) {
  return (
    <div className="mt-1 border-l-2 border-red-600 pl-2 text-[11px] text-red-700 font-mono whitespace-pre-wrap">
      {error}
    </div>
  )
}

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
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--bor-1)",
        borderRadius: "var(--r-2)",
        fontSize: 12,
      }}
    >
      <button
        type="button"
        onClick={() => body && setExpanded((e) => !e)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${
          body ? "cursor-pointer" : "cursor-default"
        }`}
        style={{ transition: "background var(--t-hover)" }}
        onMouseEnter={(e) => {
          if (body) e.currentTarget.style.background = "var(--bg-hairline)"
        }}
        onMouseLeave={(e) => {
          if (body) e.currentTarget.style.background = "transparent"
        }}
      >
        <StatusDot status={status} />
        <span
          className="shrink-0"
          style={{
            fontFamily: "var(--font-jetbrains)",
            fontSize: 10.5,
            fontWeight: 700,
            color: "var(--ink-app)",
          }}
        >
          {label}
        </span>
        {subtitle ? (
          <span
            className="truncate"
            style={{
              fontFamily: "var(--font-jetbrains)",
              fontSize: 11,
              color: "var(--fg-mute-2)",
            }}
            title={typeof subtitle === "string" ? subtitle : undefined}
          >
            {subtitle}
          </span>
        ) : null}
        <span
          className="ml-auto"
          style={{
            fontFamily: "var(--font-jetbrains)",
            fontSize: 10.5,
            color: statusColor(status),
          }}
        >
          {status === "error"
            ? "failed"
            : status === "completed"
              ? "done"
              : status}
          {body ? (
            <span style={{ marginLeft: 8, color: "var(--fg-mute-4)" }}>
              {expanded ? "−" : "+"}
            </span>
          ) : null}
        </span>
      </button>
      {body && expanded ? (
        <div
          className="px-3 py-2"
          style={{ borderTop: "1px solid var(--bor-1)" }}
        >
          {body}
        </div>
      ) : null}
    </div>
  )
}

function statusColor(status: ToolStatus): string {
  switch (status) {
    case "completed":
      return "var(--ok)"
    case "running":
      return "var(--warn)"
    case "error":
      return "var(--err)"
    default:
      return "var(--fg-mute-2)"
  }
}

function StatusDot({ status }: { status: ToolStatus }) {
  let bg = "var(--fg-mute-4)"
  let pulse = false
  if (status === "completed") bg = "var(--ok)"
  else if (status === "error") bg = "var(--err)"
  else if (status === "running") {
    bg = "var(--warn)"
    pulse = true
  }
  return (
    <span
      className={`inline-block shrink-0 ${pulse ? "animate-pulse" : ""}`}
      style={{
        width: 6,
        height: 6,
        borderRadius: "9999px",
        background: bg,
      }}
      aria-hidden
    />
  )
}

export function Pre({ children }: { children: ReactNode }) {
  return (
    <pre
      className="whitespace-pre-wrap max-h-72 overflow-auto"
      style={{
        fontFamily: "var(--font-jetbrains)",
        fontSize: 11,
        lineHeight: 1.45,
        color: "var(--fg-mute)",
        background: "var(--bg-hairline)",
        borderRadius: "var(--r-2)",
        padding: 8,
      }}
    >
      {children}
    </pre>
  )
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div
      className="grid gap-2 py-0.5"
      style={{ gridTemplateColumns: "80px 1fr" }}
    >
      <span
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 9,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "var(--track-pane)",
          color: "var(--fg-mute-3)",
        }}
      >
        {k}
      </span>
      <span
        className="break-all"
        style={{
          fontFamily: "var(--font-jetbrains)",
          fontSize: 11,
          color: "var(--ink-app)",
        }}
      >
        {v}
      </span>
    </div>
  )
}

export function ErrorBlock({ error }: { error: string }) {
  return (
    <div
      className="mt-1 whitespace-pre-wrap"
      style={{
        borderLeft: "2px solid var(--err)",
        paddingLeft: 8,
        fontFamily: "var(--font-jetbrains)",
        fontSize: 11,
        color: "var(--err-fg)",
      }}
    >
      {error}
    </div>
  )
}

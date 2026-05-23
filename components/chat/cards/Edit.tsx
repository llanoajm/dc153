"use client"

import type { ToolPart } from "./types"
import { BaseCard, ErrorBlock, KV } from "./Base"

interface Input {
  filePath?: string
  oldString?: string
  newString?: string
  replaceAll?: boolean
}

export function EditCard({ part }: { part: ToolPart }) {
  const input = part.state.input as Input | undefined
  const filePath = input?.filePath ?? "(file)"

  let body = null
  if (part.state.status === "completed" || part.state.status === "running" || part.state.status === "pending") {
    body = <DiffBlock oldText={input?.oldString ?? ""} newText={input?.newString ?? ""} replaceAll={input?.replaceAll} />
  }
  if (part.state.status === "error") {
    body = (
      <>
        <DiffBlock oldText={input?.oldString ?? ""} newText={input?.newString ?? ""} replaceAll={input?.replaceAll} />
        <ErrorBlock error={part.state.error} />
      </>
    )
  }

  return <BaseCard label="Edit" state={part.state} subtitle={filePath} body={body} />
}

function DiffBlock({ oldText, newText, replaceAll }: { oldText: string; newText: string; replaceAll?: boolean }) {
  return (
    <div className="space-y-2">
      {replaceAll ? <KV k="mode" v="replace all" /> : null}
      <DiffPane sign="-" text={oldText} />
      <DiffPane sign="+" text={newText} />
    </div>
  )
}

function DiffPane({ sign, text }: { sign: "-" | "+"; text: string }) {
  const bg = sign === "-" ? "bg-red-50 border-l-red-400" : "bg-emerald-50 border-l-emerald-500"
  return (
    <pre
      className={`border-l-2 ${bg} font-mono text-[11px] leading-snug whitespace-pre-wrap p-2 max-h-60 overflow-auto`}
    >
      {text
        .split("\n")
        .map((line) => `${sign} ${line}`)
        .join("\n")}
    </pre>
  )
}

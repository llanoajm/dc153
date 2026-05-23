"use client"

import type { ToolPart } from "./types"
import { BaseCard, ErrorBlock, KV, Pre } from "./Base"

interface Input {
  filePath?: string
  offset?: number
  limit?: number
}

export function ReadCard({ part }: { part: ToolPart }) {
  const input = (part.state.status === "pending" ? part.state.input : part.state.input) as Input | undefined
  const filePath = input?.filePath ?? "(file)"
  const range =
    input?.offset || input?.limit
      ? ` :${input.offset ?? 1}${input.limit ? `+${input.limit}` : ""}`
      : ""

  let body = null
  if (part.state.status === "completed") {
    body = (
      <>
        {input?.offset || input?.limit ? <KV k="range" v={`offset ${input.offset ?? 1}, limit ${input.limit ?? "—"}`} /> : null}
        <Pre>{part.state.output}</Pre>
      </>
    )
  } else if (part.state.status === "error") {
    body = <ErrorBlock error={part.state.error} />
  }

  return (
    <BaseCard
      label="Read"
      state={part.state}
      subtitle={
        <>
          {filePath}
          <span className="text-black/40">{range}</span>
        </>
      }
      body={body}
    />
  )
}

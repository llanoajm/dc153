"use client"

import type { ToolPart } from "./types"
import { BaseCard, ErrorBlock, KV, Pre } from "./Base"

interface Input {
  query?: string
  numResults?: number
}

export function WebSearchCard({ part }: { part: ToolPart }) {
  const input = part.state.input as Input | undefined
  let body = null
  if (part.state.status === "completed") {
    body = (
      <div className="space-y-1">
        {input?.numResults ? <KV k="count" v={String(input.numResults)} /> : null}
        <Pre>{part.state.output}</Pre>
      </div>
    )
  } else if (part.state.status === "error") {
    body = <ErrorBlock error={part.state.error} />
  }
  return <BaseCard label="WebSearch" state={part.state} subtitle={input?.query ?? "(query)"} body={body} />
}

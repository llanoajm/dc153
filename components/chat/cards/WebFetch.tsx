"use client"

import type { ToolPart } from "./types"
import { BaseCard, ErrorBlock, KV, Pre } from "./Base"

interface Input {
  url?: string
  format?: string
  prompt?: string
}

export function WebFetchCard({ part }: { part: ToolPart }) {
  const input = part.state.input as Input | undefined
  const url = input?.url ?? "(url)"
  let body = null
  if (part.state.status === "completed") {
    body = (
      <div className="space-y-1">
        {input?.format ? <KV k="format" v={input.format} /> : null}
        {input?.prompt ? <KV k="prompt" v={input.prompt} /> : null}
        <Pre>{part.state.output}</Pre>
      </div>
    )
  } else if (part.state.status === "error") {
    body = <ErrorBlock error={part.state.error} />
  }
  return <BaseCard label="WebFetch" state={part.state} subtitle={url} body={body} />
}

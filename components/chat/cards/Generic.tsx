"use client"

import type { ToolPart } from "./types"
import { BaseCard, ErrorBlock, Pre } from "./Base"

export function GenericToolCard({ part }: { part: ToolPart }) {
  const input = part.state.input

  let body = null
  if (part.state.status === "completed") {
    body = (
      <div className="space-y-1">
        {input && Object.keys(input).length > 0 ? <Pre>{JSON.stringify(input, null, 2)}</Pre> : null}
        <Pre>{part.state.output}</Pre>
      </div>
    )
  } else if (part.state.status === "error") {
    body = (
      <div className="space-y-1">
        {input && Object.keys(input).length > 0 ? <Pre>{JSON.stringify(input, null, 2)}</Pre> : null}
        <ErrorBlock error={part.state.error} />
      </div>
    )
  } else if (input && Object.keys(input).length > 0) {
    body = <Pre>{JSON.stringify(input, null, 2)}</Pre>
  }

  const title =
    (part.state.status === "completed" || part.state.status === "running") && part.state.title
      ? part.state.title
      : undefined

  return <BaseCard label={part.tool} state={part.state} subtitle={title} body={body} />
}

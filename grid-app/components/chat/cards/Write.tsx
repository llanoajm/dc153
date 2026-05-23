"use client"

import type { ToolPart } from "./types"
import { BaseCard, ErrorBlock, Pre } from "./Base"

interface Input {
  filePath?: string
  content?: string
}

export function WriteCard({ part }: { part: ToolPart }) {
  const input = part.state.input as Input | undefined
  const filePath = input?.filePath ?? "(file)"

  let body = null
  if (input?.content !== undefined) {
    body = <Pre>{input.content}</Pre>
  }
  if (part.state.status === "error") {
    body = (
      <>
        {body}
        <ErrorBlock error={part.state.error} />
      </>
    )
  }

  return <BaseCard label="Write" state={part.state} subtitle={filePath} body={body} />
}

"use client"

import type { ToolPart } from "./types"
import { BaseCard, ErrorBlock, KV, Pre } from "./Base"

interface Input {
  pattern?: string
  path?: string
}

export function GlobCard({ part }: { part: ToolPart }) {
  const input = part.state.input as Input | undefined
  const subtitle = (
    <>
      <span className="text-black/80">{input?.pattern ?? "(pattern)"}</span>
      {input?.path ? <span className="text-black/40"> in {input.path}</span> : null}
    </>
  )

  let body = null
  if (part.state.status === "completed") {
    body = (
      <div className="space-y-1">
        {input?.path ? <KV k="path" v={input.path} /> : null}
        <Pre>{part.state.output || "(no matches)"}</Pre>
      </div>
    )
  } else if (part.state.status === "error") {
    body = <ErrorBlock error={part.state.error} />
  }

  return <BaseCard label="Glob" state={part.state} subtitle={subtitle} body={body} />
}

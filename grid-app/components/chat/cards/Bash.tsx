"use client"

import type { ToolPart } from "./types"
import { BaseCard, ErrorBlock, KV, Pre } from "./Base"

interface Input {
  command?: string
  description?: string
  workdir?: string
  timeout?: number
}

interface BashMetadata {
  exit?: number
  stderr?: string
  stdout?: string
}

export function BashCard({ part }: { part: ToolPart }) {
  const input = part.state.input as Input | undefined
  const meta = (part.state.status === "completed" ? part.state.metadata : undefined) as BashMetadata | undefined
  const cmd = input?.command ?? "(command)"

  let body = null
  if (part.state.status === "completed") {
    body = (
      <div className="space-y-1">
        {input?.description ? <KV k="why" v={input.description} /> : null}
        {input?.workdir ? <KV k="cwd" v={input.workdir} /> : null}
        {meta?.exit !== undefined ? <KV k="exit" v={String(meta.exit)} /> : null}
        <Pre>{part.state.output || "(no output)"}</Pre>
      </div>
    )
  } else if (part.state.status === "error") {
    body = (
      <div className="space-y-1">
        {input?.description ? <KV k="why" v={input.description} /> : null}
        <ErrorBlock error={part.state.error} />
      </div>
    )
  } else if (input?.description) {
    body = <KV k="why" v={input.description} />
  }

  return <BaseCard label="Bash" state={part.state} subtitle={cmd} body={body} />
}

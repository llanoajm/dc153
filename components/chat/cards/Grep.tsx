"use client"

import type { ToolPart } from "./types"
import { BaseCard, ErrorBlock, KV, Pre } from "./Base"

interface Input {
  pattern?: string
  path?: string
  glob?: string
  type?: string
  output_mode?: string
  "-i"?: boolean
  multiline?: boolean
}

export function GrepCard({ part }: { part: ToolPart }) {
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
        {input?.glob ? <KV k="glob" v={input.glob} /> : null}
        {input?.type ? <KV k="type" v={input.type} /> : null}
        {input?.output_mode ? <KV k="mode" v={input.output_mode} /> : null}
        <Pre>{part.state.output || "(no matches)"}</Pre>
      </div>
    )
  } else if (part.state.status === "error") {
    body = <ErrorBlock error={part.state.error} />
  }

  return <BaseCard label="Grep" state={part.state} subtitle={subtitle} body={body} />
}

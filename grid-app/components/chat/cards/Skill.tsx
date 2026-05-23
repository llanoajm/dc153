"use client"

import type { ToolPart } from "./types"
import { BaseCard, ErrorBlock, Pre } from "./Base"

interface Input {
  name?: string
  // Custom skill invocations sometimes carry an args object.
  args?: Record<string, unknown>
}

export function SkillCard({ part }: { part: ToolPart }) {
  const input = part.state.input as Input | undefined
  const name = input?.name ?? "(skill)"

  let body = null
  if (part.state.status === "completed") {
    body = (
      <div className="space-y-1">
        {input?.args ? <Pre>{JSON.stringify(input.args, null, 2)}</Pre> : null}
        <Pre>{part.state.output}</Pre>
      </div>
    )
  } else if (part.state.status === "error") {
    body = <ErrorBlock error={part.state.error} />
  }

  return <BaseCard label="Skill" state={part.state} subtitle={name} body={body} />
}

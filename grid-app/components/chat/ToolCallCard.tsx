"use client"

import type { ToolPart } from "./cards/types"
import { ReadCard } from "./cards/Read"
import { EditCard } from "./cards/Edit"
import { WriteCard } from "./cards/Write"
import { BashCard } from "./cards/Bash"
import { GrepCard } from "./cards/Grep"
import { GlobCard } from "./cards/Glob"
import { WebFetchCard } from "./cards/WebFetch"
import { WebSearchCard } from "./cards/WebSearch"
import { SkillCard } from "./cards/Skill"
import { GenericToolCard } from "./cards/Generic"

// Dispatcher: opencode emits tool parts tagged with a kebab/lowercase tool
// name; the renderer picks the matching card and falls back to a generic
// JSON inspector for anything we don't have a card for yet.
export function ToolCallCard({ part }: { part: ToolPart }) {
  switch (part.tool) {
    case "read":
      return <ReadCard part={part} />
    case "edit":
      return <EditCard part={part} />
    case "write":
      return <WriteCard part={part} />
    case "bash":
      return <BashCard part={part} />
    case "grep":
      return <GrepCard part={part} />
    case "glob":
      return <GlobCard part={part} />
    case "webfetch":
      return <WebFetchCard part={part} />
    case "websearch":
      return <WebSearchCard part={part} />
    case "skill":
      return <SkillCard part={part} />
    default:
      return <GenericToolCard part={part} />
  }
}

export type { ToolPart }

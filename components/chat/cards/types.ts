// Mirror of the opencode `ToolPart` shape we care about. Kept narrow on
// purpose — the chat panel only reads the fields it renders.

export type ToolStatus = "pending" | "running" | "completed" | "error"

export interface ToolPart {
  id: string
  type: "tool"
  tool: string
  callID: string
  state: ToolState
  metadata?: Record<string, unknown>
}

export type ToolState =
  | { status: "pending"; input?: Record<string, unknown>; raw?: string }
  | { status: "running"; input?: Record<string, unknown>; title?: string; metadata?: Record<string, unknown>; time: { start: number } }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title?: string
      metadata?: Record<string, unknown>
      time: { start: number; end: number }
    }
  | { status: "error"; input?: Record<string, unknown>; error: string; metadata?: Record<string, unknown>; time: { start: number; end: number } }

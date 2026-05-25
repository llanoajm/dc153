import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ensureUserWorkspace } from "@/lib/user-workspace"
import { opencodeFetch } from "@/lib/opencode-transport"

// Event types we forward to the client. Anything emitted by the opencode
// server for *this* workspace that doesn't carry a sessionID matching the
// request is dropped before it reaches the browser.
const SESSION_SCOPED = new Set([
  "message.updated",
  "message.removed",
  "message.part.updated",
  "message.part.delta",
  "message.part.removed",
  "session.idle",
  "session.status",
  "session.error",
  "session.updated",
  "permission.asked",
  "permission.replied",
])

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id: sessionId } = await params
  const workspaceDir = await ensureUserWorkspace(user.id)

  const upstream = await opencodeFetch(
    user.id,
    workspaceDir,
    `/event?directory=${encodeURIComponent(workspaceDir)}`,
    {
      headers: { accept: "text/event-stream" },
      signal: request.signal,
    },
  )
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `upstream event stream failed: ${upstream.status}` },
      { status: 502 },
    )
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const reader = upstream.body.getReader()

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = ""
      // Heartbeat so intermediaries don't close the connection during long
      // tool calls. SSE comments (lines starting with `:`) are ignored by
      // EventSource.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`))
        } catch {
          clearInterval(heartbeat)
        }
      }, 15_000)

      const close = () => {
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {}
        try {
          reader.cancel()
        } catch {}
      }

      request.signal.addEventListener("abort", close)

      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // SSE messages are delimited by a blank line.
          let idx: number
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            forward(raw, sessionId, controller, encoder)
          }
        }
      } catch (err) {
        // Surface the failure to the client as a synthetic SSE event so the
        // page can show a banner rather than silently stalling.
        try {
          const msg = err instanceof Error ? err.message : String(err)
          controller.enqueue(
            encoder.encode(
              `event: proxy.error\ndata: ${JSON.stringify({ error: msg })}\n\n`,
            ),
          )
        } catch {}
      } finally {
        close()
      }
    },
    cancel() {
      try {
        reader.cancel()
      } catch {}
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}

function forward(
  raw: string,
  sessionId: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
) {
  // An SSE message is one or more `field: value` lines. The opencode server
  // emits only `data: <json>` events; we still parse defensively in case it
  // adds `event:` / `id:` lines later.
  const dataLines: string[] = []
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return
  const data = dataLines.join("\n")
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return
  }
  if (!isSessionEvent(parsed, sessionId)) return
  controller.enqueue(encoder.encode(`data: ${data}\n\n`))
}

function isSessionEvent(ev: unknown, sessionId: string): boolean {
  if (!ev || typeof ev !== "object") return false
  const e = ev as { type?: unknown; properties?: { sessionID?: unknown } }
  if (typeof e.type !== "string") return false
  if (!SESSION_SCOPED.has(e.type)) return false
  return e.properties?.sessionID === sessionId
}

export const dynamic = "force-dynamic"
export const maxDuration = 600

import "server-only"
import { ensureUserWorkspace } from "@/lib/user-workspace"

const OC_URL = process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096"

function userHeaders(workspaceDir: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-opencode-directory": workspaceDir,
  }
}

export async function createSession(userId: string): Promise<{ id: string; directory: string }> {
  const dir = await ensureUserWorkspace(userId)
  const res = await fetch(`${OC_URL}/session`, {
    method: "POST",
    headers: userHeaders(dir),
    body: "{}",
  })
  if (!res.ok) throw new Error(`createSession failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return { id: data.id, directory: dir }
}

export async function getMessages(userId: string, sessionId: string) {
  const dir = await ensureUserWorkspace(userId)
  const res = await fetch(`${OC_URL}/session/${sessionId}/message`, {
    headers: userHeaders(dir),
  })
  if (!res.ok) throw new Error(`getMessages failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function sendPrompt(
  userId: string,
  sessionId: string,
  text: string,
  opts: { agent?: string; providerID?: string; modelID?: string } = {},
) {
  const dir = await ensureUserWorkspace(userId)
  const body = {
    agent: opts.agent ?? "grid-engineer",
    model: {
      providerID: opts.providerID ?? "openrouter",
      modelID: opts.modelID ?? "~anthropic/claude-sonnet-latest",
    },
    parts: [{ type: "text", text }],
  }
  const res = await fetch(`${OC_URL}/session/${sessionId}/message`, {
    method: "POST",
    headers: userHeaders(dir),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`sendPrompt failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function abortSession(userId: string, sessionId: string) {
  const dir = await ensureUserWorkspace(userId)
  const res = await fetch(`${OC_URL}/session/${sessionId}/abort`, {
    method: "POST",
    headers: userHeaders(dir),
  })
  return res.ok
}

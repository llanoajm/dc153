import "server-only"
import { ensureUserWorkspace } from "@/lib/user-workspace"

// Fronted endpoint provisioned by scripts/opencode-proxy.ts (HARDENING §1.2).
// Default points at the bearer-auth proxy on 4097, not raw opencode on 4096 —
// raw 4096 is shell-level admin and must never be reached from app code.
export const OPENCODE_BASE_URL =
  process.env.STEINMETZ_OPENCODE_URL || "http://127.0.0.1:4097"

const OPENCODE_TOKEN = process.env.STEINMETZ_OPENCODE_TOKEN || ""

export function opencodeHeaders(workspaceDir?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (workspaceDir) headers["x-opencode-directory"] = workspaceDir
  if (OPENCODE_TOKEN) headers["authorization"] = `Bearer ${OPENCODE_TOKEN}`
  return headers
}

function userHeaders(workspaceDir: string): HeadersInit {
  return opencodeHeaders(workspaceDir)
}

export async function createSession(userId: string): Promise<{ id: string; directory: string }> {
  const dir = await ensureUserWorkspace(userId)
  const res = await fetch(`${OPENCODE_BASE_URL}/session`, {
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
  const res = await fetch(`${OPENCODE_BASE_URL}/session/${sessionId}/message`, {
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
  const res = await fetch(`${OPENCODE_BASE_URL}/session/${sessionId}/message`, {
    method: "POST",
    headers: userHeaders(dir),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`sendPrompt failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function abortSession(userId: string, sessionId: string) {
  const dir = await ensureUserWorkspace(userId)
  const res = await fetch(`${OPENCODE_BASE_URL}/session/${sessionId}/abort`, {
    method: "POST",
    headers: userHeaders(dir),
  })
  return res.ok
}

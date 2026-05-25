import "server-only"
import { ensureUserWorkspace, writeUserProviderConfig } from "@/lib/user-workspace"
import { getUserProviderKeysMap } from "@/lib/provider-keys"
import {
  opencodeFetch,
  opencodeHeadersForTarget,
  opencodeTargetFor,
  perUserOpencodeEnabled,
} from "@/lib/opencode-transport"

// HARDENING §1.2 — TCP transport defaults to the bearer-auth fronting proxy
// on 4097, not raw opencode on 4096. raw 4096 is shell-level admin and must
// never be reached from app code.
//
// HARDENING §3.2 — when STEINMETZ_PER_USER_OPENCODE=1 the request routes to
// /run/steinmetz/<short-uid>.sock instead (one opencode unit per user). The
// transport selection lives in lib/opencode-transport.ts; this module is just
// the typed-call layer that grid-app uses.
export const OPENCODE_BASE_URL =
  process.env.STEINMETZ_OPENCODE_URL || "http://127.0.0.1:4097"

// Back-compat: callers (the SSE proxy route) used to import opencodeHeaders().
// The single-user TCP shape is still valid when per-user mode is off; in
// per-user mode the header set is computed inside opencodeFetch() per request.
export function opencodeHeaders(workspaceDir?: string): Record<string, string> {
  // We can compute headers without a user id only in TCP mode (the bearer
  // token is shared). In socket mode there's no useful "user-less" header
  // set — return the workspace-directory header and let the caller add the
  // rest via opencodeFetch.
  const target = perUserOpencodeEnabled()
    ? { kind: "socket" as const, socketPath: "" }
    : opencodeTargetFor("__shared__")
  return opencodeHeadersForTarget(target, workspaceDir)
}

// Refresh the per-user provider key block in the workspace's opencode.jsonc
// so the next opencode request bills against the user's own OpenRouter key
// (HARDENING §1.4). opencode loads workspace-local `provider:` per request
// and merges its `options.apiKey` over the env/auth key. When the user has
// no per-user key set, we write an empty provider block, which transparently
// falls back to the shared env key. Best-effort: a DB hiccup here must not
// block the session call from going out.
async function refreshProviderConfig(userId: string, dir: string): Promise<void> {
  try {
    const keys = await getUserProviderKeysMap(userId)
    await writeUserProviderConfig(dir, keys)
  } catch (e) {
    console.warn(`refreshProviderConfig failed for user=${userId}:`, e)
  }
}

export async function createSession(userId: string): Promise<{ id: string; directory: string }> {
  const dir = await ensureUserWorkspace(userId)
  await refreshProviderConfig(userId, dir)
  const res = await opencodeFetch(userId, dir, "/session", {
    method: "POST",
    body: "{}",
  })
  if (!res.ok) throw new Error(`createSession failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return { id: data.id, directory: dir }
}

export async function getMessages(userId: string, sessionId: string) {
  const dir = await ensureUserWorkspace(userId)
  const res = await opencodeFetch(userId, dir, `/session/${sessionId}/message`)
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
  await refreshProviderConfig(userId, dir)
  const body = {
    agent: opts.agent ?? "grid-engineer",
    model: {
      providerID: opts.providerID ?? "openrouter",
      modelID: opts.modelID ?? "~anthropic/claude-sonnet-latest",
    },
    parts: [{ type: "text", text }],
  }
  const res = await opencodeFetch(userId, dir, `/session/${sessionId}/message`, {
    method: "POST",
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`sendPrompt failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function abortSession(userId: string, sessionId: string) {
  const dir = await ensureUserWorkspace(userId)
  const res = await opencodeFetch(userId, dir, `/session/${sessionId}/abort`, {
    method: "POST",
  })
  return res.ok
}

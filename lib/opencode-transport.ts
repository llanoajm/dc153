import "server-only"
import http from "node:http"
import path from "node:path"
import { Readable } from "node:stream"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import { shortUidFor } from "@/lib/linux-account"
import { sanitizeBearerTokenEnv } from "@/lib/bearer-token-validation"

// HARDENING §3.2 — per-user opencode transport.
//
// Two transports, selected by STEINMETZ_PER_USER_OPENCODE:
//
//   off (default): TCP via the §1.2 bearer-auth fronting proxy on
//     http://127.0.0.1:4097. Single shared opencode for the whole VM.
//
//   on:            Unix socket at /run/steinmetz/<short-uid>.sock, one
//     opencode unit per user. grid-app's `agent` user is in the
//     `steinmetz` group, so it can connect to the 0660 socket directly.
//     The socket's filesystem perms are the auth layer — no bearer token
//     needed on-the-wire. Before the first request of a session we issue
//     `sudo systemctl start steinmetz-opencode@<short-uid>` (idempotent;
//     no-op if already active) and wait briefly for the socket file to
//     appear.

const execFileP = promisify(execFile)

const PER_USER_ENABLED = process.env.STEINMETZ_PER_USER_OPENCODE === "1"
const RUN_DIR = process.env.STEINMETZ_OPENCODE_RUN_DIR ?? "/run/steinmetz"
const SOCKET_WAIT_MS = Math.max(
  500,
  Number(process.env.STEINMETZ_OPENCODE_SOCKET_WAIT_MS ?? 15_000),
)

const FALLBACK_HTTP_URL =
  process.env.STEINMETZ_OPENCODE_URL || "http://127.0.0.1:4097"
const FALLBACK_TOKEN = sanitizeBearerTokenEnv("STEINMETZ_OPENCODE_TOKEN") ?? ""

export interface OpencodeTarget {
  kind: "http" | "socket"
  baseUrl?: string
  socketPath?: string
  bearerToken?: string
}

export function perUserOpencodeEnabled(): boolean {
  return PER_USER_ENABLED
}

export function socketPathForUser(supabaseUid: string): string {
  return path.join(RUN_DIR, `${shortUidFor(supabaseUid)}.sock`)
}

export function opencodeTargetFor(supabaseUid: string): OpencodeTarget {
  if (PER_USER_ENABLED) {
    return { kind: "socket", socketPath: socketPathForUser(supabaseUid) }
  }
  return {
    kind: "http",
    baseUrl: FALLBACK_HTTP_URL,
    bearerToken: FALLBACK_TOKEN,
  }
}

export function opencodeHeadersForTarget(
  target: OpencodeTarget,
  workspaceDir?: string,
): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" }
  if (workspaceDir) h["x-opencode-directory"] = workspaceDir
  if (target.kind === "http" && target.bearerToken) {
    h["authorization"] = `Bearer ${target.bearerToken}`
  }
  return h
}

// Start the per-user systemd unit on demand and wait for its socket. No-op
// when per-user mode is off (the shared opencode is brought up by AGENTS.md
// Quick start). Fails soft on missing sudo / disabled mode — that surfaces
// as a 502 on the next opencode request rather than a hard crash.
export async function ensurePerUserOpencode(supabaseUid: string): Promise<void> {
  if (!PER_USER_ENABLED) return
  const short = shortUidFor(supabaseUid)
  const sockPath = path.join(RUN_DIR, `${short}.sock`)
  if (await socketExists(sockPath)) return

  try {
    await execFileP("sudo", [
      "-n",
      "/usr/bin/systemctl",
      "start",
      `steinmetz-opencode@${short}.service`,
    ])
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string }
    console.warn(
      `[hardening 3.2] systemctl start steinmetz-opencode@${short} failed (code=${e.code}); will still wait for socket in case it's coming up:`,
      typeof e.stderr === "string" ? e.stderr : String(err),
    )
  }

  await waitForSocket(sockPath, SOCKET_WAIT_MS)
}

async function socketExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p)
    return st.isSocket()
  } catch {
    return false
  }
}

async function waitForSocket(p: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await socketExists(p)) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(
    `per-user opencode socket did not appear at ${p} within ${Math.round(timeoutMs / 1000)}s`,
  )
}

// fetch-shaped wrapper that picks the transport per user. Returns a real
// `Response` so the existing call sites (json/text/body.getReader) work
// unchanged. For TCP we delegate to the global fetch; for Unix sockets we
// drive node:http and wrap the IncomingMessage into a Response.
export async function opencodeFetch(
  supabaseUid: string,
  workspaceDir: string | undefined,
  urlPath: string,
  init: RequestInit & { ensureUp?: boolean } = {},
): Promise<Response> {
  if (init.ensureUp !== false) await ensurePerUserOpencode(supabaseUid)
  const target = opencodeTargetFor(supabaseUid)
  const headers = mergeHeaders(opencodeHeadersForTarget(target, workspaceDir), init.headers)
  const { ensureUp: _ignored, ...rest } = init
  void _ignored
  if (target.kind === "http") {
    return fetch(`${target.baseUrl}${urlPath}`, { ...rest, headers })
  }
  return socketFetch(target.socketPath!, urlPath, { ...rest, headers })
}

function mergeHeaders(
  base: Record<string, string>,
  extra: HeadersInit | undefined,
): Record<string, string> {
  const out = { ...base }
  if (!extra) return out
  if (extra instanceof Headers) {
    extra.forEach((v, k) => {
      out[k] = v
    })
    return out
  }
  if (Array.isArray(extra)) {
    for (const [k, v] of extra) out[k] = v
    return out
  }
  return { ...out, ...extra }
}

async function socketFetch(
  socketPath: string,
  urlPath: string,
  init: RequestInit,
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase()
  const headers = headersInitToRecord(init.headers)
  const bodyBuf = await bodyToBuffer(init.body)
  if (bodyBuf && headers["content-length"] === undefined) {
    headers["content-length"] = String(bodyBuf.byteLength)
  }
  return new Promise<Response>((resolve, reject) => {
    const cReq = http.request(
      {
        socketPath,
        method,
        path: urlPath,
        headers,
      },
      (cRes) => {
        const responseHeaders = new Headers()
        for (const [k, v] of Object.entries(cRes.headers)) {
          if (Array.isArray(v)) v.forEach((x) => responseHeaders.append(k, x))
          else if (v != null) responseHeaders.set(k, String(v))
        }
        const status = cRes.statusCode ?? 502
        // Status code 204 etc. legitimately have no body; Response constructor
        // rejects a body for those. Otherwise we stream via Readable.toWeb so
        // the SSE path can read incrementally.
        const noBody = status === 204 || status === 205 || status === 304
        const body = noBody
          ? null
          : (Readable.toWeb(cRes) as unknown as ReadableStream<Uint8Array>)
        resolve(
          new Response(body, {
            status,
            statusText: cRes.statusMessage ?? "",
            headers: responseHeaders,
          }),
        )
      },
    )
    cReq.on("error", reject)
    if (init.signal) {
      if (init.signal.aborted) {
        cReq.destroy(new Error("aborted"))
        reject(new DOMException("Aborted", "AbortError"))
        return
      }
      init.signal.addEventListener("abort", () => {
        cReq.destroy(new Error("aborted"))
      })
    }
    if (bodyBuf) cReq.write(bodyBuf)
    cReq.end()
  })
}

function headersInitToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k] = v
    })
    return out
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k] = v
    return out
  }
  for (const [k, v] of Object.entries(h)) out[k] = String(v)
  return out
}

async function bodyToBuffer(body: BodyInit | null | undefined): Promise<Buffer | null> {
  if (body == null) return null
  if (typeof body === "string") return Buffer.from(body, "utf8")
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  // Blob / FormData / ReadableStream — opencode's API only takes JSON, so
  // we don't bother. Surface loudly if someone tries.
  throw new Error(
    "opencode-transport: unsupported body type for Unix-socket transport (use string / Buffer / Uint8Array)",
  )
}

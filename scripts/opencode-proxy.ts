#!/usr/bin/env bun
// Bearer-auth fronting proxy for the opencode HTTP server.
//
// opencode binds 127.0.0.1:4096 with no auth — anyone with shell on the VM has
// session takeover for every other user's chat. This sidecar requires
//   Authorization: Bearer $STEINMETZ_OPENCODE_TOKEN
// on every request and forwards to upstream. SSE responses (the /event stream)
// pass through unbuffered.
//
// Run:
//   STEINMETZ_OPENCODE_TOKEN='<long-random>' \
//     ~/.bun/bin/bun run /home/agent/grid-app/scripts/opencode-proxy.ts \
//     > /tmp/oc-proxy.log 2>&1 & disown
//
// Env:
//   STEINMETZ_OPENCODE_TOKEN         (required) bearer secret clients must send
//   STEINMETZ_OPENCODE_PROXY_PORT    default 4097
//   STEINMETZ_OPENCODE_PROXY_HOST    default 127.0.0.1
//   OPENCODE_UPSTREAM_URL            default http://127.0.0.1:4096
//   STEINMETZ_PER_USER_OPENCODE      "1" routes per-request to a Unix socket
//                                    at /run/steinmetz/<short>.sock based on
//                                    an X-Steinmetz-Short-Uid request header.
//                                    Used for external clients (curl/debug);
//                                    grid-app talks to sockets directly via
//                                    lib/opencode-transport.ts.
//   STEINMETZ_OPENCODE_RUN_DIR       default /run/steinmetz
//
// HARDENING_ROADMAP.md §1.2 — Phase 1 hardening, do not skip before user #2.
// HARDENING_ROADMAP.md §3.2 — per-user routing (opt-in via the env flag).

const TOKEN = process.env.STEINMETZ_OPENCODE_TOKEN
const PORT = Number(process.env.STEINMETZ_OPENCODE_PROXY_PORT ?? 4097)
const HOSTNAME = process.env.STEINMETZ_OPENCODE_PROXY_HOST ?? "127.0.0.1"
const UPSTREAM = (process.env.OPENCODE_UPSTREAM_URL ?? "http://127.0.0.1:4096").replace(/\/$/, "")
const PER_USER = process.env.STEINMETZ_PER_USER_OPENCODE === "1"
const RUN_DIR = process.env.STEINMETZ_OPENCODE_RUN_DIR ?? "/run/steinmetz"
const SHORT_UID_HEADER = "x-steinmetz-short-uid"
const SHORT_UID_RE = /^[0-9a-f]{4,32}$/

if (!TOKEN) {
  console.error("opencode-proxy: STEINMETZ_OPENCODE_TOKEN is required (see HARDENING_ROADMAP.md §1.2)")
  process.exit(1)
}
if (TOKEN.length < 16) {
  console.error("opencode-proxy: STEINMETZ_OPENCODE_TOKEN must be at least 16 chars")
  process.exit(1)
}

const EXPECTED_AUTH = `Bearer ${TOKEN}`

// Hop-by-hop headers per RFC 7230; never forwarded.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
])

function filterHeaders(src: Headers, extraDrop: string[] = []): Headers {
  const out = new Headers()
  const skip = new Set([...HOP_BY_HOP, ...extraDrop.map((h) => h.toLowerCase())])
  src.forEach((value, key) => {
    if (!skip.has(key.toLowerCase())) out.set(key, value)
  })
  return out
}

// Constant-time string compare so a timing-leak attacker can't peel off the
// token byte-by-byte. JS doesn't expose `crypto.timingSafeEqual` for strings;
// we walk both strings to the length of the longer one.
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  idleTimeout: 0, // SSE streams can sit idle between events; don't reap them.
  async fetch(req: Request): Promise<Response> {
    const auth = req.headers.get("authorization") ?? ""
    if (!timingSafeEqual(auth, EXPECTED_AUTH)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": "Bearer",
        },
      })
    }

    const inbound = new URL(req.url)
    const method = req.method.toUpperCase()
    const hasBody = method !== "GET" && method !== "HEAD"

    // Per-user mode: route to /run/steinmetz/<short>.sock based on the
    // X-Steinmetz-Short-Uid header. Reject requests without it so we never
    // accidentally fan a per-user-scope call out to the shared upstream.
    let upstreamUrl: string
    const init: RequestInit & { duplex?: "half"; unix?: string } = {
      method,
      headers: filterHeaders(req.headers, ["authorization", SHORT_UID_HEADER]),
      body: hasBody ? req.body : undefined,
      redirect: "manual",
    }
    if (hasBody) init.duplex = "half"

    if (PER_USER) {
      const short = (req.headers.get(SHORT_UID_HEADER) ?? "").trim().toLowerCase()
      if (!SHORT_UID_RE.test(short)) {
        return new Response(
          JSON.stringify({ error: `per-user mode requires ${SHORT_UID_HEADER} header (hex 4-32 chars)` }),
          { status: 400, headers: { "content-type": "application/json" } },
        )
      }
      // Bun.fetch honours the `unix` option to dial a Unix socket. The URL's
      // host is ignored when unix is set; we still pass the path/search.
      upstreamUrl = `http://unix${inbound.pathname}${inbound.search}`
      init.unix = `${RUN_DIR}/${short}.sock`
    } else {
      upstreamUrl = `${UPSTREAM}${inbound.pathname}${inbound.search}`
    }

    let upstream: Response
    try {
      upstream = await fetch(upstreamUrl, init as RequestInit)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return new Response(JSON.stringify({ error: `upstream: ${msg}` }), {
        status: 502,
        headers: { "content-type": "application/json" },
      })
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: filterHeaders(upstream.headers),
    })
  },
  error(err: Error) {
    console.error("opencode-proxy:", err)
    return new Response("internal error", { status: 500 })
  },
})

const routing = PER_USER
  ? `per-user (sockets under ${RUN_DIR}/<short>.sock)`
  : UPSTREAM
console.log(
  `opencode-proxy listening on http://${HOSTNAME}:${PORT} → ${routing} (token len=${TOKEN.length})`,
)

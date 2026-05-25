#!/usr/bin/env bun
// Per-user opencode supervisor (HARDENING_ROADMAP §3.2).
//
// Spawned by the systemd template `steinmetz-opencode@<short-uid>.service`
// as `User=steinmetz-<short-uid>:steinmetz`. Does two jobs in one process:
//
//   1. Boots the opencode HTTP server (our fork at /home/agent/opencode)
//      bound to 127.0.0.1:<deterministic-port>. Port is derived from the
//      short-uid so it survives restarts and is collision-resistant inside
//      a single VM. Loopback-only — never reachable from outside this unit.
//
//   2. Listens on a Unix socket at /run/steinmetz/<short-uid>.sock (mode
//      0660, owner steinmetz-<short-uid>, group steinmetz) and pipes
//      bytes to/from the local TCP port. grid-app (running as `agent`,
//      supplementary group steinmetz) connects to that socket. Filesystem
//      permissions are the auth layer — no bearer token needed.
//
// Idle eviction is honest-broker: any socket connection refreshes a
// timestamp; if no connection arrives for STEINMETZ_OPENCODE_IDLE_TIMEOUT
// seconds the supervisor exits 0. systemd (Restart=on-failure) leaves the
// unit stopped; the next session-create call from grid-app re-issues
// `systemctl start` and the unit boots back up.
//
// Env (mostly set by the systemd template):
//   STEINMETZ_SHORT_UID                 required; per-user short-uid
//   STEINMETZ_OPENCODE_FORK             default /home/agent/opencode
//   STEINMETZ_OPENCODE_RUN_DIR          default /run/steinmetz
//   STEINMETZ_OPENCODE_IDLE_TIMEOUT     default 1800 (seconds; 0 disables)
//   STEINMETZ_OPENCODE_PORT_BASE        default 41000
//   STEINMETZ_OPENCODE_PORT_RANGE       default 20000
//   STEINMETZ_OPENCODE_BOOT_TIMEOUT     default 30 (seconds)
//   OPENROUTER_API_KEY                  pass-through (fallback billing)

import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"

const SHORT = process.env.STEINMETZ_SHORT_UID
if (!SHORT || !/^[0-9a-f]{4,32}$/.test(SHORT)) {
  console.error(
    `per-user-opencode: STEINMETZ_SHORT_UID must be a 4-32 char hex string (got: ${SHORT ?? "<unset>"}).`,
  )
  process.exit(2)
}

const FORK = process.env.STEINMETZ_OPENCODE_FORK ?? "/home/agent/opencode"
const RUN_DIR = process.env.STEINMETZ_OPENCODE_RUN_DIR ?? "/run/steinmetz"
const SOCKET_PATH = path.join(RUN_DIR, `${SHORT}.sock`)
const IDLE_TIMEOUT_SEC = Math.max(0, Number(process.env.STEINMETZ_OPENCODE_IDLE_TIMEOUT ?? 1800))
const PORT_BASE = Number(process.env.STEINMETZ_OPENCODE_PORT_BASE ?? 41000)
const PORT_RANGE = Math.max(1, Number(process.env.STEINMETZ_OPENCODE_PORT_RANGE ?? 20000))
const BOOT_TIMEOUT_MS = Math.max(1, Number(process.env.STEINMETZ_OPENCODE_BOOT_TIMEOUT ?? 30)) * 1000

function portForShort(short: string): number {
  const hash = crypto.createHash("sha256").update(short).digest()
  const n = hash.readUInt32BE(0)
  return PORT_BASE + (n % PORT_RANGE)
}

const PORT = portForShort(SHORT)
let lastActivity = Date.now()
let shuttingDown = false

console.log(`per-user-opencode[${SHORT}]: starting; port=${PORT} socket=${SOCKET_PATH} idle=${IDLE_TIMEOUT_SEC}s`)

// 1. Spawn opencode as a child. `bun dev serve` is what the existing
//    single-user opencode invocation uses (see grid-app/AGENTS.md Quick start).
const child = Bun.spawn({
  cmd: ["bun", "dev", "serve", "--hostname", "127.0.0.1", "--port", String(PORT)],
  cwd: FORK,
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    OPENCODE_AUTO_UPDATE: "false",
  },
})

// 2. Poll the TCP port until opencode is ready, then bind the Unix socket.
async function waitForUpstream(): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (shuttingDown) throw new Error("supervisor shutting down before upstream came up")
    const ok = await new Promise<boolean>((resolve) => {
      const probe = net.connect(PORT, "127.0.0.1")
      probe.once("connect", () => {
        probe.end()
        resolve(true)
      })
      probe.once("error", () => resolve(false))
    })
    if (ok) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`opencode did not bind 127.0.0.1:${PORT} within ${BOOT_TIMEOUT_MS / 1000}s`)
}

try {
  await waitForUpstream()
} catch (err) {
  console.error(`per-user-opencode[${SHORT}]:`, err instanceof Error ? err.message : err)
  shutdown(2)
  process.exit(2)
}

// 3. Remove any stale socket from a previous crash, then bind fresh.
try {
  fs.unlinkSync(SOCKET_PATH)
} catch {}

const server = net.createServer({ allowHalfOpen: true }, (clientSock) => {
  lastActivity = Date.now()
  const upstreamSock = net.connect(PORT, "127.0.0.1")
  const refresh = () => {
    lastActivity = Date.now()
  }
  clientSock.on("data", refresh)
  upstreamSock.on("data", refresh)
  clientSock.pipe(upstreamSock).pipe(clientSock)
  const cleanup = () => {
    try {
      clientSock.destroy()
    } catch {}
    try {
      upstreamSock.destroy()
    } catch {}
  }
  clientSock.on("error", cleanup)
  upstreamSock.on("error", cleanup)
  clientSock.on("close", cleanup)
  upstreamSock.on("close", cleanup)
})

server.on("error", (err) => {
  console.error(`per-user-opencode[${SHORT}]: socket server error:`, err)
  shutdown(1)
})

server.listen(SOCKET_PATH, () => {
  // RuntimeDirectory + RuntimeDirectoryMode + Group on the systemd unit make
  // /run/steinmetz/ root:steinmetz 0750, so a socket created inside inherits
  // the group. An explicit chmod is a safety net in case the unit env drifts.
  try {
    fs.chmodSync(SOCKET_PATH, 0o660)
  } catch (e) {
    console.warn(`per-user-opencode[${SHORT}]: chmod 0660 on ${SOCKET_PATH} failed:`, e)
  }
  console.log(`per-user-opencode[${SHORT}]: socket listening at ${SOCKET_PATH}`)
})

// 4. Idle watcher.
if (IDLE_TIMEOUT_SEC > 0) {
  const tick = setInterval(() => {
    if (shuttingDown) return
    const idleMs = Date.now() - lastActivity
    if (idleMs >= IDLE_TIMEOUT_SEC * 1000) {
      console.log(
        `per-user-opencode[${SHORT}]: idle ${Math.round(idleMs / 1000)}s >= ${IDLE_TIMEOUT_SEC}s; shutting down.`,
      )
      clearInterval(tick)
      shutdown(0)
    }
  }, 60_000).unref()
}

// 5. Lifecycle: if opencode dies, we die.
child.exited.then((code) => {
  console.log(`per-user-opencode[${SHORT}]: opencode child exited code=${code}; shutting down.`)
  shutdown(code ?? 1)
})

function shutdown(code: number): void {
  if (shuttingDown) return
  shuttingDown = true
  try {
    server?.close()
  } catch {}
  try {
    fs.unlinkSync(SOCKET_PATH)
  } catch {}
  try {
    child.kill()
  } catch {}
  // Give the child a moment to release the port before we exit.
  setTimeout(() => process.exit(code), 200).unref()
}

process.on("SIGTERM", () => shutdown(0))
process.on("SIGINT", () => shutdown(0))

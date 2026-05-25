import { NextRequest, NextResponse } from "next/server"
import fs from "node:fs/promises"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import { createClient } from "@/lib/supabase/server"
import { serviceClient } from "@/lib/supabase/service"
import { snapshot as concurrencySnapshot } from "@/lib/concurrency"

const execAsync = promisify(exec)

// HARDENING §2.3 — admin health endpoint.
//
// Single-page JSON that surfaces the metrics we'd otherwise want a Prometheus
// stub for: process CPU, free disk on the workspace filesystem, active
// session count (= in-flight tool_runs), opencode RSS (best-effort).
//
// Auth: any authed user whose email is listed in STEINMETZ_ADMIN_EMAILS
// (comma-separated). Without that env var set, the route always returns 403
// — placeholder admin-role plumbing until /app gets a real admin surface.
//
// All values are best-effort; if a probe fails we set its value to null and
// keep the response shape stable. The route is intentionally cheap so it can
// be polled from a watcher script every N seconds.

const WORKSPACE_ROOT = process.env.GRID_WORKSPACE_ROOT || "/home/agent/grid-workspaces"

function isAdmin(email: string | undefined | null): boolean {
  if (!email) return false
  const raw = process.env.STEINMETZ_ADMIN_EMAILS || ""
  const allow = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (allow.length === 0) return false
  return allow.includes(email.toLowerCase())
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (!isAdmin(user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const [cpu, disk, opencode, sessions, runs] = await Promise.all([
    readProcessCpu(),
    readDiskFree(WORKSPACE_ROOT),
    readOpencodeRss(),
    readActiveSessionCount(),
    readActiveToolRuns(),
  ])

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    workspace_root: WORKSPACE_ROOT,
    process: cpu,
    disk,
    opencode,
    sessions,
    tool_runs: runs,
    concurrency: concurrencySnapshot(),
  })
}

interface ProcessStats {
  pid: number
  uptime_seconds: number
  cpu_user_ms: number
  cpu_system_ms: number
  rss_bytes: number | null
  load_average: { one: number; five: number; fifteen: number } | null
}

async function readProcessCpu(): Promise<ProcessStats> {
  const usage = process.cpuUsage()
  const mem = process.memoryUsage()
  return {
    pid: process.pid,
    uptime_seconds: Math.round(process.uptime()),
    cpu_user_ms: Math.round(usage.user / 1000),
    cpu_system_ms: Math.round(usage.system / 1000),
    rss_bytes: mem.rss,
    load_average: await readLoadAvg(),
  }
}

async function readLoadAvg(): Promise<ProcessStats["load_average"]> {
  try {
    const raw = await fs.readFile("/proc/loadavg", "utf8")
    const parts = raw.trim().split(/\s+/)
    return {
      one: Number(parts[0]) || 0,
      five: Number(parts[1]) || 0,
      fifteen: Number(parts[2]) || 0,
    }
  } catch {
    return null
  }
}

interface DiskStats {
  filesystem: string | null
  total_bytes: number | null
  used_bytes: number | null
  free_bytes: number | null
  use_percent: number | null
  workspace_bytes: number | null
}

async function readDiskFree(target: string): Promise<DiskStats> {
  const stats: DiskStats = {
    filesystem: null,
    total_bytes: null,
    used_bytes: null,
    free_bytes: null,
    use_percent: null,
    workspace_bytes: null,
  }
  try {
    const { stdout } = await execAsync(`df -B1 -P ${shellQuote(target)}`, { timeout: 2000 })
    const lines = stdout.trim().split("\n")
    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s+/)
      stats.filesystem = parts[0] || null
      stats.total_bytes = Number(parts[1]) || null
      stats.used_bytes = Number(parts[2]) || null
      stats.free_bytes = Number(parts[3]) || null
      stats.use_percent =
        stats.used_bytes && stats.total_bytes
          ? Math.round((stats.used_bytes / stats.total_bytes) * 1000) / 10
          : null
    }
  } catch {
    // df not available or path missing — leave nulls.
  }
  try {
    // Best-effort: how much do per-user workspaces actually consume right
    // now. Capped at 2s so a slow walk doesn't pin the route.
    const { stdout } = await execAsync(`du -sb ${shellQuote(target)}`, { timeout: 2000 })
    const first = stdout.trim().split(/\s+/)[0]
    stats.workspace_bytes = Number(first) || null
  } catch {
    // Either no workspace root yet, or the walk timed out. Leave null.
  }
  return stats
}

interface OpencodeStats {
  pids: number[]
  rss_bytes: number | null
  cpu_jiffies: number | null
}

async function readOpencodeRss(): Promise<OpencodeStats> {
  const pids = await pidsByPattern(/opencode/)
  let rss = 0
  let cpu = 0
  let any = false
  for (const pid of pids) {
    try {
      const statm = await fs.readFile(`/proc/${pid}/statm`, "utf8")
      const rssPages = Number(statm.trim().split(/\s+/)[1])
      if (Number.isFinite(rssPages)) {
        rss += rssPages * 4096 // page size assumption: 4KB; matches every Linux we run on
        any = true
      }
    } catch {
      // pid exited mid-read; skip.
    }
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8")
      // /proc/<pid>/stat: utime is field 14, stime is field 15 (1-indexed),
      // but the "comm" field can contain spaces and parens so we parse from
      // the last ')'.
      const parenEnd = stat.lastIndexOf(")")
      if (parenEnd > 0) {
        const tail = stat.slice(parenEnd + 2).split(/\s+/)
        // tail[0] = state, tail[11] = utime, tail[12] = stime
        const utime = Number(tail[11]) || 0
        const stime = Number(tail[12]) || 0
        cpu += utime + stime
        any = true
      }
    } catch {
      // skip.
    }
  }
  return {
    pids,
    rss_bytes: any ? rss : null,
    cpu_jiffies: any ? cpu : null,
  }
}

async function pidsByPattern(re: RegExp): Promise<number[]> {
  const pids: number[] = []
  try {
    const entries = await fs.readdir("/proc")
    for (const name of entries) {
      if (!/^\d+$/.test(name)) continue
      const pid = Number(name)
      try {
        const cmdline = await fs.readFile(`/proc/${pid}/cmdline`, "utf8")
        // cmdline args are NUL-separated; normalize to space.
        const text = cmdline.replace(/\0/g, " ")
        if (re.test(text)) pids.push(pid)
      } catch {
        // pid exited or we can't read it; skip.
      }
    }
  } catch {
    // /proc not available (unlikely on Linux).
  }
  return pids
}

interface SessionStats {
  active_users: number
  active_runs: number
  per_user_limit: number
  global_limit: number
}

async function readActiveSessionCount(): Promise<SessionStats> {
  const snap = concurrencySnapshot()
  const users = new Set<string>()
  for (const r of snap.active) users.add(r.userId)
  return {
    active_users: users.size,
    active_runs: snap.active.length,
    per_user_limit: snap.perUserLimit,
    global_limit: snap.globalLimit,
  }
}

interface ToolRunStats {
  running: number
  recent_errors_24h: number | null
  recent_orphaned_24h: number | null
}

async function readActiveToolRuns(): Promise<ToolRunStats> {
  const stats: ToolRunStats = {
    running: 0,
    recent_errors_24h: null,
    recent_orphaned_24h: null,
  }
  try {
    const sb = serviceClient()
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [{ count: running }, { count: errors }, { count: orphaned }] = await Promise.all([
      sb.from("tool_runs").select("id", { count: "exact", head: true }).eq("status", "running"),
      sb
        .from("tool_runs")
        .select("id", { count: "exact", head: true })
        .eq("status", "error")
        .gte("started_at", since),
      sb
        .from("tool_runs")
        .select("id", { count: "exact", head: true })
        .eq("status", "orphaned")
        .gte("started_at", since),
    ])
    stats.running = running ?? 0
    stats.recent_errors_24h = errors ?? 0
    stats.recent_orphaned_24h = orphaned ?? 0
  } catch (e) {
    console.error("[admin/health] tool_runs probe failed:", e)
  }
  return stats
}

function shellQuote(s: string): string {
  // Only used for paths we control (workspace root from env). Wrap in single
  // quotes and escape any embedded ones — enough for `df` / `du`.
  if (!/[^a-zA-Z0-9_./-]/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

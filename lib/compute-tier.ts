import "server-only"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { shortUidFor } from "@/lib/linux-account"

// HARDENING §3.4 — per-user systemd resource limits.
//
// Every per-user opencode unit (§3.2) declares
// `Slice=steinmetz-<short-uid>.slice`. This module materialises the matching
// slice unit file from `infra/systemd/steinmetz-%i.slice` so the slice's
// MemoryMax / CPUQuota / IOWeight actually apply. Without the slice unit
// file systemd creates a transient slice with no caps — the opencode unit
// still starts but a runaway allocation can OOM the VM, which is exactly
// what §3.4 exists to prevent.
//
// Tier parameters are resolved from `profiles.compute_tier` (declared in
// supabase/schema.sql, nullable). Today the resolver is a hardcoded map;
// later iterations can swap in a table without touching callers.
//
// Materialisation is gated on `STEINMETZ_PER_USER_SLICES=1` so dev / CI
// environments without sudo for `install` + `systemctl daemon-reload` keep
// working. Flip the flag on in production once HARDENING §3.1 and §3.2 are
// live — slices are only useful when the opencode unit they reference is
// also being created.

const execFileP = promisify(execFile)

export interface ComputeTierParams {
  slug: string
  memoryMax: string
  cpuQuota: string
  ioWeight: string
}

// Tier table. `default` mirrors the values in
// infra/systemd/steinmetz-%i.slice so a user with no tier set ends up with
// the same limits whether `ensureUserSlice` rewrites the template body or
// passes it through unchanged. Add new tiers by appending here; the column
// is free-form text so old rows don't have to migrate.
export const COMPUTE_TIERS: Record<string, ComputeTierParams> = {
  low: { slug: "low", memoryMax: "2G", cpuQuota: "100%", ioWeight: "50" },
  default: { slug: "default", memoryMax: "4G", cpuQuota: "200%", ioWeight: "100" },
  high: { slug: "high", memoryMax: "8G", cpuQuota: "400%", ioWeight: "200" },
}

export const DEFAULT_COMPUTE_TIER = COMPUTE_TIERS.default

export function resolveComputeTier(tier?: string | null): ComputeTierParams {
  if (!tier) return DEFAULT_COMPUTE_TIER
  return COMPUTE_TIERS[tier] ?? DEFAULT_COMPUTE_TIER
}

const PER_USER_SLICES_ENABLED = process.env.STEINMETZ_PER_USER_SLICES === "1"
const SLICE_TEMPLATE_PATH =
  process.env.STEINMETZ_SLICE_TEMPLATE ||
  path.join(process.cwd(), "infra", "systemd", "steinmetz-%i.slice")
const SLICE_INSTALL_DIR =
  process.env.STEINMETZ_SLICE_INSTALL_DIR || "/etc/systemd/system"

export function perUserSlicesEnabled(): boolean {
  return PER_USER_SLICES_ENABLED
}

export function sliceUnitName(supabaseUid: string): string {
  return `steinmetz-${shortUidFor(supabaseUid)}.slice`
}

export function sliceUnitPath(supabaseUid: string): string {
  return path.join(SLICE_INSTALL_DIR, sliceUnitName(supabaseUid))
}

// Render the slice template with the user's short-uid substituted for `%i`
// and the tier's MemoryMax / CPUQuota / IOWeight values applied. Exposed
// separately from the install path so tests / preview tooling can inspect
// the body without writing it to disk.
export function renderSliceUnit(
  supabaseUid: string,
  template: string,
  tier?: string | null,
): string {
  const short = shortUidFor(supabaseUid)
  const params = resolveComputeTier(tier)
  return template
    .replace(/%i/g, short)
    .replace(/^MemoryMax=.*/m, `MemoryMax=${params.memoryMax}`)
    .replace(/^CPUQuota=.*/m, `CPUQuota=${params.cpuQuota}`)
    .replace(/^IOWeight=.*/m, `IOWeight=${params.ioWeight}`)
}

// Materialise the per-user slice unit file from the in-repo template. Idempotent
// in the sense that re-running with the same tier produces the same body; a
// `systemctl daemon-reload` afterwards picks up any change. Fails soft — any
// missing-sudo / missing-template error logs a warning and returns, so the
// gating env var staying off can never break workspace materialisation.
export async function ensureUserSlice(
  supabaseUid: string,
  tier?: string | null,
): Promise<void> {
  if (!PER_USER_SLICES_ENABLED) return
  let template: string
  try {
    template = await fs.readFile(SLICE_TEMPLATE_PATH, "utf8")
  } catch (e) {
    console.warn(
      `[hardening 3.4] failed to read slice template ${SLICE_TEMPLATE_PATH}; skipping.`,
      e,
    )
    return
  }
  const body = renderSliceUnit(supabaseUid, template, tier)
  const target = sliceUnitPath(supabaseUid)
  const tmpPath = path.join(
    os.tmpdir(),
    `${sliceUnitName(supabaseUid)}.${process.pid}.tmp`,
  )
  try {
    await fs.writeFile(tmpPath, body, "utf8")
    const inst = await runSudo([
      "/usr/bin/install",
      "-m",
      "0644",
      "-o",
      "root",
      "-g",
      "root",
      tmpPath,
      target,
    ])
    if (!inst.ok) {
      console.warn(
        `[hardening 3.4] install ${target} failed (code=${inst.code}); slice will not apply.`,
        inst.stderr,
      )
      return
    }
    const rel = await runSudo(["/usr/bin/systemctl", "daemon-reload"])
    if (!rel.ok) {
      console.warn(
        `[hardening 3.4] systemctl daemon-reload after writing ${target} failed (code=${rel.code}); new slice values may not be live until the next reload.`,
        rel.stderr,
      )
    }
  } finally {
    try {
      await fs.unlink(tmpPath)
    } catch {}
  }
}

async function runSudo(
  argv: string[],
): Promise<{ ok: true } | { ok: false; code: number | string | undefined; stderr: string }> {
  try {
    await execFileP("sudo", ["-n", ...argv])
    return { ok: true }
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { code?: number | string; stderr?: string }
    return {
      ok: false,
      code: err.code,
      stderr: typeof err.stderr === "string" ? err.stderr : String(e),
    }
  }
}

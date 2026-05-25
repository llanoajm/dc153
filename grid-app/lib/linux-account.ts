import "server-only"
import crypto from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

// HARDENING §3.1 — per-user Linux account.
//
// Kernel-enforced isolation begins here. On workspace provisioning we mint a
// Linux system account named `steinmetz-<short-uid>`, chown the workspace
// directory to it, and chmod 700. From that point the workspace contents are
// owned per-user; grid-app (running as `agent`, in group `steinmetz`) keeps
// directory-entry visibility but cannot read or write the contents directly.
// Per-user opencode units (item 3.2) and per-user Python venvs (item 3.3)
// take over the actual read/write side.
//
// **Default behavior is off.** Until item 3.2 ships, locking the workspace
// 700 would break grid-app's existing org-overlay / provider-key / source-
// upload writes (they all happen from the `agent` process). We expose the
// plumbing here and gate the OS-mutating call behind
// `STEINMETZ_ENABLE_LINUX_ACCOUNTS=1`. Set the flag once the per-user
// opencode units land. Until then, `shortUidFor()` / `linuxUserFor()` are
// still callable so downstream items 3.2 and 3.3 can build on top of them.
//
// **Host prereqs** (documented in STATE.md): grid-app's `agent` user must
// have NOPASSWD sudo for `/usr/sbin/useradd`, `/bin/chown`, `/bin/chmod`,
// and must be a member of the `steinmetz` group.

const execFileP = promisify(execFile)

const LINUX_USER_PREFIX = "steinmetz-"
const LINUX_GROUP = "steinmetz"
const SHORT_UID_HEX_CHARS = 16 // 64 bits; fits in 32-char Linux username budget.

// 32-char useradd cap minus prefix = 22 chars of headroom. We use 16 hex
// chars (64 bits of entropy) — collision risk across our user base is
// negligible and we keep room for future prefix tweaks.
const _PREFIX_BUDGET = 32 - LINUX_USER_PREFIX.length
if (SHORT_UID_HEX_CHARS > _PREFIX_BUDGET) {
  throw new Error(
    `SHORT_UID_HEX_CHARS (${SHORT_UID_HEX_CHARS}) exceeds Linux username budget (${_PREFIX_BUDGET})`,
  )
}

export function shortUidFor(supabaseUid: string): string {
  return crypto
    .createHash("sha256")
    .update(supabaseUid)
    .digest("hex")
    .slice(0, SHORT_UID_HEX_CHARS)
}

export function linuxUserFor(supabaseUid: string): string {
  return LINUX_USER_PREFIX + shortUidFor(supabaseUid)
}

export function linuxGroup(): string {
  return LINUX_GROUP
}

function isEnabled(): boolean {
  return process.env.STEINMETZ_ENABLE_LINUX_ACCOUNTS === "1"
}

// useradd exits 9 when the username already exists — treat that as success
// so re-provisioning is a no-op.
const USERADD_EXISTS = 9

async function runSudo(argv: string[]): Promise<{ ok: true } | { ok: false; code: number | string | undefined; stderr: string }> {
  try {
    await execFileP("sudo", ["-n", ...argv])
    return { ok: true }
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { code?: number | string; stderr?: string }
    return { ok: false, code: err.code, stderr: typeof err.stderr === "string" ? err.stderr : String(e) }
  }
}

// Idempotent: useradd a no-op when the user exists, chown/chmod always run
// (cheap and safe to repeat). Fails soft — any sudo error logs a warning
// and returns, so the gating env var staying off (or sudo missing in dev)
// can never break workspace materialization.
export async function ensureLinuxAccount(
  workspaceDir: string,
  supabaseUid: string,
): Promise<void> {
  if (!isEnabled()) return
  const user = linuxUserFor(supabaseUid)

  const ua = await runSudo([
    "/usr/sbin/useradd",
    "--system",
    "--no-create-home",
    "--home",
    workspaceDir,
    user,
  ])
  if (!ua.ok && ua.code !== USERADD_EXISTS) {
    console.warn(
      `[hardening 3.1] useradd ${user} failed (code=${ua.code}); skipping chown/chmod.`,
      ua.stderr,
    )
    return
  }

  const co = await runSudo(["/bin/chown", "-R", `${user}:${LINUX_GROUP}`, workspaceDir])
  if (!co.ok) {
    console.warn(`[hardening 3.1] chown ${workspaceDir} failed (code=${co.code}).`, co.stderr)
    return
  }

  const cm = await runSudo(["/bin/chmod", "700", workspaceDir])
  if (!cm.ok) {
    console.warn(`[hardening 3.1] chmod 700 ${workspaceDir} failed (code=${cm.code}).`, cm.stderr)
  }
}

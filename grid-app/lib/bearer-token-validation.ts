import { existsSync, readFileSync } from "node:fs"

// Validates STEINMETZ_*_TOKEN env vars at boot. Filed by LOOP_QUEUE.md item 10.1
// — a corrupt shell value (`STEINMETZ_OPENCODE_TOKEN=...... │\n`, U+2502 from a
// pasted TUI table) silently beat the clean .env.local entry and downstream
// `fetch` exploded on the bearer header with
// `Cannot convert argument to a ByteString ... character ... value of 9474`.
//
// The chat UI surfaced the failure as a permanent "Loading…" placeholder. A
// startup-time validator fails fast instead.
//
// Expected token shape: 32+ hex characters (matches `openssl rand -hex 32`,
// which is what scripts/launch-stack.sh prints in its generation hint).

const HEX_RE = /^[0-9a-f]{32,}$/
const ASCII_RE = /^[\x20-\x7e]*$/

export type TokenValidationResult =
  | { ok: true; value: string; trimmed: boolean }
  | { ok: false; reason: string }

export function validateBearerToken(
  raw: string | undefined | null,
): TokenValidationResult {
  if (raw == null || raw === "") {
    return { ok: false, reason: "empty" }
  }
  const trimmed = raw.trim()
  if (trimmed === "") {
    return { ok: false, reason: "whitespace-only" }
  }
  if (!ASCII_RE.test(trimmed)) {
    const offender = findNonAscii(trimmed)
    return {
      ok: false,
      reason: `non-ASCII character at index ${offender.index} (U+${offender.codePoint
        .toString(16)
        .toUpperCase()
        .padStart(4, "0")})`,
    }
  }
  if (!HEX_RE.test(trimmed)) {
    return {
      ok: false,
      reason: "expected 32+ lowercase hex chars (matches `openssl rand -hex 32`)",
    }
  }
  return { ok: true, value: trimmed, trimmed: trimmed !== raw }
}

function findNonAscii(s: string): { index: number; codePoint: number } {
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i) ?? 0
    if (cp < 0x20 || cp > 0x7e) return { index: i, codePoint: cp }
  }
  return { index: -1, codePoint: 0 }
}

// Reads `process.env[name]`, validates, and either returns the sanitized value
// or scrubs the polluted env var. When pollution is detected, also attempts a
// best-effort re-read of `.env.local` so the clean value the user actually
// committed wins over the corrupt shell value. (Next.js's dotenv loader does
// not override pre-existing env vars, so shell pollution silently beats
// .env.local at boot.) Loud console warning on rejection / replacement.
// Returns undefined when the env var is absent — callers that need it enforce
// that themselves.
export function sanitizeBearerTokenEnv(name: string): string | undefined {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const result = validateBearerToken(raw)
  if (!result.ok) {
    const recovered = readFromEnvLocal(name)
    if (recovered && validateBearerToken(recovered).ok) {
      console.warn(
        `[bearer-token] ${name} rejected at boot (${result.reason}); ` +
          `recovered a clean value from .env.local. Tip: launch with ` +
          `\`env -i HOME=$HOME PATH=$PATH npm run dev\` to avoid shell pollution next time.`,
      )
      process.env[name] = recovered
      return recovered
    }
    console.warn(
      `[bearer-token] ${name} rejected at boot: ${result.reason}. ` +
        `No clean value found in .env.local; scrubbing so downstream callers fail closed. ` +
        `Tip: \`env -i HOME=$HOME PATH=$PATH npm run dev\` avoids shell-pollution beating .env.local.`,
    )
    delete process.env[name]
    return undefined
  }
  if (result.trimmed) {
    console.warn(
      `[bearer-token] ${name} had surrounding whitespace; trimmed in place.`,
    )
    process.env[name] = result.value
  }
  return result.value
}

// Best-effort .env.local parser. Looks only for the requested key. Returns
// undefined if the file is unreadable or the key is absent. We intentionally
// keep this tiny — no quote handling, no expansion — because the keys we care
// about (hex tokens) never contain quotes or special chars.
function readFromEnvLocal(name: string): string | undefined {
  try {
    const cwd = process.cwd()
    const candidates = [`${cwd}/.env.local`, `${cwd}/.env`]
    for (const file of candidates) {
      if (!existsSync(file)) continue
      const text = readFileSync(file, "utf8")
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
        if (!m || m[1] !== name) continue
        let v = m[2]
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1)
        }
        return v.trim()
      }
    }
  } catch {
    // ignore — caller falls back to delete + undefined.
  }
  return undefined
}

const BEARER_TOKEN_ENV_VARS = [
  "STEINMETZ_OPENCODE_TOKEN",
  "STEINMETZ_INTERNAL_TOKEN",
] as const

let booted = false

// Idempotent. Called from instrumentation.ts so the first request to any route
// sees clean env vars. Safe to call again at any read site (e.g.
// opencode-transport.ts module-load) as defense in depth.
export function validateBearerTokensAtBoot(): void {
  if (booted) return
  booted = true
  for (const name of BEARER_TOKEN_ENV_VARS) {
    sanitizeBearerTokenEnv(name)
  }
}

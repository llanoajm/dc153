import "server-only"
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto"
import { createClient } from "@/lib/supabase/server"
import { serviceClient } from "@/lib/supabase/service"

// Per-user provider keys (HARDENING §1.4). Stored encrypted at rest with
// AES-256-GCM keyed off `STEINMETZ_PROVIDER_KEYS_SECRET`. Decryption happens
// only server-side at the point grid-app writes the user's workspace
// `.opencode/opencode.jsonc` so opencode can use the key for that user's
// sessions. The plaintext key is never returned to the browser; the settings
// API exposes `key_hint` (masked tail) only.
//
// Supabase Vault / pgsodium would let us drop the app-side secret entirely,
// but enabling those extensions is a separate vault-setup workflow.

export const SUPPORTED_PROVIDERS = ["openrouter"] as const
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number]

export function isSupportedProvider(p: string): p is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(p)
}

export interface ProviderKeyRow {
  provider: string
  key_hint: string | null
  created_at: string
  updated_at: string
}

const ALGO = "aes-256-gcm"
const IV_BYTES = 12

function loadSecret(): Buffer {
  const raw = process.env.STEINMETZ_PROVIDER_KEYS_SECRET
  if (!raw) {
    throw new Error(
      "STEINMETZ_PROVIDER_KEYS_SECRET is not set (32-byte hex; see .env.example)",
    )
  }
  const buf = Buffer.from(raw, "hex")
  if (buf.length !== 32) {
    throw new Error(
      `STEINMETZ_PROVIDER_KEYS_SECRET must be 32 hex bytes (64 chars); got ${buf.length} bytes`,
    )
  }
  return buf
}

export function encryptKey(plaintext: string): string {
  const key = loadSecret()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`
}

export function decryptKey(ciphertext: string): string {
  const key = loadSecret()
  const parts = ciphertext.split(":")
  if (parts.length !== 3) throw new Error("malformed encrypted key")
  const [ivHex, tagHex, ctHex] = parts
  const iv = Buffer.from(ivHex, "hex")
  const tag = Buffer.from(tagHex, "hex")
  const ct = Buffer.from(ctHex, "hex")
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString("utf8")
}

// Masked form for display: show enough prefix to identify the provider's key
// format, and the last 4 chars so the user can tell which key is stored.
export function maskKey(plaintext: string): string {
  const s = plaintext.trim()
  if (s.length <= 10) return "•".repeat(s.length)
  const prefixLen = Math.min(7, Math.max(4, s.length - 6))
  return `${s.slice(0, prefixLen)}…${s.slice(-4)}`
}

// User-scoped reads/writes (RLS-gated).
export async function listMyProviderKeys(): Promise<ProviderKeyRow[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from("provider_keys")
    .select("provider, key_hint, created_at, updated_at")
    .eq("user_id", user.id)
    .order("provider", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ProviderKeyRow[]
}

export async function upsertMyProviderKey(
  provider: SupportedProvider,
  plaintext: string,
): Promise<ProviderKeyRow> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("unauthorized")
  const encrypted_key = encryptKey(plaintext)
  const key_hint = maskKey(plaintext)
  const now = new Date().toISOString()

  const { data: existing, error: lookupErr } = await supabase
    .from("provider_keys")
    .select("id")
    .eq("user_id", user.id)
    .eq("provider", provider)
    .maybeSingle()
  if (lookupErr) throw new Error(lookupErr.message)

  if (existing) {
    const { data, error } = await supabase
      .from("provider_keys")
      .update({ encrypted_key, key_hint, updated_at: now })
      .eq("id", (existing as { id: string }).id)
      .select("provider, key_hint, created_at, updated_at")
      .single()
    if (error) throw new Error(error.message)
    return data as ProviderKeyRow
  }
  const { data, error } = await supabase
    .from("provider_keys")
    .insert({
      user_id: user.id,
      provider,
      encrypted_key,
      key_hint,
    })
    .select("provider, key_hint, created_at, updated_at")
    .single()
  if (error) throw new Error(error.message)
  return data as ProviderKeyRow
}

export async function deleteMyProviderKey(provider: SupportedProvider): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("unauthorized")
  const { error } = await supabase
    .from("provider_keys")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider)
  if (error) throw new Error(error.message)
}

// Service-role read used by the workspace-config writer. The caller has
// already authenticated as `userId` upstream; we use the service client here
// so this also works from contexts that don't carry the user's session
// (e.g. detached spawns). Decrypts to a `{ provider: apiKey }` map. Returns
// an empty object when the user has no keys configured — opencode then
// falls back to the env-var key.
export async function getUserProviderKeysMap(
  userId: string,
): Promise<Record<string, string>> {
  const svc = serviceClient()
  const { data, error } = await svc
    .from("provider_keys")
    .select("provider, encrypted_key")
    .eq("user_id", userId)
  if (error) throw new Error(error.message)
  const out: Record<string, string> = {}
  for (const row of (data ?? []) as Array<{ provider: string; encrypted_key: string }>) {
    try {
      out[row.provider] = decryptKey(row.encrypted_key)
    } catch (e) {
      console.warn(`decrypt failed for user=${userId} provider=${row.provider}:`, e)
    }
  }
  return out
}

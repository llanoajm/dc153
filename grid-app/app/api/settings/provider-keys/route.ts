import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  SUPPORTED_PROVIDERS,
  deleteMyProviderKey,
  getUserProviderKeysMap,
  isSupportedProvider,
  listMyProviderKeys,
  upsertMyProviderKey,
} from "@/lib/provider-keys"
import { ensureUserWorkspace, writeUserProviderConfig } from "@/lib/user-workspace"

// GET  /api/settings/provider-keys                -> [{ provider, key_hint, ... }]
// POST /api/settings/provider-keys                  { provider, key } -> { provider, key_hint }
// DELETE /api/settings/provider-keys?provider=...   -> 204
//
// HARDENING §1.4: per-user OpenRouter (and future-provider) keys. Plaintext
// is never returned — `key_hint` is the masked tail. After upsert/delete,
// the user's workspace .opencode/opencode.jsonc is rewritten so the next
// session picks up (or drops) the per-user key without a server restart.

async function refreshWorkspaceProviderConfig(userId: string) {
  const dir = await ensureUserWorkspace(userId)
  const keys = await getUserProviderKeysMap(userId)
  await writeUserProviderConfig(dir, keys)
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const rows = await listMyProviderKeys()
    return NextResponse.json({
      keys: rows,
      supported: SUPPORTED_PROVIDERS,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: { provider?: unknown; key?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const provider = typeof body.provider === "string" ? body.provider.trim() : ""
  const key = typeof body.key === "string" ? body.key.trim() : ""
  if (!isSupportedProvider(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${SUPPORTED_PROVIDERS.join(", ")}` },
      { status: 400 },
    )
  }
  if (!key) {
    return NextResponse.json({ error: "key required" }, { status: 400 })
  }
  if (key.length < 16) {
    return NextResponse.json({ error: "key too short" }, { status: 400 })
  }

  try {
    const row = await upsertMyProviderKey(provider, key)
    await refreshWorkspaceProviderConfig(user.id)
    return NextResponse.json(row)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const provider = (url.searchParams.get("provider") ?? "").trim()
  if (!isSupportedProvider(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${SUPPORTED_PROVIDERS.join(", ")}` },
      { status: 400 },
    )
  }
  try {
    await deleteMyProviderKey(provider)
    await refreshWorkspaceProviderConfig(user.id)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

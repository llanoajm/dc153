import "server-only"
import { createClient } from "@supabase/supabase-js"

// Service-role client. Bypasses RLS. Server-only. Never expose to the browser.
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase service env vars missing")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

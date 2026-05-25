import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import {
  SUPPORTED_PROVIDERS,
  listMyProviderKeys,
  type ProviderKeyRow,
} from "@/lib/provider-keys"
import { ProviderKeysPanel } from "@/components/settings/ProviderKeysPanel"

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login?next=/app/settings")

  let initialKeys: ProviderKeyRow[] = []
  try {
    initialKeys = await listMyProviderKeys()
  } catch {
    // Fall through with an empty list; the panel will surface the error on
    // the first refresh.
  }
  return (
    <ProviderKeysPanel
      initialKeys={initialKeys}
      supported={[...SUPPORTED_PROVIDERS]}
    />
  )
}

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { listMyOrgs } from "@/lib/orgs"
import { OrgsPanel } from "@/components/orgs/OrgsPanel"

export default async function OrgsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login?next=/app/orgs")

  const memberships = await listMyOrgs()
  return <OrgsPanel initialMemberships={memberships} />
}

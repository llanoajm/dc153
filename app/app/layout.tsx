import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ensureUserWorkspace } from "@/lib/user-workspace"
import { Lockup } from "@/components/lockup"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Materialize the user's workspace if it doesn't exist yet.
  await ensureUserWorkspace(user.id)

  return (
    <div className="flex-1 flex flex-col bg-white text-black">
      <header className="border-b border-black/10 px-6 py-3 flex items-center justify-between">
        <Lockup size="sm" />
        <form action="/auth/signout" method="POST">
          <button
            type="submit"
            className="text-xs font-mark tracking-wider text-black/60 hover:text-black"
          >
            Sign out
          </button>
        </form>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  )
}

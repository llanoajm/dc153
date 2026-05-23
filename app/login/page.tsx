"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Lockup } from "@/components/lockup"
import { createClient } from "@/lib/supabase/client"

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get("next") || "/app"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setPending(false)
    if (error) {
      setError(error.message)
      return
    }
    router.push(next)
    router.refresh()
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center bg-white text-black px-6">
      <div className="flex flex-col items-center gap-12 w-full max-w-sm">
        <Lockup size="md" />
        <form onSubmit={onSubmit} className="w-full flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-mark tracking-wider text-black/70">
            Email
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border border-black/40 focus:border-black px-3 py-2 outline-none text-sm font-sans"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-mark tracking-wider text-black/70">
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border border-black/40 focus:border-black px-3 py-2 outline-none text-sm font-sans"
            />
          </label>
          {error ? (
            <p className="text-xs text-red-600 font-sans">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="mt-2 bg-black text-white px-5 py-2.5 text-sm font-mark tracking-wider disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="text-xs font-serif-soft">
          No account?{" "}
          <Link href="/signup" className="underline underline-offset-4">
            Create one
          </Link>
        </p>
      </div>
      <footer className="fixed bottom-6 inset-x-0 text-center font-serif-soft text-[13px]">
        Steinmetz Power Infrastructure &copy; 2026
      </footer>
    </main>
  )
}

"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Lockup } from "@/components/lockup"
import { createClient } from "@/lib/supabase/client"

export default function SignUpPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setInfo(null)
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/app`,
      },
    })
    setPending(false)
    if (error) {
      setError(error.message)
      return
    }
    if (data.session) {
      // Email confirmation disabled — signed in immediately
      router.push("/app")
      router.refresh()
      return
    }
    setInfo("Check your email for a confirmation link to finish signing up.")
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
          {error ? <p className="text-xs text-red-600 font-sans">{error}</p> : null}
          {info ? <p className="text-xs text-black/70 font-sans">{info}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="mt-2 bg-black text-white px-5 py-2.5 text-sm font-mark tracking-wider disabled:opacity-50"
          >
            {pending ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="text-xs font-serif-soft">
          Already have one?{" "}
          <Link href="/login" className="underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
      <footer className="fixed bottom-6 inset-x-0 text-center font-serif-soft text-[13px]">
        Steinmetz Power Infrastructure &copy; 2026
      </footer>
    </main>
  )
}

"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

// The login button is the one place where the design system uses pure black
// (`var(--ink-pure)` / #000) with uppercase-tracked label — formal
// access-portal framing per the brand README.
const ACCENT = "#000000"

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  )
}

function LoginPageInner() {
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
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg-page)", color: "var(--ink)" }}
    >
      <nav className="flex items-center px-6 sm:px-14 py-5">
        <div className="flex items-center gap-2">
          <Image
            src="/spi-mark-filled.png"
            alt="Steinmetz"
            width={34}
            height={34}
            priority
            style={{
              height: 32,
              width: "auto",
              transform: "rotate(var(--axis-angle, 5deg))",
            }}
          />
          <span
            className="font-mark leading-none"
            style={{ fontSize: 20, letterSpacing: "var(--track-normal)" }}
          >
            Steinmetz
          </span>
        </div>
      </nav>

      <main className="flex-1 flex flex-col items-center justify-center px-6 -mt-12">
        <div className="w-full max-w-sm flex flex-col gap-8">
          <header className="flex flex-col gap-2">
            <span
              className="label-eyebrow"
              style={{ color: "var(--navy-pop)" }}
            >
              Access Portal
            </span>
            <h1
              className="leading-[1.05] m-0"
              style={{
                fontFamily: "var(--font-sora), sans-serif",
                fontWeight: 300,
                fontStyle: "italic",
                fontSize: "clamp(36px, 5.5vw, 64px)",
                letterSpacing: "var(--track-tight)",
                color: "var(--ink)",
              }}
            >
              <span className="block" style={{ paddingLeft: 22 }}>
                Frontier
              </span>
              <span className="block" style={{ paddingLeft: 14 }}>
                Intelligence
              </span>
              <span className="block" style={{ paddingLeft: 6 }}>
                For the Grid
              </span>
            </h1>
          </header>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span
                className="font-mark"
                style={{
                  fontSize: 11,
                  letterSpacing: "var(--track-label)",
                  color: "var(--fg-mute-3)",
                }}
              >
                Email
              </span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="outline-none"
                style={{
                  fontFamily: "var(--font-sora)",
                  fontSize: 14,
                  color: "var(--ink-pure)",
                  background: "var(--bg-card)",
                  border: "1.5px solid var(--bor-2)",
                  borderRadius: "var(--r-4)",
                  padding: "12px 14px",
                  transition: "border-color var(--t-input)",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "var(--ink-pure)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "var(--bor-2)")
                }
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span
                className="font-mark"
                style={{
                  fontSize: 11,
                  letterSpacing: "var(--track-label)",
                  color: "var(--fg-mute-3)",
                }}
              >
                Password
              </span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="outline-none"
                style={{
                  fontFamily: "var(--font-sora)",
                  fontSize: 14,
                  color: "var(--ink-pure)",
                  background: "var(--bg-card)",
                  border: "1.5px solid var(--bor-2)",
                  borderRadius: "var(--r-4)",
                  padding: "12px 14px",
                  transition: "border-color var(--t-input)",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "var(--ink-pure)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "var(--bor-2)")
                }
              />
            </label>
            {error ? (
              <p
                style={{
                  fontFamily: "var(--font-jetbrains)",
                  fontSize: 12,
                  color: "var(--err-soft)",
                }}
              >
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="mt-2 font-mark disabled:opacity-50"
              style={{
                background: ACCENT,
                color: "var(--bg-card)",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "var(--track-meta)",
                padding: "13px 18px",
                borderRadius: "var(--r-4)",
                transition: "background var(--t-hover), transform var(--t-press)",
              }}
              onMouseEnter={(e) => {
                if (!pending) e.currentTarget.style.background = "#222"
              }}
              onMouseLeave={(e) => {
                if (!pending) e.currentTarget.style.background = ACCENT
              }}
              onMouseDown={(e) =>
                (e.currentTarget.style.transform = "scale(0.98)")
              }
              onMouseUp={(e) =>
                (e.currentTarget.style.transform = "scale(1)")
              }
            >
              {pending ? "Signing in…" : "Access Portal"}
            </button>
          </form>

          <Link
            href="/signup"
            className="font-soft self-start"
            style={{
              fontSize: 13,
              color: "var(--fg-mute-2)",
              transition: "color var(--t-hover)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = "var(--ink-app)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "var(--fg-mute-2)")
            }
          >
            Need access? Request an invite →
          </Link>
        </div>
      </main>

      <footer
        className="text-center py-5"
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 12,
          fontWeight: 300,
          color: "var(--fg-mute-5)",
        }}
      >
        Steinmetz Power Infrastructure &copy; 2026
      </footer>
    </div>
  )
}

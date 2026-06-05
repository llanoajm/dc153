"use client"

import { Suspense, useState, FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import styles from "./page.module.css"

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
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim()
    const password = (form.elements.namedItem("password") as HTMLInputElement).value

    setLoading(true)
    setError("")

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (!authError) {
      router.push(next)
      router.refresh()
    } else {
      setError("Incorrect email or password.")
      setLoading(false)
      ;(form.elements.namedItem("password") as HTMLInputElement).value = ""
      ;(form.elements.namedItem("password") as HTMLInputElement).focus()
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.formPane}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.formMark} src="/spi-mark-filled.png" alt="Steinmetz mark" />
        <div className={styles.welcomeGroup}>
          <h1 className={styles.welcome}>Welcome Back</h1>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} autoComplete="off" noValidate>
          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="Enter email"
              autoComplete="email"
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="Enter password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className={styles.error}>{error}</div>
          <button className={styles.btn} type="submit" disabled={loading}>
            <span className={styles.btnText}>
              {loading ? "Checking…" : "Log in"}
              <svg
                className={styles.btnArrow}
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        </form>
        </div>

        <div className={styles.mediaPane} aria-hidden="true">
          <video
            className={styles.bgVideo}
            src="/videos/login-bg.mp4"
            autoPlay
            muted
            playsInline
            loop
            preload="auto"
          />
        </div>
      </div>

      <footer className={styles.footer}>
        Steinmetz Power Infrastructure &copy; 2026
      </footer>
    </div>
  )
}

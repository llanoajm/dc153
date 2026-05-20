'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import styles from './page.module.css'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim()
    const password = (form.elements.namedItem('password') as HTMLInputElement).value

    setLoading(true)
    setError('')

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    if (res.ok) {
      router.push('/launch')
    } else {
      setError('Incorrect email or password.')
      setLoading(false)
      ;(form.elements.namedItem('password') as HTMLInputElement).value = ''
      ;(form.elements.namedItem('password') as HTMLInputElement).focus()
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.lockup}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.mark} src="/spi-mark-filled.png" alt="Steinmetz mark" />
          <div className={styles.word}>Steinmetz</div>
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
            {loading ? 'Checking…' : 'Access Portal'}
          </button>
        </form>
      </div>

      <footer className={styles.footer}>
        Steinmetz Power Infrastructure &copy; 2026
      </footer>
    </div>
  )
}

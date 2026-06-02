'use client'

import { useState, useEffect } from 'react'
import styles from '../page.module.css'

// The full "Enter your work email" placeholder overflows the input once it hits
// its clamp() floor (~1024px and below, measured), so swap to the terse "Work
// Email" there to avoid clipping.
export default function EmailInput() {
  const [short, setShort] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)')
    const update = () => setShort(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return (
    <input
      className={styles.heroFormInput}
      type="email"
      name="email"
      placeholder={short ? 'Work Email' : 'Enter your work email'}
      aria-label="Work email"
      required
    />
  )
}

'use client'

import { useState } from 'react'
import styles from './AnnouncementBanner.module.css'

export default function AnnouncementBanner() {
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  return (
    <div className={styles.banner} role="region" aria-label="Announcement">
      <p className={styles.text}>
        Introducing <span className={styles.proactiveWord}>Proactive </span>Backtesting Agents.{' '}
        <a className={styles.link} href="https://app.steinmetz.ai">Learn more</a>
      </p>
      <button
        type="button"
        className={styles.close}
        aria-label="Dismiss announcement"
        onClick={() => setVisible(false)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

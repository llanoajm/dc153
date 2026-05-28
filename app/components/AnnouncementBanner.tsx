'use client'

import { useState } from 'react'
import styles from './AnnouncementBanner.module.css'

export default function AnnouncementBanner() {
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  return (
    <div className={styles.banner} role="region" aria-label="Announcement">
      <span className={styles.text}>Steinmetz 1.1 Beta Rolling Out Now</span>
      <button
        type="button"
        className={styles.close}
        aria-label="Dismiss announcement"
        onClick={() => setVisible(false)}
      >
        ×
      </button>
    </div>
  )
}

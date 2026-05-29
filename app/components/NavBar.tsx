/* eslint-disable @next/next/no-img-element */
'use client'
import { useState, useEffect } from 'react'
import styles from './NavBar.module.css'

export default function NavBar() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 960) setOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div className={styles.wrapper}>
      <nav className={styles.nav}>
        <div className={styles.navLogo}>
          <img className={styles.navMark} src="/spi-mark-filled.png" alt="Steinmetz" />
          <span className={styles.navWord}>Steinmetz</span>
        </div>

        <div className={styles.navLinks}>
          <a href="#" className={styles.navLink}>Research</a>
          <a href="#" className={styles.navLink}>Models</a>
          <a href="#" className={styles.navLink}>How It Works</a>
        </div>

        <div className={styles.navActions}>
          <a href="/login" className={`${styles.navCta} ${styles.navCtaLight}`}>
            <span className={styles.navCtaText}>Log in</span>
          </a>
          <a href="/login" className={styles.navCta}>
            <span className={styles.navCtaText}>Book a demo</span>
          </a>
        </div>

        <button
          className={styles.burger}
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          <span className={`${styles.burgerBar} ${open ? styles.bar1Open : ''}`} />
          <span className={`${styles.burgerBar} ${open ? styles.bar2Open : ''}`} />
          <span className={`${styles.burgerBar} ${open ? styles.bar3Open : ''}`} />
        </button>
      </nav>

      <div className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`} aria-hidden={!open}>
        <div className={styles.drawerInner}>
          <a href="#" className={styles.drawerLink} onClick={close}>Research</a>
          <a href="#" className={styles.drawerLink} onClick={close}>Models</a>
          <a href="#" className={styles.drawerLink} onClick={close}>How It Works</a>
          <div className={styles.drawerActions}>
            <a href="/login" className={`${styles.drawerCta} ${styles.drawerCtaLight}`} onClick={close}>
              <span className={styles.drawerCtaText}>Log in</span>
            </a>
            <a href="/login" className={styles.drawerCta} onClick={close}>
              <span className={styles.drawerCtaText}>Book a demo</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'
import { useEffect, useRef } from 'react'
import styles from './ScrollCards.module.css'

type Card = {
  label: string
  line1: string
  line2: string
  body: string
}

const CARDS: Card[] = [
  {
    label: '/A.01',
    line1: 'Real-time,',
    line2: 'infinite video',
    body: 'Evolving continuously with the world.',
  },
  {
    label: '/A.02',
    line1: 'at the',
    line2: 'speed of life',
    body: 'Perception, decision, action — instantly visible.',
  },
  {
    label: '/A.03',
    line1: '100x more',
    line2: 'efficient',
    body: 'Persistent intelligence, without persistent compute.',
  },
]

function localProgress(p: number, start: number, end: number) {
  return Math.max(0, Math.min(1, (p - start) / (end - start)))
}

export default function ScrollCards() {
  const sectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    let raf = 0

    const update = () => {
      const cards = section.querySelectorAll<HTMLElement>(`.${styles.card}`)
      const vh = window.innerHeight
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect()
        const total = vh + rect.height
        const traveled = vh - rect.top
        const p = Math.max(0, Math.min(1, traveled / total))
        const p1 = localProgress(p, 0.15, 0.55)
        const p2 = localProgress(p, 0.30, 0.70)
        const p3 = localProgress(p, 0.45, 0.85)
        card.style.setProperty('--p1', String(p1))
        card.style.setProperty('--p2', String(p2))
        card.style.setProperty('--p3', String(p3))
      })
    }

    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        update()
      })
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <section ref={sectionRef} className={styles.section}>
      {CARDS.map((c, i) => (
        <article key={i} className={styles.card}>
          <span className={styles.label}>{c.label}</span>
          <h2 className={styles.title}>
            <span className={`${styles.line} ${styles.line1}`}>{c.line1}</span>
            <span className={`${styles.line} ${styles.line2}`}>{c.line2}</span>
          </h2>
          <p className={styles.body}>{c.body}</p>
        </article>
      ))}
    </section>
  )
}

'use client'
import { useEffect } from 'react'

export default function NavScrollClass() {
  useEffect(() => {
    const onScroll = () => {
      document.body.dataset.scrolled = window.scrollY > 12 ? 'true' : 'false'
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return null
}

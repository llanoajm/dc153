'use client'

import dynamic from 'next/dynamic'
import styles from '../page.module.css'

const HeroAnimation = dynamic(() => import('./HeroAnimation'), {
  ssr: false,
  loading: () => (
    <div className={styles.cubeWrap}>
      <svg className={styles.cubeSvg} viewBox="0 0 460 393" fill="none">
        <path d="M 113.5,78.6 C 61.2,114.5 17.0,145.1 15.3,146.5 C 13.4,148.0 12.0,150.0 12.0,151.2 C 12.0,152.7 98.1,293.7 121.5,330.5 C 122.2,331.6 142.6,343.4 166.8,356.8 C 208.8,380.0 211.0,381.1 213.5,379.8 C 217.2,378.0 442.0,226.1 444.8,223.7 C 446.0,222.6 447.0,220.5 447.0,219.1 C 447.0,217.3 427.9,187.5 389.1,128.5 L 331.2,40.5 L 273.4,26.8 C 241.5,19.3 213.9,13.1 212.0,13.1 C 209.0,13.2 194.0,23.2 113.5,78.6 Z" stroke="#0000BB" strokeWidth="2" fill="none" />
      </svg>
    </div>
  ),
})

export default function HeroAnimationLoader() {
  return <HeroAnimation />
}

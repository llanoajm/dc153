'use client'

import { useRef, useEffect, useCallback } from 'react'
// @ts-expect-error flubber has no types
import { interpolate } from 'flubber'
import styles from '../page.module.css'

const CUBE = [
  // 1: outer silhouette
  'M 113.5,78.6 C 61.2,114.5 17.0,145.1 15.3,146.5 C 13.4,148.0 12.0,150.0 12.0,151.2 C 12.0,152.7 98.1,293.7 121.5,330.5 C 122.2,331.6 142.6,343.4 166.8,356.8 C 208.8,380.0 211.0,381.1 213.5,379.8 C 217.2,378.0 442.0,226.1 444.8,223.7 C 446.0,222.6 447.0,220.5 447.0,219.1 C 447.0,217.3 427.9,187.5 389.1,128.5 L 331.2,40.5 L 273.4,26.8 C 241.5,19.3 213.9,13.1 212.0,13.1 C 209.0,13.2 194.0,23.2 113.5,78.6 Z',
  // 2: inner S-detail
  'M 334.9,69.7 C 339.8,77.3 343.8,83.5 343.7,83.6 C 343.6,83.7 329.1,93.1 311.5,104.5 C 293.9,115.9 272.1,130.2 263.0,136.1 C 253.9,142.0 225.6,160.5 200.0,177.2 C 158.1,204.5 153.5,207.8 153.2,210.4 C 152.9,212.7 156.0,218.1 169.4,238.2 C 179.7,253.5 187.0,263.5 188.5,264.2 C 190.4,265.0 191.5,264.9 194.0,263.4 C 195.7,262.3 222.0,244.8 252.5,224.3 L 307.9,187.1 L 333.6,225.2 C 347.7,246.1 359.3,263.9 359.4,264.6 C 359.5,266.3 214.1,364.5 213.0,363.4 C 211.8,362.1 202.0,345.0 202.0,344.1 C 202.0,343.7 230.4,324.4 265.0,301.1 C 317.0,266.3 328.0,258.5 327.9,256.7 C 327.9,255.5 322.9,247.1 316.7,238.0 C 307.7,224.7 305.0,221.4 303.0,221.2 C 301.0,221.0 285.7,230.8 238.5,262.4 L 176.6,304.0 L 172.7,297.7 C 170.5,294.3 167.6,289.6 166.1,287.2 C 162.6,281.6 155.7,270.7 147.8,258.5 C 136.5,241.0 112.0,201.1 112.1,200.3 C 112.1,199.4 324.0,56.0 325.2,56.0 C 325.6,56.0 330.0,62.2 334.9,69.7 Z',
  // 3: left parallelogram
  'M 73.9,190.0 L 98.3,203.5 L 145.1,279.0 C 170.8,320.5 191.7,354.6 191.5,354.8 C 191.4,354.9 177.9,347.7 161.5,338.6 L 131.7,322.1 L 84.8,246.4 C 59.1,204.8 38.0,170.6 38.0,170.4 C 38.0,170.2 40.6,171.4 43.7,173.2 C 46.9,175.0 60.5,182.5 73.9,190.0 Z',
  // 4: small square dot
  'M 386.3,189.0 C 391.1,196.1 395.0,202.3 395.0,202.7 C 395.0,203.5 369.7,220.5 368.6,220.5 C 368.3,220.5 364.0,214.4 359.0,207.1 L 350.1,193.6 L 363.3,184.8 C 370.6,180.0 376.8,176.0 377.1,176.0 C 377.4,176.0 381.6,181.8 386.3,189.0 Z',
]

const TOWER = [
  // 1: outer silhouette
  'M230,20 L248,95 L365,95 L365,110 L251,110 L268,190 L345,190 L345,205 L271,205 L305,375 L155,375 L189,205 L115,205 L115,190 L192,190 L209,110 L95,110 L95,95 L212,95 Z',
  // 2: central cross bracing (figure-8 traces both X pairs)
  'M215,112 L208,203 L198,203 L203,373 L230,373 L257,203 L262,203 L255,373 L230,373 L205,203 L198,203 L210,112 L230,105 L250,112 L260,203 L253,203 L248,112 L230,105 Z',
  // 3: left power lines + insulators
  'M95,112 L95,140 Q50,155 5,150 Q50,156 95,142 L115,207 L115,235 Q70,250 5,245 Q70,252 115,237 L115,207 L95,142 Z',
  // 4: right power lines + insulators
  'M365,112 L365,140 Q410,155 455,150 Q410,156 365,142 L345,207 L345,235 Q390,250 455,245 Q390,252 345,237 L345,207 L365,142 Z',
]

const N = CUBE.length
const CYCLE = 10000

const DRAW_END = 0.12
const HOLD_1_END = 0.30
const MORPH_FWD_END = 0.50
const HOLD_2_END = 0.62
const MORPH_REV_END = 0.82
const UNDRAW_START = 0.90

const IMG_OUT_START = 0.04
const IMG_OUT_END = 0.14
const IMG_IN_START = 0.84
const IMG_IN_END = 0.94

function ease(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

function progress(t: number, start: number, end: number) {
  return ease(Math.max(0, Math.min(1, (t - start) / (end - start))))
}

type Interpolator = (t: number) => string

export default function CubeMorph() {
  const pathRefs = useRef<(SVGPathElement | null)[]>([])
  const imgRef = useRef<HTMLImageElement>(null)
  const rafRef = useRef<number>(0)
  const fwd = useRef<Interpolator[]>([])
  const rev = useRef<Interpolator[]>([])

  const setPathRef = useCallback((i: number) => (el: SVGPathElement | null) => {
    pathRefs.current[i] = el
  }, [])

  const animate = useCallback((t0: number) => {
    const tick = (now: number) => {
      const t = ((now - t0) % CYCLE) / CYCLE
      const paths = pathRefs.current
      const img = imgRef.current

      if (!img || paths.some(p => !p)) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      for (let i = 0; i < N; i++) {
        const el = paths[i]!
        let d: string
        let dash = 0

        if (t < DRAW_END) {
          d = CUBE[i]
          dash = 1 - progress(t, 0, DRAW_END)
        } else if (t < HOLD_1_END) {
          d = CUBE[i]
        } else if (t < MORPH_FWD_END) {
          const p = progress(t, HOLD_1_END, MORPH_FWD_END)
          d = fwd.current[i] ? fwd.current[i](p) : CUBE[i]
        } else if (t < HOLD_2_END) {
          d = TOWER[i]
        } else if (t < MORPH_REV_END) {
          const p = progress(t, HOLD_2_END, MORPH_REV_END)
          d = rev.current[i] ? rev.current[i](p) : TOWER[i]
        } else if (t < UNDRAW_START) {
          d = CUBE[i]
        } else {
          d = CUBE[i]
          dash = progress(t, UNDRAW_START, 1)
        }

        el.setAttribute('d', d)
        el.style.strokeDashoffset = String(dash)
      }

      let iris = 100
      if (t >= IMG_OUT_START && t < IMG_OUT_END) {
        iris = 100 * (1 - progress(t, IMG_OUT_START, IMG_OUT_END))
      } else if (t >= IMG_OUT_END && t < IMG_IN_START) {
        iris = 0
      } else if (t >= IMG_IN_START && t < IMG_IN_END) {
        iris = 100 * progress(t, IMG_IN_START, IMG_IN_END)
      }
      img.style.clipPath = `circle(${iris}% at 50% 50%)`

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    const opts = { maxSegmentLength: 8 }
    fwd.current = CUBE.map((c, i) => interpolate(c, TOWER[i], opts))
    rev.current = TOWER.map((t, i) => interpolate(t, CUBE[i], opts))
    animate(performance.now())
    return () => cancelAnimationFrame(rafRef.current)
  }, [animate])

  return (
    <div className={styles.cubeWrap}>
      <img
        ref={imgRef}
        className={styles.cubeImg}
        src="/spi-mark-filled.png"
        alt="Steinmetz cube"
      />
      <svg className={styles.cubeSvg} viewBox="0 0 460 393" fill="none">
        {CUBE.map((d, i) => (
          <path
            key={i}
            ref={setPathRef(i)}
            d={d}
            stroke="#0A1F44"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset="1"
          />
        ))}
      </svg>
    </div>
  )
}

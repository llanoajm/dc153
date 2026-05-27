/* eslint-disable @next/next/no-img-element */
import HeroAnimationLoader from './components/HeroAnimationLoader'
import styles from './page.module.css'

export default function HomePage() {
  return (
    <div className={styles.page}>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id="blackToOffblack" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.9647 0 0 0 0.0353
                    0 0.9098 0 0 0.0902
                    0 0 0.9098 0 0.0902
                    0 0 0 1 0"
          />
        </filter>
      </svg>
      <nav className={styles.nav}>
        <div className={styles.navLogo}>
          <img className={styles.navMark} src="/spi-mark-filled.png" alt="Steinmetz" />
          <span className={styles.navWord}>Steinmetz</span>
        </div>
        <div className={styles.navLinks}>
          <a href="#" className={styles.navLink}>Research</a>
          <a href="#" className={styles.navLink}>Platform</a>
          <a href="#" className={styles.navLink}>Solutions</a>
        </div>
        <a href="/login" className={styles.navCta}><span className={styles.navCtaText}>Contact Us</span></a>
      </nav>

      <section className={styles.hero}>
        <div className={styles.gridWrap}>
          {(() => {
            const cells = []
            const size = 60
            const cols = 11
            const rows = 9
            const cx = Math.floor(cols / 2)
            const cy = Math.floor(rows / 2)
            const maxR = 2.2
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                const dx = c - cx
                const dy = r - cy
                const dist = Math.sqrt(dx * dx + dy * dy)
                const opacity = Math.max(0, 1 - (dist / maxR) ** 1.8) * 0.07
                if (opacity < 0.003) continue
                cells.push(
                  <div
                    key={`${r}-${c}`}
                    className={styles.gridCell}
                    style={{
                      left: (c - cx) * size,
                      top: (r - cy) * size,
                      width: size,
                      height: size,
                      borderColor: `rgba(0,0,0,${opacity})`,
                    }}
                  />
                )
              }
            }
            return cells
          })()}
        </div>
        <div className={styles.axisY} />
        <div className={styles.axisX} />

        <div className={styles.heroContent}>
          <span className={styles.heroLabel}></span>
          <h1 className={styles.heroTitle}><span className={styles.step1}>Frontier</span><br /><span className={styles.step2}>Intelligence</span><br /><span className={styles.step3}>For the Grid</span></h1>
          <p className={styles.heroSub}><span className={styles.step4}>Powering the most critical electrical</span><br /><span className={styles.step5}>infrastructure projects</span></p>
          <a href="https://app.steinmetz.ai" className={`${styles.heroCta} ${styles.step6}`}><span className={styles.heroCtaText}>Try Steinmetz 1.1</span></a>
        </div>

        <div className={styles.heroCube}>
          <HeroAnimationLoader />
        </div>
      </section>
    </div>
  )
}

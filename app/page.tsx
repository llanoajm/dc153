/* eslint-disable @next/next/no-img-element */
import HeroAnimationLoader from './components/HeroAnimationLoader'
import EmailInput from './components/EmailInput'
import NavScrollClass from './components/NavScrollClass'
import NavBar from './components/NavBar'
import AnnouncementBanner from './components/AnnouncementBanner'
import styles from './page.module.css'

export default function HomePage() {
  return (
    <div className={styles.page}>
      <NavScrollClass />
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
        <filter id="blackToFooterBg" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.976 0     0     0 0.024
                    0     0.922 0     0 0.078
                    0     0     0.773 0 0.227
                    0     0     0     1 0"
          />
        </filter>
      </svg>
      <AnnouncementBanner />
      <NavBar />

      <section className={styles.hero}>
        <div className={styles.gridLines}>
          <div className={styles.gridOrigin}>
            {(() => {
              const lines: React.ReactElement[] = []
              const gap = 24
              const count = 20
              for (let i = -count; i <= count; i++) {
                if (i === 0) continue
                lines.push(
                  <div key={`v${i}`} className={styles.gridLineV} style={{ left: i * gap }} />
                )
                lines.push(
                  <div key={`h${i}`} className={styles.gridLineH} style={{ top: i * gap }} />
                )
              }
              return lines
            })()}
          </div>
        </div>
        <div className={styles.axisY} />
        <div className={styles.axisX} />

        <div className={styles.heroContent}>
          <span className={styles.heroLabel}></span>
          <h1 className={styles.heroTitle}><span className={styles.step1}>Frontier</span><br /><span className={styles.step2}>Intelligence</span><br /><span className={styles.step3}>For the Grid</span></h1>
          <p className={styles.heroSub}>Planning, de-risking, and accelerating the most critical electrical infrastructure operations</p>
          <form className={`${styles.heroForm} ${styles.step6}`} action="https://app.steinmetz.ai" method="get">
            <EmailInput />
            <button type="submit" className={styles.heroFormBtn}>
              <span className={styles.heroFormBtnText}>Get a demo<svg className={styles.heroCtaArrow} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            </button>
          </form>
        </div>

        <div className={styles.heroCube}>
          <HeroAnimationLoader />
        </div>
      </section>

    </div>
  )
}

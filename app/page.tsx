/* eslint-disable @next/next/no-img-element */
import HeroAnimationLoader from './components/HeroAnimationLoader'
import NavScrollClass from './components/NavScrollClass'
import AnnouncementBanner from './components/AnnouncementBanner'
import styles from './page.module.css'

export default function HomePage() {
  return (
    <div className={styles.page}>
      <AnnouncementBanner />
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
          <a href="/login" className={`${styles.navCta} ${styles.navCtaLight}`}><span className={styles.navCtaText}>Log in</span></a>
          <a href="/login" className={styles.navCta}><span className={styles.navCtaText}>Book a demo</span></a>
        </div>
      </nav>

      <section className={styles.hero}>
        <div className={styles.axisY} />
        <div className={styles.axisX} />

        <div className={styles.heroContent}>
          <span className={styles.heroLabel}></span>
          <h1 className={styles.heroTitle}><span className={styles.step1}>Frontier</span><br /><span className={styles.step2}>Intelligence</span><br /><span className={styles.step3}>For the Grid</span></h1>
          <p className={styles.heroSub}><span className={styles.step4}>Planning, de-risking, and accelerating</span><br /><span className={styles.step5}>the most critical electrical infrastructure projects</span></p>
          <a href="https://app.steinmetz.ai" className={`${styles.heroCta} ${styles.step6}`}><span className={styles.heroCtaText}>Try Steinmetz 1.1<svg className={styles.heroCtaArrow} width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span></a>
        </div>

        <div className={styles.heroCube}>
          <HeroAnimationLoader />
        </div>
      </section>

    </div>
  )
}

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

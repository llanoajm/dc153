/* eslint-disable @next/next/no-img-element */
import HeroAnimationLoader from './components/HeroAnimationLoader'
import styles from './page.module.css'

export default function HomePage() {
  return (
    <div className={styles.page}>
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
          <p className={styles.heroSub}><span className={styles.step4}>Powering the most ambitious</span><br /><span className={styles.step5}>electrical infrastructure projects</span></p>
          <a href="/login" className={`${styles.heroCta} ${styles.step6}`}><span className={styles.heroCtaText}>Try Curie OS</span></a>
        </div>

        <div className={styles.heroCube}>
          <HeroAnimationLoader />
        </div>
      </section>
    </div>
  )
}

/* eslint-disable @next/next/no-img-element */
import HeroAnimationLoader from './components/HeroAnimationLoader'
import ScrollCards from './components/ScrollCards'
import NavScrollClass from './components/NavScrollClass'
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
          <p className={styles.heroSub}><span className={styles.step4}>Powering the most critical electrical</span><br /><span className={styles.step5}>infrastructure projects</span></p>
          <a href="https://app.steinmetz.ai" className={`${styles.heroCta} ${styles.step6}`}><span className={styles.heroCtaText}>Try Steinmetz 1.1</span></a>
        </div>

        <div className={styles.heroCube}>
          <HeroAnimationLoader />
        </div>
      </section>

      <ScrollCards />

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <div className={styles.footerBrand}>
            <svg className={styles.footerMark} viewBox="0 0 460 393" fill="none" aria-hidden="true">
              <path d="M 113.5,78.6 C 61.2,114.5 17.0,145.1 15.3,146.5 C 13.4,148.0 12.0,150.0 12.0,151.2 C 12.0,152.7 98.1,293.7 121.5,330.5 C 122.2,331.6 142.6,343.4 166.8,356.8 C 208.8,380.0 211.0,381.1 213.5,379.8 C 217.2,378.0 442.0,226.1 444.8,223.7 C 446.0,222.6 447.0,220.5 447.0,219.1 C 447.0,217.3 427.9,187.5 389.1,128.5 L 331.2,40.5 L 273.4,26.8 C 241.5,19.3 213.9,13.1 212.0,13.1 C 209.0,13.2 194.0,23.2 113.5,78.6 Z" stroke="currentColor" strokeWidth="8" strokeLinejoin="round" />
              <path d="M 334.9,69.7 C 339.8,77.3 343.8,83.5 343.7,83.6 C 343.6,83.7 329.1,93.1 311.5,104.5 C 293.9,115.9 272.1,130.2 263.0,136.1 C 253.9,142.0 225.6,160.5 200.0,177.2 C 158.1,204.5 153.5,207.8 153.2,210.4 C 152.9,212.7 156.0,218.1 169.4,238.2 C 179.7,253.5 187.0,263.5 188.5,264.2 C 190.4,265.0 191.5,264.9 194.0,263.4 C 195.7,262.3 222.0,244.8 252.5,224.3 L 307.9,187.1 L 333.6,225.2 C 347.7,246.1 359.3,263.9 359.4,264.6 C 359.5,266.3 214.1,364.5 213.0,363.4 C 211.8,362.1 202.0,345.0 202.0,344.1 C 202.0,343.7 230.4,324.4 265.0,301.1 C 317.0,266.3 328.0,258.5 327.9,256.7 C 327.9,255.5 322.9,247.1 316.7,238.0 C 307.7,224.7 305.0,221.4 303.0,221.2 C 301.0,221.0 285.7,230.8 238.5,262.4 L 176.6,304.0 L 172.7,297.7 C 170.5,294.3 167.6,289.6 166.1,287.2 C 162.6,281.6 155.7,270.7 147.8,258.5 C 136.5,241.0 112.0,201.1 112.1,200.3 C 112.1,199.4 324.0,56.0 325.2,56.0 C 325.6,56.0 330.0,62.2 334.9,69.7 Z" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" />
              <path d="M 73.9,190.0 L 98.3,203.5 L 145.1,279.0 C 170.8,320.5 191.7,354.6 191.5,354.8 C 191.4,354.9 177.9,347.7 161.5,338.6 L 131.7,322.1 L 84.8,246.4 C 59.1,204.8 38.0,170.6 38.0,170.4 C 38.0,170.2 40.6,171.4 43.7,173.2 C 46.9,175.0 60.5,182.5 73.9,190.0 Z" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" />
              <path d="M 386.3,189.0 C 391.1,196.1 395.0,202.3 395.0,202.7 C 395.0,203.5 369.7,220.5 368.6,220.5 C 368.3,220.5 364.0,214.4 359.0,207.1 L 350.1,193.6 L 363.3,184.8 C 370.6,180.0 376.8,176.0 377.1,176.0 C 377.4,176.0 381.6,181.8 386.3,189.0 Z" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" />
            </svg>
            <span className={styles.footerWord}>Steinmetz</span>
            <span className={styles.footerSep} aria-hidden="true">|</span>
            <span className={styles.footerTag}>Power Infrastructure</span>
          </div>
          <nav className={styles.footerNav}>
            <a href="#" className={styles.footerLink}>Research</a>
            <a href="#" className={styles.footerLink}>Platform</a>
            <a href="#" className={styles.footerLink}>Solutions</a>
            <a href="/login" className={styles.footerLink}>Contact</a>
          </nav>
        </div>
        <div className={styles.footerRule} />
        <div className={styles.footerBottom}>
          <span className={styles.footerCopy}>© 2026 Steinmetz Power Infrastructure</span>
          <div className={styles.footerLegal}>
            <a href="#" className={styles.footerLink}>Privacy</a>
            <a href="#" className={styles.footerLink}>Terms</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

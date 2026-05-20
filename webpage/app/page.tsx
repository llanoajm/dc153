import styles from './page.module.css'

export default function HomePage() {
  return (
    <div className={styles.page}>
      <div className={styles.lockup}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.mark} src="/spi-mark-filled.png" alt="Steinmetz mark" />
        <div className={styles.word}>Steinmetz</div>
      </div>
      <footer className={styles.footer}>
        Steinmetz Power Infrastructure &copy; 2026
      </footer>
    </div>
  )
}

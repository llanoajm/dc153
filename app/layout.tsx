import type { Metadata } from 'next'
import { Sora, Space_Grotesk } from 'next/font/google'
import './globals.css'

const sora = Sora({
  subsets: ['latin'],
  weight: ['100', '200', '300', '400', '500', '600', '700'],
  variable: '--font-sora',
})

const grotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-grotesk',
})

export const metadata: Metadata = {
  title: 'Steinmetz',
  icons: { icon: '/spi-mark-filled.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${grotesk.variable}`}>
      <body>{children}</body>
    </html>
  )
}

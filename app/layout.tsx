import type { Metadata } from "next"
import { Sora, EB_Garamond } from "next/font/google"
import "./globals.css"

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
})

const garamond = EB_Garamond({
  variable: "--font-garamond",
  subsets: ["latin"],
  weight: ["400"],
})

export const metadata: Metadata = {
  title: "Steinmetz",
  description: "Steinmetz Power Infrastructure",
  icons: { icon: "/spi-mark-filled.png" },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${garamond.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}

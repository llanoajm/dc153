import Link from "next/link"
import { Lockup } from "@/components/lockup"

export default function LandingPage() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center bg-white text-black px-6">
      <div className="flex flex-col items-center gap-10">
        <Lockup size="lg" />
        <div className="flex items-center gap-6 text-[13px] sm:text-[14px] font-mark tracking-wider">
          <Link
            href="/login"
            className="border border-black px-5 py-2 hover:bg-black hover:text-white transition"
          >
            Sign in
          </Link>
        </div>
      </div>
      <footer className="fixed bottom-6 inset-x-0 text-center font-serif-soft text-[13px] sm:text-[15px] leading-none">
        Steinmetz Power Infrastructure &copy; 2026
      </footer>
    </main>
  )
}

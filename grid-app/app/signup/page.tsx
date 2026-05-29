import Link from "next/link"
import { Lockup } from "@/components/lockup"

export default function SignUpPage() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center bg-white text-black px-6">
      <div className="flex flex-col items-center gap-10 w-full max-w-sm text-center">
        <Lockup size="md" />
        <div className="flex flex-col gap-3">
          <h1 className="font-mark tracking-wider text-sm uppercase text-black/70">
            Closed beta
          </h1>
          <p className="font-soft text-[15px] leading-relaxed text-black/85">
            Steinmetz isn&apos;t open for self-signup yet. If you&apos;ve been
            invited, the credentials were sent to you directly.
          </p>
          <p className="font-soft text-[14px] text-black/60">
            Need access? Email{" "}
            <a
              href="mailto:llanocook@gmail.com?subject=Steinmetz%20access"
              className="underline underline-offset-4"
            >
              llanocook@gmail.com
            </a>
            .
          </p>
        </div>
        <Link
          href="/login"
          className="bg-black text-white px-5 py-2.5 text-sm font-mark tracking-wider"
        >
          Sign in
        </Link>
      </div>
      <footer className="fixed bottom-6 inset-x-0 text-center font-soft text-[13px]">
        Steinmetz Power Infrastructure &copy; 2026
      </footer>
    </main>
  )
}

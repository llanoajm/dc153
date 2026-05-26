import Link from "next/link"
import { Lockup } from "@/components/lockup"
import { listExistingDemos } from "@/lib/demos"

export const dynamic = "force-dynamic"

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function DemosPage() {
  const clips = listExistingDemos()
  const available = clips.filter((c) => c.available)
  const missing = clips.filter((c) => !c.available)

  return (
    <div className="flex-1 flex flex-col bg-white text-black min-h-0">
      <header className="border-b border-black/10 px-6 py-3 flex items-center justify-between shrink-0">
        <Link href="/" className="block">
          <Lockup size="sm" />
        </Link>
        <Link
          href="/app"
          className="text-xs font-mark tracking-wider text-black/60 hover:text-black"
        >
          Open app
        </Link>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-8">
          <div>
            <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
              Demos
            </div>
            <h1 className="font-serif-soft text-2xl mt-1">Validated-flow walkthroughs</h1>
            <p className="text-sm font-serif-soft text-black/60 mt-2 max-w-prose">
              One short recording per validated flow from the Phase F.10 Playwright suite.
              Clips are produced by{" "}
              <span className="font-mono text-black/80">
                npx playwright test --config=playwright.demos.config.ts
              </span>{" "}
              and served from{" "}
              <span className="font-mono text-black/80">/demos/&lt;slug&gt;.webm</span>.
            </p>
          </div>

          {available.length === 0 ? (
            <div className="border border-dashed border-black/15 px-4 py-12 text-center text-sm font-serif-soft text-black/50">
              No recordings on disk yet. Run{" "}
              <span className="font-mono">
                npx playwright test --config=playwright.demos.config.ts
              </span>{" "}
              against a live dev stack to populate{" "}
              <span className="font-mono">public/demos/</span>.
            </div>
          ) : (
            <ul className="space-y-8">
              {available.map((clip) => (
                <li key={clip.slug} className="border-t border-black/10 pt-6">
                  <div className="flex items-baseline justify-between gap-4">
                    <div>
                      <h2 className="font-serif-soft text-lg text-black">{clip.title}</h2>
                      <div className="text-[11px] font-mark tracking-wider uppercase text-black/40 mt-0.5">
                        {clip.flow}
                      </div>
                    </div>
                    <div className="text-[11px] font-mono text-black/40 shrink-0">
                      {formatBytes(clip.sizeBytes)} · {clip.slug}.webm
                    </div>
                  </div>
                  <p className="text-sm font-serif-soft text-black/70 mt-2 max-w-prose">
                    {clip.description}
                  </p>
                  <video
                    className="mt-3 w-full max-w-3xl border border-black/10 bg-black"
                    src={`/demos/${clip.slug}.webm`}
                    controls
                    preload="metadata"
                    playsInline
                  />
                </li>
              ))}
            </ul>
          )}

          {missing.length > 0 ? (
            <div className="border-t border-black/10 pt-6">
              <div className="text-[11px] font-mark tracking-wider uppercase text-black/40">
                Awaiting recording
              </div>
              <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono text-black/50">
                {missing.map((m) => (
                  <li key={m.slug}>{m.slug}.webm — {m.title}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

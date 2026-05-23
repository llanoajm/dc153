import Link from "next/link"
import { getArtifact } from "@/lib/artifacts"
import { RunView } from "@/components/runs/RunView"
import type { Artifact } from "@/lib/artifacts"

export default async function CompareRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>
}) {
  const sp = await searchParams
  const aId = sp.a
  const bId = sp.b

  if (!aId || !bId) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-3">
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Compare runs
          </div>
          <p className="font-serif-soft text-sm text-black/70">
            Provide <code className="font-mono">?a=&lt;run-id&gt;&amp;b=&lt;run-id&gt;</code>, or pick
            two runs from the runs panel.
          </p>
          <Link
            href="/app/runs"
            className="text-xs font-mark tracking-wider underline text-black/70"
          >
            ← runs panel
          </Link>
        </div>
      </div>
    )
  }

  const [a, b] = await Promise.all([getArtifact(aId), getArtifact(bId)])

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[88rem] mx-auto w-full px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
              Compare runs
            </div>
            <h1 className="font-serif-soft text-2xl mt-1">Side-by-side</h1>
          </div>
          <Link
            href="/app/runs"
            className="text-xs font-mark tracking-wider text-black/60 hover:text-black"
          >
            ← all runs
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CompareSide label="A" artifact={a} />
          <CompareSide label="B" artifact={b} />
        </div>
      </div>
    </div>
  )
}

function CompareSide({ label, artifact }: { label: string; artifact: Artifact | null }) {
  if (!artifact) {
    return (
      <div className="border border-black/10 p-6 space-y-2">
        <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
          Side {label}
        </div>
        <div className="text-sm font-serif-soft text-black/60">
          Run not found or you don&apos;t have access.
        </div>
      </div>
    )
  }
  if (artifact.kind !== "run") {
    return (
      <div className="border border-black/10 p-6 space-y-2">
        <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
          Side {label}
        </div>
        <div className="text-sm font-serif-soft text-black/60">
          Artifact <code className="font-mono">{artifact.id}</code> has kind{" "}
          <code className="font-mono">{artifact.kind}</code>, not a run.
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Side {label}
          </div>
          <div className="font-serif-soft text-lg leading-tight">{artifact.name}</div>
          {artifact.slug ? (
            <div className="font-mono text-[11px] text-black/40">{artifact.slug}</div>
          ) : null}
        </div>
        <Link
          href={`/app/runs/${artifact.id}`}
          className="text-[11px] font-mark tracking-wider underline text-black/70"
        >
          view →
        </Link>
      </div>
      <RunView artifact={artifact} compact />
    </div>
  )
}

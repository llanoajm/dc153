import Link from "next/link"
import { notFound } from "next/navigation"
import { getArtifact } from "@/lib/artifacts"
import { RunView } from "@/components/runs/RunView"

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const artifact = await getArtifact(id)
  if (!artifact) notFound()
  if (artifact.kind !== "run") {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-3">
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Not a run
          </div>
          <p className="font-serif-soft text-sm text-black/70">
            Artifact <code className="font-mono">{artifact.id}</code> has kind{" "}
            <code className="font-mono">{artifact.kind}</code>, not <code className="font-mono">run</code>.
          </p>
          <Link
            href={`/app/artifacts/${artifact.id}`}
            className="text-xs font-mark tracking-wider underline text-black/70"
          >
            view as generic artifact →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
              run · {artifact.status}
            </div>
            <h1 className="font-serif-soft text-2xl mt-1">{artifact.name}</h1>
            {artifact.slug ? (
              <div className="font-mono text-[11px] text-black/40 mt-1">{artifact.slug}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/app/runs"
              className="text-xs font-mark tracking-wider text-black/60 hover:text-black"
            >
              ← all runs
            </Link>
          </div>
        </div>

        <RunView artifact={artifact} />

        <details className="text-[11px] font-mono pt-4 border-t border-black/10">
          <summary className="cursor-pointer text-black/50">artifact row</summary>
          <pre className="mt-2 p-3 bg-black/[0.04] overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(artifact, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  )
}

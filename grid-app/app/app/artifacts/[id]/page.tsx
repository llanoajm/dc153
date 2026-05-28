import Link from "next/link"
import { notFound } from "next/navigation"
import { getArtifact } from "@/lib/artifacts"
import { ArtifactRenderer, rendererFor } from "@/components/renderers"
import { LineageStrip } from "@/components/features/LineageStrip"
import { isPinnableArtifact, isPanelArtifact, isPinned } from "@/lib/dashboards"
import { PinButton } from "@/components/dashboards/PinButton"
import { PanelReviewStrip } from "@/components/panels/PanelReviewStrip"
import { PromoteToSkillButton } from "@/components/panels/PromoteToSkillButton"

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const artifact = await getArtifact(id)
  if (!artifact) notFound()

  const renderer = rendererFor(artifact)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
              {artifact.kind} · {renderer} · {artifact.status}
            </div>
            <h1 className="font-soft text-2xl mt-1">{artifact.name}</h1>
            {artifact.slug ? (
              <div className="font-mono text-[11px] text-black/40 mt-1">{artifact.slug}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-4">
            {isPanelArtifact(artifact) ? (
              <PromoteToSkillButton artifact={artifact} />
            ) : null}
            {isPinnableArtifact(artifact) ? (
              <PinButton id={artifact.id} initialPinned={isPinned(artifact)} size="md" />
            ) : null}
            <Link
              href="/app"
              className="text-xs font-mark tracking-wider text-black/60 hover:text-black"
            >
              ← back to chat
            </Link>
          </div>
        </div>

        <LineageStrip artifact={artifact} />

        {isPanelArtifact(artifact) ? <PanelReviewStrip artifact={artifact} /> : null}

        <ArtifactRenderer artifact={artifact} />

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

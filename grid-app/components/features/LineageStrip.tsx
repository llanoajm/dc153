import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import type { Artifact } from "@/lib/artifacts"

// LineageStrip — small server component that renders the chain of artifacts
// connected to the one being viewed (ROADMAP §2 provenance / §4 draft
// lineage). For a feature artifact we show its source document parent and the
// heading the intake drafter latched onto; for a source_document we show the
// feature drafts it spawned. Quiet when there's nothing to show.
export async function LineageStrip({ artifact }: { artifact: Artifact }) {
  const supabase = await createClient()

  // Parent direction: feature → source_document.
  let parent: Artifact | null = null
  if (artifact.parent_id) {
    const { data } = await supabase
      .from("artifacts")
      .select("*")
      .eq("id", artifact.parent_id)
      .maybeSingle()
    parent = (data as Artifact | null) ?? null
  }

  // Child direction: source_document → drafted features (we only show this
  // chunk on a source_document; otherwise it's noise).
  let children: Artifact[] = []
  if (artifact.kind === "source_document") {
    const { data } = await supabase
      .from("artifacts")
      .select("*")
      .eq("parent_id", artifact.id)
      .eq("kind", "feature")
      .order("created_at", { ascending: true })
    children = (data ?? []) as Artifact[]
  }

  if (!parent && children.length === 0) return null

  const meta = (artifact.metadata ?? {}) as Record<string, unknown>
  const heading = typeof meta.heading === "string" ? meta.heading : null

  return (
    <div className="border border-black/10 bg-black/[0.02] px-4 py-3 space-y-2">
      <div className="text-[10px] font-mark tracking-wider uppercase text-black/40">
        Lineage
      </div>
      {parent ? (
        <div className="text-[12px] font-soft text-black/70">
          <span className="text-black/40">from </span>
          <Link href={`/app/artifacts/${parent.id}`} className="underline">
            {parent.name}
          </Link>
          <span className="text-black/40"> · {parent.kind}</span>
          {heading ? (
            <span className="text-black/40">
              {" "}
              · heading: <em>{heading}</em>
            </span>
          ) : null}
        </div>
      ) : null}
      {children.length > 0 ? (
        <div className="text-[12px] font-soft text-black/70">
          <span className="text-black/40">drafted objectives: </span>
          <ul className="mt-1 space-y-0.5">
            {children.map((c) => (
              <li key={c.id} className="font-mono text-[11px]">
                <Link
                  href={`/app/artifacts/${c.id}`}
                  className="underline text-black/80"
                >
                  {c.slug ?? c.name}
                </Link>
                <span className="text-black/40"> · {c.status}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/app/features"
            className="text-[11px] underline text-black/60 mt-1 inline-block"
          >
            manage drafts →
          </Link>
        </div>
      ) : null}
    </div>
  )
}

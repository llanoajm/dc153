import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import type { Artifact } from "@/lib/artifacts"
import { validatePanelSpec, PANEL_COMPONENTS } from "@/lib/view-specs/panel"
import { DiffRenderer } from "@/components/renderers/diff"

// Server component shown on the artifact view page for `kind='panel'`
// artifacts. Gives the user / reviewer an at-a-glance check of:
//   - structural validity (validatePanelSpec)
//   - which components the panel uses (so an out-of-allowlist node is obvious
//     before pinning)
//   - a JSON diff against the parent panel if one exists (the agent should
//     create new panels with `parent_id` pointing at the previous version so
//     edits are reviewable)
//
// The strip is intentionally read-only — pin / promote actions live in the
// page header next to the artifact title.
export async function PanelReviewStrip({ artifact }: { artifact: Artifact }) {
  const spec = artifact.view_spec ?? {}
  const validationError = validatePanelSpec(spec)
  const components = collectComponents(spec)
  const unknown = components.filter(
    (c) => !(PANEL_COMPONENTS as readonly string[]).includes(c),
  )
  const parent = artifact.parent_id ? await fetchParent(artifact.parent_id) : null

  return (
    <div className="border border-black/10 bg-black/[0.015] p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mark text-[11px] tracking-wider uppercase text-black/60">
          Panel review
        </div>
        <div className="font-mono text-[10px] text-black/40">
          status: {artifact.status}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <Stat
          label="Validation"
          value={validationError ? "FAIL" : "ok"}
          tone={validationError ? "warn" : "ok"}
          detail={validationError ?? "no structural errors"}
        />
        <Stat
          label="Components used"
          value={String(components.length)}
          tone={unknown.length === 0 ? "ok" : "warn"}
          detail={components.join(", ") || "none"}
        />
        <Stat
          label="Out-of-allowlist"
          value={String(unknown.length)}
          tone={unknown.length === 0 ? "ok" : "warn"}
          detail={unknown.length === 0 ? "all components allowlisted" : unknown.join(", ")}
        />
      </div>

      {parent ? (
        <details className="border-t border-black/10 pt-3">
          <summary className="cursor-pointer text-[11px] font-mark tracking-wider uppercase text-black/60">
            Diff vs.{" "}
            <Link
              href={`/app/artifacts/${parent.id}`}
              className="underline decoration-dotted hover:text-black"
            >
              previous version
            </Link>
          </summary>
          <div className="mt-3">
            <DiffRenderer
              artifact={{
                ...artifact,
                view_spec: {
                  renderer: "diff",
                  before: JSON.stringify(parent.view_spec ?? {}, null, 2),
                  after: JSON.stringify(artifact.view_spec ?? {}, null, 2),
                },
              }}
            />
          </div>
        </details>
      ) : null}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  detail,
}: {
  label: string
  value: string
  tone: "ok" | "warn"
  detail: string
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-amber-300 bg-amber-50 text-amber-700"
  return (
    <div className={`border px-3 py-2 ${toneClass}`}>
      <div className="font-mark text-[10px] tracking-wider uppercase opacity-80">
        {label}
      </div>
      <div className="font-mono text-base tabular-nums">{value}</div>
      <div className="font-mono text-[10px] opacity-70 break-words">{detail}</div>
    </div>
  )
}

function collectComponents(spec: unknown): string[] {
  const out = new Set<string>()
  walk((spec as { root?: unknown })?.root, out)
  return Array.from(out)
}

function walk(node: unknown, out: Set<string>) {
  if (!node || typeof node !== "object") return
  const n = node as { type?: unknown; children?: unknown }
  if (typeof n.type === "string") out.add(n.type)
  if (Array.isArray(n.children)) {
    for (const c of n.children) walk(c, out)
  }
}

async function fetchParent(id: string): Promise<Artifact | null> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from("artifacts")
      .select("*")
      .eq("id", id)
      .maybeSingle()
    return (data as Artifact | null) ?? null
  } catch {
    return null
  }
}

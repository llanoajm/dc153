import Link from "next/link"
import { listPanels } from "@/lib/dashboards"
import type { Artifact } from "@/lib/artifacts"
import { PinButton } from "@/components/dashboards/PinButton"

// Index of sandboxed agent-authored panels (ROADMAP §11.8). The promotion
// ladder runs ephemeral (chat output) → pinned (rail entry) → callable skill
// (SKILL.md). This page surfaces every panel artifact the caller can see so a
// reviewer can pick one, jump into the artifact view to inspect the diff, and
// pin it without spelunking through chat history.
export default async function PanelsIndexPage() {
  const rows = await listPanels()
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-6">
        <div>
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Panels
          </div>
          <h1 className="font-soft text-2xl mt-1">Sandboxed custom panels</h1>
          <p className="text-sm font-soft text-black/60 mt-2 max-w-prose">
            Agent-authored mini UIs rendered inside the workspace. Open one to
            review its diff against the prior version, pin it to the left rail,
            or promote it to a callable skill.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="border border-dashed border-black/15 px-4 py-12 text-center text-sm font-soft text-black/50">
            No panels yet. The agent can save one any time by writing an
            artifact with <span className="font-mono">kind=&quot;panel&quot;</span> and a{" "}
            <span className="font-mono">root</span> node on{" "}
            <span className="font-mono">view_spec</span>.
          </div>
        ) : (
          <ul className="divide-y divide-black/10 border-y border-black/10">
            {rows.map((a) => (
              <PanelRow key={a.id} panel={a} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function PanelRow({ panel }: { panel: Artifact }) {
  const pinned = panel.metadata?.pinned === true
  const promoted = panel.metadata?.promoted_to_skill === true
  const view = (panel.view_spec ?? {}) as {
    root?: { type?: string }
    state?: Record<string, unknown>
  }
  const componentsUsed = collectComponentNames(view.root)
  const stateKeys = view.state ? Object.keys(view.state).length : 0
  return (
    <li className="py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <Link
          href={`/app/artifacts/${panel.id}`}
          className="block hover:bg-black/[0.03] -mx-2 px-2 py-1"
        >
          <div className="font-soft text-base text-black flex items-center gap-2">
            {panel.name}
            {promoted ? (
              <span className="text-[9px] font-mark tracking-wider uppercase border border-emerald-300 text-emerald-700 bg-emerald-50 px-1.5 py-0.5">
                skill
              </span>
            ) : null}
          </div>
          <div className="text-[11px] font-mono text-black/50 mt-0.5">
            {panel.kind} · {componentsUsed.length} component
            {componentsUsed.length === 1 ? "" : "s"} · {stateKeys} state key
            {stateKeys === 1 ? "" : "s"} · {panel.status}
          </div>
        </Link>
      </div>
      <PinButton id={panel.id} initialPinned={pinned} />
    </li>
  )
}

function collectComponentNames(root: unknown): string[] {
  const out = new Set<string>()
  walk(root, out)
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

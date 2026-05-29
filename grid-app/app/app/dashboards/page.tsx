import Link from "next/link"
import { listDashboards } from "@/lib/dashboards"
import type { Artifact } from "@/lib/artifacts"
import { PinButton } from "@/components/dashboards/PinButton"

export default async function DashboardsIndexPage() {
  const rows = await listDashboards()
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-6">
        <div>
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Dashboards
          </div>
          <h1 className="font-soft text-2xl mt-1">Agent-authored layouts</h1>
          <p className="text-sm font-soft text-black/60 mt-2 max-w-prose">
            Saved compositions of charts, tables, networks, and maps. Pin one
            and it shows up in the left rail for one-click recall.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="border border-dashed border-black/15 px-4 py-12 text-center text-sm font-soft text-black/50">
            No dashboards yet. The agent can save one any time by writing an
            artifact with <span className="font-mono">kind=&quot;view&quot;</span> and a panels
            list on <span className="font-mono">view_spec</span>.
          </div>
        ) : (
          <ul className="divide-y divide-black/10 border-y border-black/10">
            {rows.map((a) => (
              <DashboardRow key={a.id} dashboard={a} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function DashboardRow({ dashboard }: { dashboard: Artifact }) {
  const pinned = dashboard.metadata?.pinned === true
  const panelCount = Array.isArray(
    (dashboard.view_spec as { panels?: unknown[] })?.panels,
  )
    ? ((dashboard.view_spec as { panels?: unknown[] }).panels as unknown[]).length
    : 0
  return (
    <li className="py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <Link
          href={`/app/artifacts/${dashboard.id}`}
          className="block hover:bg-black/[0.03] -mx-2 px-2 py-1"
        >
          <div className="font-soft text-base text-black">{dashboard.name}</div>
          <div className="text-[11px] font-mono text-black/50 mt-0.5">
            {dashboard.kind} · {panelCount} panel{panelCount === 1 ? "" : "s"} · {dashboard.status}
          </div>
        </Link>
      </div>
      <PinButton id={dashboard.id} initialPinned={pinned} />
    </li>
  )
}

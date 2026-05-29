import fs from "node:fs/promises"
import path from "node:path"
import { createClient } from "@/lib/supabase/server"
import { ensureUserWorkspace } from "@/lib/user-workspace"
import { getActiveOrgId, listMyOrgs, syncOrgContextOverlays } from "@/lib/orgs"
import { MarkdownRenderer } from "@/components/renderers/markdown"
import { redirect } from "next/navigation"

// Workspace-level glossary + company-context viewer (ROADMAP §3). Reads the
// live files from the user's workspace — the same files opencode loads as
// system context via the `instructions:` array in `.opencode/opencode.jsonc`.
// Org overlays (ROADMAP §10) appear above the personal docs so the user can
// audit the full layered stack.
export default async function GlossaryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login?next=/app/glossary")

  const workspace = await ensureUserWorkspace(user.id)
  // Make sure the overlay files on disk reflect the current org canonicals
  // (in case org content changed since the last /app load).
  try {
    await syncOrgContextOverlays(workspace)
  } catch {
    // best-effort
  }
  const memberships = await listMyOrgs()
  const activeOrgId = await getActiveOrgId()
  const activeMembership = memberships.find((m) => m.org_id === activeOrgId) ?? null
  const glossaryPath = path.join(workspace, "glossary.md")
  const contextPath = path.join(workspace, "company-context.md")
  const [glossary, context] = await Promise.all([
    readSafely(glossaryPath),
    readSafely(contextPath),
  ])

  // Only the active org's overlay is loaded into the agent session (HARDENING
  // §1.3), so this viewer only shows that one. The org switcher in the
  // workspace header flips which org is active.
  const orgPanes = activeMembership
    ? await (async () => {
        const m = activeMembership
        const gp = path.join(workspace, `glossary.org.${m.org.slug}.md`)
        const cp = path.join(workspace, `company-context.org.${m.org.slug}.md`)
        const [g, c] = await Promise.all([readSafely(gp), readSafely(cp)])
        return [
          {
            slug: m.org.slug,
            name: m.org.name,
            glossaryPath: gp,
            contextPath: cp,
            glossary: g,
            context: c,
          },
        ]
      })()
    : []

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto w-full px-6 py-8 space-y-8">
        <div>
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Glossary &amp; Context
          </div>
          <h1 className="font-soft text-2xl mt-1">What the agent sees</h1>
          <p className="font-soft text-sm text-black/60 mt-2 max-w-prose">
            These files are auto-loaded as system context every opencode
            session (configured via{" "}
            <code className="font-mono text-[11px]">.opencode/opencode.jsonc</code>
            {" → "}
            <code className="font-mono text-[11px]">instructions</code>). Org
            content loads first; your personal docs layer on top. Upload PDFs
            under <a className="underline" href="/app/sources">Sources</a> to
            grow the personal docs, or open{" "}
            <a className="underline" href="/app/orgs">Orgs</a> to edit the
            shared org docs.
          </p>
        </div>

        {orgPanes.map((o) => (
          <section key={o.slug} className="space-y-3">
            <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
              From org: {o.name}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <DocPane
                title={`glossary.org.${o.slug}.md`}
                path={o.glossaryPath}
                content={o.glossary}
              />
              <DocPane
                title={`company-context.org.${o.slug}.md`}
                path={o.contextPath}
                content={o.context}
              />
            </div>
          </section>
        ))}

        <section className="space-y-3">
          {orgPanes.length > 0 ? (
            <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
              Personal (layered on top)
            </div>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DocPane title="glossary.md" path={glossaryPath} content={glossary} />
            <DocPane title="company-context.md" path={contextPath} content={context} />
          </div>
        </section>
      </div>
    </div>
  )
}

function DocPane({
  title,
  path: filePath,
  content,
}: {
  title: string
  path: string
  content: string
}) {
  return (
    <section className="border border-black/10">
      <header className="px-4 py-2 border-b border-black/10 bg-black/[0.03] flex items-center justify-between">
        <span className="font-mono text-[12px] text-black/80">{title}</span>
        <span className="font-mono text-[10px] text-black/40 truncate ml-2">{filePath}</span>
      </header>
      <div className="p-4">
        {content ? (
          <MarkdownRenderer
            artifact={{
              id: "ws-" + title,
              user_id: null,
              org_id: null,
              kind: "markdown",
              name: title,
              slug: null,
              fs_path: null,
              storage_path: null,
              metadata: {},
              view_spec: { text: content },
              parent_id: null,
              parent_session_id: null,
              status: "draft",
              created_at: "",
              updated_at: "",
            }}
          />
        ) : (
          <div className="text-sm font-soft text-black/50">
            Empty. Upload a PDF in Sources to populate this file.
          </div>
        )}
      </div>
    </section>
  )
}

async function readSafely(p: string): Promise<string> {
  try {
    return await fs.readFile(p, "utf8")
  } catch {
    return ""
  }
}

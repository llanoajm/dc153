import { NextRequest, NextResponse } from "next/server"
import fs from "node:fs/promises"
import path from "node:path"
import { createClient } from "@/lib/supabase/server"
import { getArtifact, createArtifact } from "@/lib/artifacts"
import { ensureUserWorkspace } from "@/lib/user-workspace"
import { recordAudit } from "@/lib/audit"
import { isPanelArtifact } from "@/lib/dashboards"
import { PANEL_COMPONENTS } from "@/lib/view-specs/panel"

// POST /api/artifacts/<id>/promote-skill
//
// Promotion-ladder rung 3 (ROADMAP §11.8): a panel artifact becomes a
// callable skill. Concretely we:
//
//   1. Write `.opencode/skills/panel-<slug>/SKILL.md` into the user's
//      workspace. opencode auto-discovers skills from this directory on the
//      next session, so the agent can re-emit the panel from a prompt like
//      "show me the WECC hour scrubber".
//   2. Create a `skill` artifact row whose `parent_id` points at the panel,
//      so the lineage strip on the panel view page surfaces the link.
//   3. Flip `metadata.promoted_to_skill = true` on the panel for the UI.
//
// All three side-effects are best-effort and recorded in audit_log. The route
// is idempotent — re-promoting overwrites the skill file with the panel's
// current state-shape and re-asserts the metadata flag.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await ctx.params
  const artifact = await getArtifact(id)
  if (!artifact) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (!isPanelArtifact(artifact)) {
    return NextResponse.json(
      { error: "only panel artifacts can be promoted to a skill" },
      { status: 400 },
    )
  }
  if (artifact.user_id !== user.id) {
    return NextResponse.json(
      { error: "only the panel owner can promote it" },
      { status: 403 },
    )
  }

  const slug = artifact.slug ?? slugify(artifact.name) ?? artifact.id
  const safeSlug = `panel-${slug.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}`

  // 1. Write the SKILL.md.
  let skillPath: string | null = null
  try {
    const workspaceDir = await ensureUserWorkspace(user.id)
    const skillDir = path.join(workspaceDir, ".opencode", "skills", safeSlug)
    await fs.mkdir(skillDir, { recursive: true })
    skillPath = path.join(skillDir, "SKILL.md")
    await fs.writeFile(skillPath, renderSkillMarkdown(artifact, safeSlug), "utf8")
  } catch (e) {
    return NextResponse.json(
      { error: `failed to write SKILL.md: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }

  // 2. Create the `skill` artifact row.
  let skillArtifactId: string | null = null
  try {
    const skill = await createArtifact({
      kind: "skill",
      name: `${artifact.name} (panel skill)`,
      slug: safeSlug,
      fs_path: skillPath,
      parent_id: artifact.id,
      status: "canonical",
      metadata: {
        source_panel_id: artifact.id,
        skill_kind: "panel",
        skill_path: skillPath,
      },
      view_spec: {
        renderer: "markdown",
      },
    })
    skillArtifactId = skill.id
  } catch (e) {
    console.warn("[promote-skill] artifact insert failed:", e)
  }

  // 3. Flip the panel's metadata.
  const metadata = {
    ...(artifact.metadata ?? {}),
    promoted_to_skill: true,
    skill_artifact_id: skillArtifactId,
    skill_path: skillPath,
    skill_slug: safeSlug,
  }
  const { error: patchErr } = await supabase
    .from("artifacts")
    .update({ metadata })
    .eq("id", artifact.id)
  if (patchErr) {
    console.warn("[promote-skill] metadata patch failed:", patchErr.message)
  }

  await recordAudit({
    user_id: user.id,
    org_id: artifact.org_id,
    artifact_id: artifact.id,
    action: "panel.promoted_to_skill",
    actor: "user",
    payload: { skill_path: skillPath, skill_artifact_id: skillArtifactId, slug: safeSlug },
  })

  return NextResponse.json({
    ok: true,
    skill_path: skillPath,
    skill_artifact_id: skillArtifactId,
    skill_slug: safeSlug,
  })
}

function slugify(name: string): string | null {
  if (!name) return null
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
  return s || null
}

// Produce the SKILL.md body. Opencode reads frontmatter `{ name, description }`
// and uses the body as the skill's prompt-time documentation. We list the
// state schema explicitly so the agent has a concrete callable contract.
function renderSkillMarkdown(artifact: { name: string; id: string; view_spec: Record<string, unknown> }, slug: string): string {
  const spec = artifact.view_spec
  const state = (spec.state ?? {}) as Record<string, unknown>
  const root = spec.root as { type?: string } | undefined
  const componentsUsed = collectComponents(spec)
  const description =
    typeof spec.description === "string"
      ? spec.description
      : `Re-emit the "${artifact.name}" panel.`

  const stateLines = Object.keys(state).length
    ? Object.entries(state)
        .map(([k, v]) => `- \`${k}\`: ${typeofLabel(v)} (default: ${JSON.stringify(v)})`)
        .join("\n")
    : "- (no controlled state)"

  return `---
name: ${slug}
description: ${escapeYaml(description)}
---

# ${artifact.name}

This skill emits a sandboxed panel artifact (\`kind='panel'\`) that the
Steinmetz app renders via \`components/sandbox/PanelHost.tsx\`. The original
panel was authored by the agent and promoted to a skill by the user on
${new Date().toISOString().slice(0, 10)}.

**Source panel artifact id**: \`${artifact.id}\`

## When to use

${description}

## Initial state schema

${stateLines}

## Root component

\`${root?.type ?? "Stack"}\`

## Components used

${componentsUsed.map((c) => `\`${c}\``).join(", ") || "(none)"}

## How to invoke

Write an artifact with \`kind='panel'\` and \`view_spec\` matching the schema
in \`lib/view-specs/panel.ts\`. The full allowlist of components you may use
is:

${PANEL_COMPONENTS.map((c) => `- \`${c}\``).join("\n")}

If you need to reproduce the exact source panel, you can also reference it
directly by including this artifact id in the new panel's
\`metadata.cloned_from\`: \`${artifact.id}\`. The runner does not load the
referenced panel automatically — emit a fresh \`view_spec\` each time so the
user can see the diff.

## Constraints (do not violate)

- No JSX text strings; output JSON only.
- No \`fetch\`, \`window\`, \`document\`, or arbitrary JS. The only action
  verbs you may use are \`set_state\`, \`toggle_state\`,
  \`increment_state\`, and \`open_artifact\`.
- Components outside the allowlist render an inline error and are skipped.
`
}

function typeofLabel(v: unknown): string {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  return typeof v
}

function escapeYaml(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, " ").slice(0, 280)
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

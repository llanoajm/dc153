import "server-only"
import fs from "node:fs/promises"
import path from "node:path"

const ROOT = process.env.GRID_WORKSPACE_ROOT || "/home/agent/grid-workspaces"

// Per-user workspace dir. Materialized on first access so the opencode session
// has somewhere to operate. Holds .opencode/, features/, skills/. The agent
// works here; it does NOT modify the shared zap repo.
export async function ensureUserWorkspace(userId: string): Promise<string> {
  const dir = path.join(ROOT, userId)
  await fs.mkdir(path.join(dir, ".opencode", "agent"), { recursive: true })
  await fs.mkdir(path.join(dir, ".opencode", "skills"), { recursive: true })
  await fs.mkdir(path.join(dir, "features"), { recursive: true })

  // Bootstrap idempotently.
  await writeIfMissing(
    path.join(dir, "AGENTS.md"),
    `# Your workspace

This directory is your personal Steinmetz workspace. Features you create here are
yours — they are not visible to other users and they do not modify the shared
zap library.

## What you have access to

- **zap** (read-only library): import from \`zap\` in any Python you write here.
  Available classes include \`PowerNetwork\`, \`DispatchLayer\`,
  generators/loads/lines/storage devices, planning objectives, dual problems.
- **Your features dir** (\`features/\`): the agent writes new Python modules here.
  Each feature is a self-contained \`features/<slug>.py\` that imports from zap
  and defines new objectives, constraints, devices, or analyses by subclassing
  or composition.
- **Your skills dir** (\`.opencode/skills/<slug>/SKILL.md\`): metadata about each
  feature so the agent rediscovers them in future sessions.
- **The shared venv**: \`/home/agent/zap/.venv/bin/python\` has zap installed.
  Use it for any Python you run.

## Shipping a feature

When the user asks for a new capability (e.g., "add a nitrogen-emissions
objective"), follow this lifecycle:

1. **Plan.** Identify the zap base class you'll subclass or compose with
   (most likely \`AbstractOperationObjective\` for objectives, \`AbstractDevice\`
   for device types). Do not modify zap source.
2. **Implement** the feature as \`features/<slug>.py\` — a single module that
   imports from zap and defines the new thing.
3. **Verify** with \`/home/agent/zap/.venv/bin/python -c "import sys; sys.path.insert(0, '.'); from features.<slug> import *"\`
   to confirm the module loads.
4. **Register** as a skill: write \`.opencode/skills/<slug>/SKILL.md\` with
   frontmatter \`{ name, description }\` and a body covering usage.
5. **Done.** Do not commit (this workspace is not a repo). Persistence is
   handled by the Steinmetz app, which syncs your features to durable storage.

## Style

Match zap's existing patterns when subclassing:
- attrs \`@define\` for dataclasses
- numpy + torch dual code paths for differentiable objectives
- \`is_convex\` / \`is_linear\` properties where they apply
- 100-char lines, snake_case
`,
  )

  await writeIfMissing(
    path.join(dir, ".opencode", "agent", "grid-engineer.md"),
    `---
mode: primary
description: Power-systems engineer working in your personal Steinmetz workspace
color: "#1F8FFF"
permission:
  edit: allow
  bash: allow
---

You are a power-systems engineer working in the user's personal Steinmetz workspace.

Read \`AGENTS.md\` at the workspace root before starting work. Critical rules:

- **Never modify the zap library.** zap lives at /home/agent/zap and is read-only
  shared infrastructure. Your job is to write new Python in this workspace's
  \`features/\` directory that *imports* from zap and extends it by subclassing
  or composition.
- **One feature = one \`features/<slug>.py\` + one \`.opencode/skills/<slug>/SKILL.md\`.**
  Don't sprawl a feature across multiple files unless it's genuinely needed.
- **Always use \`/home/agent/zap/.venv/bin/python\`** for any Python invocation.
- **Verify before declaring done.** At minimum, import the module you just
  wrote and confirm it loads without exception. If the feature is differentiable,
  do a tiny finite-difference check.
- **Persist as a skill.** SKILL.md is the source of truth for what features
  this user has built. Without it, the feature disappears from the UI.

Terse, technical, no filler. When uncertain about which zap base class to
extend, say so and ask — don't sprinkle the change across guesses.
`,
  )

  await writeIfMissing(
    path.join(dir, ".opencode", "opencode.jsonc"),
    `{
  "$schema": "https://opencode.ai/config.json",
  // Per-user workspace config for Steinmetz.
  // Provider/model selected via the app UI.
  "provider": {},
  "mcp": {},
  "permission": {}
}
`,
  )

  return dir
}

async function writeIfMissing(p: string, content: string): Promise<void> {
  try {
    await fs.access(p)
  } catch {
    await fs.writeFile(p, content, "utf8")
  }
}

export function workspaceRoot(): string {
  return ROOT
}

import "server-only"
import fs from "node:fs/promises"
import path from "node:path"

const ROOT = process.env.GRID_WORKSPACE_ROOT || "/home/agent/grid-workspaces"
const PY_BIN = process.env.STEINMETZ_PY || "/home/agent/zap/.venv/bin/python"
const MCP_SERVER_SCRIPT =
  process.env.STEINMETZ_MCP_SERVER ||
  path.join(process.cwd(), "scripts", "user-mcp-server.py")

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

  // Regenerate opencode.jsonc every materialization so the MCP config picks
  // up changes to the server script path (and so existing workspaces get the
  // user-features server without manual migration).
  const opencodeConfig = {
    $schema: "https://opencode.ai/config.json",
    provider: {},
    mcp: {
      "user-features": {
        type: "local",
        command: [PY_BIN, MCP_SERVER_SCRIPT],
        environment: {
          STEINMETZ_FEATURES_DIR: path.join(dir, "features"),
        },
      },
    },
    permission: {},
  }
  await fs.writeFile(
    path.join(dir, ".opencode", "opencode.jsonc"),
    JSON.stringify(opencodeConfig, null, 2) + "\n",
    "utf8",
  )

  await writeIfMissing(
    path.join(dir, "features", "example.py"),
    `"""Sample feature — exposed to the agent as MCP tools.

Drop new feature modules into this directory; each public function (one
that does not start with an underscore) becomes a typed MCP tool the agent
can call by name. Type-annotated parameters get mapped to JSON Schema; the
docstring becomes the tool description.

This file is a stub. Delete it once you have a real feature, or keep it as
a smoke-test that the per-user MCP server is wired up.
"""


def hello(name: str = "world") -> str:
    """Return a greeting. Useful for confirming the MCP server is live."""
    return f"hello, {name}, from your steinmetz workspace"


def echo(message: str) -> str:
    """Echo the supplied message back unchanged."""
    return message
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

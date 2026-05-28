import "server-only"
import fs from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { ensureLinuxAccount, shortUidFor } from "@/lib/linux-account"
import { ensureUserSlice } from "@/lib/compute-tier"
import { sanitizeBearerTokenEnv } from "@/lib/bearer-token-validation"

// Re-export so downstream items 3.2 (per-user opencode units) and 3.3
// (per-user venvs) can resolve a Linux short-uid from a supabase uid via the
// canonical workspace API.
export { shortUidFor, linuxUserFor, linuxGroup } from "@/lib/linux-account"

const ROOT = process.env.GRID_WORKSPACE_ROOT || "/home/agent/grid-workspaces"
const MCP_SERVER_SCRIPT =
  process.env.STEINMETZ_MCP_SERVER ||
  path.join(process.cwd(), "scripts", "user-mcp-server.py")

// HARDENING §3.3 — per-user Python venv.
//
// Each workspace gets its own venv at `<workspace>/.venv/`. The venv has an
// isolated site-packages so user-installed packages (`pip install` into
// either the venv or `.python_libs/`) stay scoped to one user — they cannot
// shadow another user's `import requests`, and they cannot poison the shared
// zap install. zap itself is exposed read-only to every per-user venv via a
// `.pth` file that prepends the shared zap source dir + the shared venv's
// site-packages onto sys.path. Result: both users can `import zap` and pick
// up the same already-installed deps (numpy, torch, pypsa, …), but their
// own `pip install`s land in their own venv and are invisible to each
// other.
//
// Seed interpreter (`VENV_SOURCE_PYTHON`) is used solely by
// `python -m venv --without-pip` to spawn a new venv. We deliberately do
// *not* expose a global `STEINMETZ_PY` knob anymore — production callers
// must resolve the per-user interpreter via `pyInterpreterFor(supabaseUid)`
// or `pyInterpreterForWorkspace(workspaceDir)`.
const VENV_SOURCE_PYTHON =
  process.env.STEINMETZ_VENV_SEED_PYTHON ||
  "/home/agent/zap/.venv/bin/python"
const SHARED_ZAP_SOURCE_DIR =
  process.env.STEINMETZ_ZAP_SOURCE_DIR || "/home/agent/zap"
const SHARED_ZAP_SITE_PACKAGES =
  process.env.STEINMETZ_ZAP_SITE_PACKAGES ||
  "/home/agent/zap/.venv/lib/python3.12/site-packages"

const execFileP = promisify(execFile)

// Per-user workspace dir. Materialized on first access so the opencode session
// has somewhere to operate. Holds .opencode/, features/, skills/. The agent
// works here; it does NOT modify the shared zap repo.
export async function ensureUserWorkspace(userId: string): Promise<string> {
  const dir = path.join(ROOT, userId)

  // HARDENING §3.1: once the workspace has been chowned to a per-user Linux
  // account, grid-app (running as `agent`) can no longer enter the dir to
  // mkdir/write — and shouldn't need to, because per-user opencode (3.2) and
  // per-user Python (3.3) write everything from then on. Stat the dir to
  // detect that hand-off without trying to read inside; if the uid is no
  // longer ours, treat the workspace as already provisioned and return.
  if (await isWorkspaceHandedOff(dir)) return dir

  await fs.mkdir(path.join(dir, ".opencode", "agent"), { recursive: true })
  await fs.mkdir(path.join(dir, ".opencode", "skills"), { recursive: true })
  await fs.mkdir(path.join(dir, "features"), { recursive: true })
  // Per-user pip install target (HARDENING §2.1). `pip install --target=<dir>`
  // creates this on demand, but materializing it up front means PYTHONPATH
  // always points at an existing directory and the agent's first `pip install`
  // is just an install — no mkdir surprises.
  await fs.mkdir(pythonLibsDir(dir), { recursive: true })

  // HARDENING §3.3: provision the per-user venv. Must happen *before*
  // ensureLinuxAccount() chmods the workspace 700 — once that fires,
  // grid-app (running as `agent`) can no longer write into `.venv/`.
  await ensurePerUserVenv(dir)

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
- **Your per-user venv**: \`.venv/bin/python\` (inside this workspace). zap is
  exposed read-only via a .pth file, so \`import zap\` works out of the box.
  Use this interpreter for any Python you run.
- **Your pip target** (\`.python_libs/\`): when you need a package that isn't
  in your venv or the shared zap install, install it here so it's scoped to
  your workspace.

## Installing Python packages

The shared zap install is **read-only** for end-user-mode agents — do NOT
try to write into \`/home/agent/zap\`. Install per-workspace into your own
venv or pip target:

\`\`\`bash
# Option A: install into your venv (preferred — survives across sessions)
.venv/bin/python -m ensurepip --upgrade
.venv/bin/python -m pip install <pkg>

# Option B: install into the workspace pip target
.venv/bin/python -m pip install --target=.python_libs <pkg>
\`\`\`

The Steinmetz harness adds \`.python_libs\` to \`PYTHONPATH\` for every
subprocess it spawns on your behalf, so either install path is visible from
your MCP tools and feature modules.

## Shipping a feature

When the user asks for a new capability (e.g., "add a nitrogen-emissions
objective"), follow this lifecycle:

1. **Plan.** Identify the zap base class you'll subclass or compose with
   (most likely \`AbstractOperationObjective\` for objectives, \`AbstractDevice\`
   for device types). Do not modify zap source.
2. **Implement** the feature as \`features/<slug>.py\` — a single module that
   imports from zap and defines the new thing.
3. **Verify** with \`.venv/bin/python -c "import sys; sys.path.insert(0, '.'); from features.<slug> import *"\`
   to confirm the module loads.
4. **Register** as a skill: write \`.opencode/skills/<slug>/SKILL.md\` with
   frontmatter \`{ name, description }\` and a body covering usage.
5. **Done.** Do not commit (this workspace is not a repo). Persistence is
   handled by the Steinmetz app, which syncs your features to durable storage.

## Custom importers (heterogeneous uploads)

When a user uploads a folder that is not a PyPSA CSV folder or a MATPOWER
\`.m\` case, the ingestion pipeline leaves the artifact in
\`pipeline_status='awaiting_importer'\` and writes a schema fingerprint to
\`sources/<slug>/inspection.json\`. Your job, when asked:

1. Call \`steinmetz__list_pending_imports\` (MCP tool) to discover slugs.
2. Call \`steinmetz__inspect_upload(slug)\` to see the CSV columns + sample
   rows. Use \`Read\` to peek at specific files in \`sources/<slug>/raw/\`
   if you need more.
3. Author a custom importer at \`features/import_<source-slug>.py\` exposing:

   \`\`\`python
   from pathlib import Path

   def matches(folder: Path) -> bool:
       """Return True if this importer can handle the upload at \`folder\`."""

   def convert(folder: Path, dest: Path) -> None:
       """Read raw upload at \`folder\` and write a PyPSA CSV folder to \`dest\`."""
   \`\`\`

   \`convert\` MUST write \`buses.csv\` (and ideally \`lines.csv\`,
   \`generators.csv\`, \`loads.csv\`) into \`dest\`. The easiest path is to
   build a \`pypsa.Network\` in memory and call
   \`n.export_to_csv_folder(str(dest))\`.

4. Register the importer as a skill at
   \`.opencode/skills/<source-slug>/SKILL.md\` so it survives across sessions.

   You can do steps 3+4 in one shot by calling
   \`steinmetz__write_custom_importer(slug, python_source, skill_markdown)\`.

5. Re-trigger ingestion by POSTing to
   \`/api/upload/reingest/<artifact_id>\` (the user can do this from the
   Networks panel button labeled "Retry"). The same importer will then
   handle subsequent uploads of the same format automatically because
   \`matches(folder)\` returns True for them.

## Agentic data acquisition ("pull WECC 240" / "find me an ERCOT topology")

When the user names a network you don't have yet (e.g. "pull the WECC 240-bus
network", "get me the PyPSA-Eur Germany slice"), follow this loop:

1. **Resolve.** Use \`WebSearch\` to find candidate sources. Prefer the
   project's own repository (PyPSA org on GitHub, Zenodo DOI page, ISO open
   data portals, EIA, FERC, ENTSO-E). For each candidate, capture: the
   concrete download URL, the license string (read the LICENSE file or the
   page footer), and a published checksum if one exists.
2. **Confirm with the user** when the resolution is ambiguous (multiple
   plausible sources, or you can't read a license off the page).
3. **Fetch.** Call \`steinmetz__fetch_network\` with the URL. Pass:
   - \`license\` — the SPDX-style string you found (e.g. \`"MIT"\`,
     \`"CC-BY-4.0"\`). **If you could not determine the license, leave it
     empty** — the tool will mark the artifact \`license_unknown=true\` and
     keep it \`status='draft'\`, and you must ask the user before promoting
     it to canonical.
   - \`expected_checksum\` — the SHA-256 the source publishes, if any. The
     fetch fails loudly on mismatch.
   - \`name\` — a human-readable label.
4. **Report.** Tell the user: "Got it — N buses, N lines, carriers: X.
   Source: <url>, <license>, fetched_at <iso>. Want to use it now?" The
   pipeline runs in the background; \`pipeline_status\` flips through
   \`queued → extracting → embedded → ready\` (or \`awaiting_importer\` if
   the converter chain doesn't recognize the format — in which case fall
   back to the custom-importer loop above).
5. **License capture is non-negotiable.** Never silently flip a fetched
   artifact to \`status='canonical'\` without the user's explicit yes on the
   license. The artifact carries \`metadata.source_url\`,
   \`metadata.license\`, \`metadata.fetched_at\`, \`metadata.checksum\`; if
   any of these are missing, raise it with the user.

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
- **Always use \`.venv/bin/python\`** (the per-user venv at the root of this
  workspace) for any Python invocation. zap is exposed read-only via a .pth
  file; do not try to write into \`/home/agent/zap\`.
- **Verify before declaring done.** At minimum, import the module you just
  wrote and confirm it loads without exception. If the feature is differentiable,
  do a tiny finite-difference check.
- **Persist as a skill.** SKILL.md is the source of truth for what features
  this user has built. Without it, the feature disappears from the UI.
- **Resolve networks before solving.** To run or analyze a power-system
  network the user names in plain language (e.g. "the IEEE 30-bus"), call
  \`steinmetz__list_networks\` to map the name to its \`network_artifact_id\`,
  then pass that id to \`steinmetz__solve_opf\`. If the user's message carries
  an "active network" context line with a network_artifact_id, use that id
  directly without re-listing.

Terse, technical, no filler. When uncertain about which zap base class to
extend, say so and ask — don't sprinkle the change across guesses.
`,
  )

  // Regenerate opencode.jsonc every materialization so the MCP config picks
  // up changes to the server script path (and so existing workspaces get the
  // user-features server without manual migration). `instructions` lists the
  // per-user glossary + company-context docs (ROADMAP §3 / LOOP_QUEUE item
  // 11) so opencode auto-loads them into the session's system prompt. Org
  // overlays (ROADMAP §10) are layered in via writeOpencodeConfig().
  await writeOpencodeConfig(dir, [])

  // Stub the workspace-context files so opencode finds them on the very first
  // session, before any PDF has been ingested. Ingestion appends real content
  // to these files; never overwrite a non-stub on materialization.
  await writeIfMissing(
    path.join(dir, "glossary.md"),
    `# Glossary

Domain terms and acronyms used by this user's documents. Auto-built by the
Steinmetz PDF ingestion pipeline; user-editable. Each entry's source PDF is
recorded inline so you can trace a definition back to its origin.
`,
  )
  await writeIfMissing(
    path.join(dir, "company-context.md"),
    `# Company / Domain Context

Narrative system context distilled from the user's uploaded sources. Auto-
built by the Steinmetz PDF ingestion pipeline; user-editable. The agent loads
this as system context every session.
`,
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

  // HARDENING §3.1: lock the workspace to a per-user Linux account *after*
  // all bootstrap writes complete — once the dir is chowned + 700, grid-app
  // (running as `agent`) can no longer create files inside. Gated on
  // STEINMETZ_ENABLE_LINUX_ACCOUNTS=1 so dev / CI keep working; production
  // flips the flag once item 3.2 ships and per-user opencode units take
  // over workspace writes. Idempotent + fail-soft (see lib/linux-account.ts).
  await ensureLinuxAccount(dir, userId)

  // HARDENING §3.4: materialise the per-user cgroup slice before the first
  // session-start triggers `systemctl start steinmetz-opencode@<short>.service`.
  // Default tier; tier changes (when `profiles.compute_tier` is set later via
  // an admin surface) re-run `ensureUserSlice` with the resolved tier name.
  // Gated on STEINMETZ_PER_USER_SLICES=1 (see lib/compute-tier.ts).
  await ensureUserSlice(userId)

  return dir
}

// HARDENING §3.1: detect that the workspace has already been chowned to a
// per-user Linux account. We can stat the dir entry (we still have x on the
// parent) even when mode 700 + alien owner would block any read/write inside.
// Returns false on missing / stat error / still-owned-by-us; in those cases
// the caller proceeds with the normal bootstrap path.
async function isWorkspaceHandedOff(dir: string): Promise<boolean> {
  const ours = typeof process.getuid === "function" ? process.getuid() : undefined
  if (ours === undefined) return false
  try {
    const st = await fs.stat(dir)
    return st.uid !== ours
  } catch {
    return false
  }
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

// Per-user pip target (HARDENING §2.1). The agent runs
// `pip install --target=<workspace>/.python_libs <pkg>`; every Python
// subprocess we spawn prepends this dir to PYTHONPATH so the install is
// visible to that user's runs only and never leaks into the shared venv.
export function pythonLibsDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".python_libs")
}

// Per-user venv dir (HARDENING §3.3).
export function pyVenvDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".venv")
}

// Per-user interpreter path, addressed by workspace directory. Most callers
// already hold the workspace path returned by `ensureUserWorkspace`, so this
// avoids re-deriving it. Does NOT check existence; pair with
// `ensureUserWorkspace` (which calls `ensurePerUserVenv`).
export function pyInterpreterForWorkspace(workspaceDir: string): string {
  return path.join(workspaceDir, ".venv", "bin", "python")
}

// Per-user interpreter, addressed by supabase uid. Equivalent to
// `pyInterpreterForWorkspace(<ROOT>/<supabaseUid>)`.
export function pyInterpreterFor(supabaseUid: string): string {
  return pyInterpreterForWorkspace(path.join(ROOT, supabaseUid))
}

// Idempotently provision the per-user venv. Called from `ensureUserWorkspace`
// before `ensureLinuxAccount` so the venv ends up owned by the per-user
// Linux account along with the rest of the workspace contents. zap is
// exposed read-only via a `.pth` file in the venv's site-packages: one line
// for the zap source dir (so `import zap` resolves) and one for the shared
// venv's site-packages (so zap's already-installed deps — numpy, torch,
// pypsa, … — are reachable without re-installing them per user).
//
// `--without-pip` avoids the `ensurepip` data dependency that Debian
// fragments out of the base python3 package (see venv test in §3.3); the
// AGENTS.md template tells the agent to run `python -m ensurepip --upgrade`
// on demand if they want pip in the venv itself.
export async function ensurePerUserVenv(workspaceDir: string): Promise<void> {
  const venvDir = pyVenvDir(workspaceDir)
  const interpreter = pyInterpreterForWorkspace(workspaceDir)
  let exists = false
  try {
    await fs.access(interpreter)
    exists = true
  } catch {
    exists = false
  }
  if (!exists) {
    try {
      await execFileP(VENV_SOURCE_PYTHON, ["-m", "venv", "--without-pip", venvDir])
    } catch (e) {
      console.warn(
        `[hardening 3.3] failed to create per-user venv at ${venvDir}:`,
        e,
      )
      return
    }
  }
  // Always re-write the .pth file. Cheap, and lets a host-side bump of the
  // shared zap install location (rare, but possible during upgrades) take
  // effect on the next session.
  await writeZapPth(venvDir)
}

async function writeZapPth(venvDir: string): Promise<void> {
  const siteDir = await resolveVenvSitePackages(venvDir)
  if (!siteDir) return
  // site.py processes any *.pth file in site-packages on interpreter start:
  // each line that names an existing directory is appended to sys.path.
  // Naming this `_zap_shared.pth` keeps it alphabetically before most
  // package metadata files (so the order is deterministic).
  const pthPath = path.join(siteDir, "_zap_shared.pth")
  const body = `# Steinmetz HARDENING §3.3 — expose shared zap install read-only.\n${SHARED_ZAP_SOURCE_DIR}\n${SHARED_ZAP_SITE_PACKAGES}\n`
  try {
    await fs.writeFile(pthPath, body, "utf8")
  } catch (e) {
    console.warn(`[hardening 3.3] failed to write ${pthPath}:`, e)
  }
}

async function resolveVenvSitePackages(venvDir: string): Promise<string | null> {
  // `python -m venv` lays down lib/python<MAJOR.MINOR>/site-packages. Glob
  // the single child rather than hardcoding the version so we survive a
  // Python upgrade on the host.
  const libDir = path.join(venvDir, "lib")
  let entries: string[]
  try {
    entries = await fs.readdir(libDir)
  } catch {
    return null
  }
  const pyDir = entries.find((e) => e.startsWith("python"))
  if (!pyDir) return null
  return path.join(libDir, pyDir, "site-packages")
}

// Build a child-process env that includes PYTHONPATH pointing at the user's
// per-workspace pip target. Preserves any existing PYTHONPATH from the
// caller / parent process. Callers should pass `process.env` as `base` (or
// omit to use it implicitly).
export function pythonEnv(
  workspaceDir: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const libs = pythonLibsDir(workspaceDir)
  const existing = base.PYTHONPATH
  const PYTHONPATH = existing ? `${libs}${path.delimiter}${existing}` : libs
  return { ...base, PYTHONPATH }
}

// Org-overlay file naming. Each org membership lands in two files —
// `glossary.org.<slug>.md` and `company-context.org.<slug>.md` — so the
// agent can read which definitions came from which org. Listed first in
// the opencode `instructions` array so personal files (`glossary.md` /
// `company-context.md`) layer on top.
const ORG_GLOSSARY_PREFIX = "glossary.org."
const ORG_CONTEXT_PREFIX = "company-context.org."

// Filename for the opencode workspace config, relative to .opencode/.
const OPENCODE_CONFIG_FILE = "opencode.jsonc"

function opencodeConfigPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".opencode", OPENCODE_CONFIG_FILE)
}

// Read the existing `provider:` block from the workspace's opencode.jsonc so
// per-user provider keys (HARDENING §1.4) survive an org-overlay or workspace
// re-materialization. Returns `{}` if the file is missing or unparseable.
async function readExistingProviderBlock(
  workspaceDir: string,
): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(opencodeConfigPath(workspaceDir), "utf8")
    const parsed = JSON.parse(raw) as { provider?: unknown }
    if (parsed.provider && typeof parsed.provider === "object" && !Array.isArray(parsed.provider)) {
      return parsed.provider as Record<string, unknown>
    }
  } catch {
    // Missing file / bad JSON — start from empty.
  }
  return {}
}

// Translate a `{ providerID: apiKey }` map into the opencode provider config
// shape (`{ <id>: { options: { apiKey: <key> } } }`). opencode's config loader
// merges workspace-local provider config over global / env (see
// packages/opencode/src/provider/provider.ts), so writing this into a user's
// workspace `.opencode/opencode.jsonc` causes that user's sessions to bill
// against that user's key — no fork modification needed.
function buildProviderBlock(
  providerKeys: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [providerId, apiKey] of Object.entries(providerKeys)) {
    if (!apiKey) continue
    out[providerId] = { options: { apiKey } }
  }
  return out
}

export async function writeOpencodeConfig(
  workspaceDir: string,
  orgOverlayFiles: string[],
  providerKeys?: Record<string, string>,
): Promise<void> {
  const instructions = [
    ...orgOverlayFiles,
    "glossary.md",
    "company-context.md",
  ]
  // Per-workspace permission block. `external_directory: "deny"` is the load-
  // bearing rule that stops the agent from touching files outside cwd; the
  // per-tool maps tighten bash/edit to the workspace path (HARDENING §1.1).
  const workspaceGlob = `${workspaceDir}/**`
  const permission = {
    bash: { "*": "ask", [workspaceGlob]: "allow" },
    edit: { "*": "deny", [workspaceGlob]: "allow" },
    external_directory: "deny",
    webfetch: "ask",
    websearch: "allow",
  }
  // If the caller passed explicit keys, use them; otherwise preserve whatever
  // the current config file holds so we don't blow away per-user keys on a
  // routine workspace re-materialization or org-overlay swap.
  const provider =
    providerKeys !== undefined
      ? buildProviderBlock(providerKeys)
      : await readExistingProviderBlock(workspaceDir)
  // HARDENING §2.2: pass through the proceed/release knobs to the MCP server
  // so its `tools/call` wrapper can gate every feature call through grid-app's
  // in-memory token bucket. user_id is the workspace dir basename (supabase
  // uid); we send it explicitly so the MCP server doesn't have to parse paths.
  const mcpEnv: Record<string, string> = {
    STEINMETZ_FEATURES_DIR: path.join(workspaceDir, "features"),
    STEINMETZ_WORKSPACE_DIR: workspaceDir,
    STEINMETZ_USER_ID: path.basename(workspaceDir),
    // HARDENING §2.1: per-user pip target. The MCP server (and any feature
    // modules it imports) sees this user's .python_libs/ first so
    // `pip install --target=...` installs are visible only here.
    PYTHONPATH: pythonLibsDir(workspaceDir),
  }
  const internalToken = sanitizeBearerTokenEnv("STEINMETZ_INTERNAL_TOKEN")
  if (internalToken) mcpEnv.STEINMETZ_INTERNAL_TOKEN = internalToken
  const gridAppUrl = process.env.STEINMETZ_GRID_APP_URL
  if (gridAppUrl) mcpEnv.STEINMETZ_GRID_APP_URL = gridAppUrl

  const opencodeConfig = {
    $schema: "https://opencode.ai/config.json",
    provider,
    mcp: {
      "user-features": {
        type: "local",
        command: [pyInterpreterForWorkspace(workspaceDir), MCP_SERVER_SCRIPT],
        environment: mcpEnv,
      },
    },
    instructions,
    permission,
  }
  await fs.writeFile(
    opencodeConfigPath(workspaceDir),
    JSON.stringify(opencodeConfig, null, 2) + "\n",
    "utf8",
  )
}

// Refresh only the `provider:` block of an existing workspace config without
// touching overlays / permissions / mcp. Used after a per-user provider key
// is added or removed via /api/settings/provider-keys.
export async function writeUserProviderConfig(
  workspaceDir: string,
  providerKeys: Record<string, string>,
): Promise<void> {
  const p = opencodeConfigPath(workspaceDir)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(await fs.readFile(p, "utf8")) as Record<string, unknown>
  } catch {
    parsed = {}
  }
  parsed.provider = buildProviderBlock(providerKeys)
  await fs.writeFile(p, JSON.stringify(parsed, null, 2) + "\n", "utf8")
}

export interface OrgOverlay {
  slug: string
  // Optional content for each file. When omitted/empty, the file is still
  // created with a brief stub so opencode doesn't error on a missing path.
  glossary?: string
  context?: string
}

// Materialize org overlay files into the workspace and update the opencode
// instructions list so they load before the personal files. Idempotent:
// removes stale `glossary.org.<slug>.md` / `company-context.org.<slug>.md`
// files for orgs the user is no longer a member of.
export async function applyOrgOverlays(
  workspaceDir: string,
  overlays: OrgOverlay[],
): Promise<string[]> {
  // 1. Drop overlay files for orgs that no longer apply.
  const keepGlossary = new Set(overlays.map((o) => `${ORG_GLOSSARY_PREFIX}${o.slug}.md`))
  const keepContext = new Set(overlays.map((o) => `${ORG_CONTEXT_PREFIX}${o.slug}.md`))
  let entries: string[] = []
  try {
    entries = await fs.readdir(workspaceDir)
  } catch {
    entries = []
  }
  for (const name of entries) {
    if (name.startsWith(ORG_GLOSSARY_PREFIX) && !keepGlossary.has(name)) {
      await fs.rm(path.join(workspaceDir, name), { force: true })
    }
    if (name.startsWith(ORG_CONTEXT_PREFIX) && !keepContext.has(name)) {
      await fs.rm(path.join(workspaceDir, name), { force: true })
    }
  }

  // 2. Write each overlay's files.
  const overlayFiles: string[] = []
  for (const o of overlays) {
    const glossaryName = `${ORG_GLOSSARY_PREFIX}${o.slug}.md`
    const contextName = `${ORG_CONTEXT_PREFIX}${o.slug}.md`
    await fs.writeFile(
      path.join(workspaceDir, glossaryName),
      o.glossary ?? stubOrgGlossary(o.slug),
      "utf8",
    )
    await fs.writeFile(
      path.join(workspaceDir, contextName),
      o.context ?? stubOrgContext(o.slug),
      "utf8",
    )
    overlayFiles.push(glossaryName, contextName)
  }

  // 3. Rewrite opencode.jsonc so the agent's next session loads org content
  //    first, then the user's personal glossary/context on top.
  await writeOpencodeConfig(workspaceDir, overlayFiles)
  return overlayFiles
}

function stubOrgGlossary(slug: string): string {
  return `# Org glossary — ${slug}

Domain terms shared across this org. Org owners/admins maintain this. Your
personal glossary in \`glossary.md\` layers on top.
`
}

function stubOrgContext(slug: string): string {
  return `# Org context — ${slug}

Narrative system context shared across this org. Org owners/admins maintain
this. Your personal context in \`company-context.md\` layers on top.
`
}

import "server-only"
import fs from "node:fs/promises"
import path from "node:path"
import {
  materializeWorkspaceDir,
  workspaceRoot,
} from "@/lib/user-workspace"

// REDESIGN §4.4 — per-workspace directory.
//
// The materialized dir is moving from per-user (`grid-workspaces/<supabase-uid>/`)
// to per-workspace (`grid-workspaces/<workspace-id>/`). A Workspace anchors a
// single primary network (REDESIGN §3), recorded in `.steinmetz/workspace.json`
// inside the dir so a workspace-aware `solve_opf` / planning tool can default to
// it with no UUID needed — that's what retires the composer picker.
//
// The bootstrap (`.opencode/`, `features/`, venv, stub files, opencode config)
// is shared with the legacy per-user path via
// `lib/user-workspace.ts:materializeWorkspaceDir(dir)`. This module is the
// per-workspace entry point; `ensureUserWorkspace(userId)` remains the
// back-compat per-user shim and is unchanged.

// Relative path (inside a workspace dir) of the workspace metadata file.
export const WORKSPACE_META_DIR = ".steinmetz"
export const WORKSPACE_META_FILE = "workspace.json"

export interface WorkspaceMeta {
  // The supabase `workspaces.id` this directory backs.
  workspace_id: string
  // The workspace's primary network — `artifacts.id` of a `kind='network'`
  // row. Null until a data source is anchored (REDESIGN §5 wizard step 3 can
  // defer the source). The agent's workspace-aware tools default to this id.
  primary_network_id: string | null
  // Optional human label for the network, cached so tools/UX can show it
  // without a DB round-trip.
  primary_network_name?: string | null
  updated_at: string
}

export function workspaceDirFor(workspaceId: string): string {
  return path.join(workspaceRoot(), workspaceId)
}

function metaPath(workspaceDir: string): string {
  return path.join(workspaceDir, WORKSPACE_META_DIR, WORKSPACE_META_FILE)
}

// Materialize a per-workspace directory and return its path. Idempotent: reuses
// the directory-keyed bootstrap so the layout matches a per-user workspace, then
// ensures `.steinmetz/workspace.json` exists recording the workspace id (and any
// already-anchored primary network).
export async function ensureWorkspace(workspaceId: string): Promise<string> {
  const dir = workspaceDirFor(workspaceId)
  await materializeWorkspaceDir(dir)
  await fs.mkdir(path.join(dir, WORKSPACE_META_DIR), { recursive: true })

  // Create the metadata file on first materialization without clobbering an
  // existing one (which may already carry a primary_network_id).
  const existing = await readWorkspaceMeta(dir)
  if (!existing) {
    await writeWorkspaceMeta(dir, {
      workspace_id: workspaceId,
      primary_network_id: null,
      primary_network_name: null,
      updated_at: new Date().toISOString(),
    })
  } else if (existing.workspace_id !== workspaceId) {
    // Self-heal a dir whose meta drifted from its directory name.
    await writeWorkspaceMeta(dir, { ...existing, workspace_id: workspaceId })
  }

  return dir
}

// Read `.steinmetz/workspace.json`. Returns null if absent or unparseable so
// callers can treat "no meta yet" the same as a fresh workspace.
export async function readWorkspaceMeta(
  workspaceDir: string,
): Promise<WorkspaceMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(workspaceDir), "utf8")
    const parsed = JSON.parse(raw) as Partial<WorkspaceMeta>
    if (typeof parsed.workspace_id !== "string") return null
    return {
      workspace_id: parsed.workspace_id,
      primary_network_id: parsed.primary_network_id ?? null,
      primary_network_name: parsed.primary_network_name ?? null,
      updated_at: parsed.updated_at ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export async function writeWorkspaceMeta(
  workspaceDir: string,
  meta: WorkspaceMeta,
): Promise<void> {
  await fs.mkdir(path.join(workspaceDir, WORKSPACE_META_DIR), { recursive: true })
  await fs.writeFile(
    metaPath(workspaceDir),
    JSON.stringify({ ...meta, updated_at: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  )
}

// Anchor (or change) the workspace's primary network. Materializes the dir
// first so this is safe to call before any session has run. Merges onto the
// existing meta so the workspace_id / other fields survive.
export async function setPrimaryNetwork(
  workspaceId: string,
  primaryNetworkId: string | null,
  primaryNetworkName?: string | null,
): Promise<string> {
  const dir = await ensureWorkspace(workspaceId)
  const existing = (await readWorkspaceMeta(dir)) ?? {
    workspace_id: workspaceId,
    primary_network_id: null,
    primary_network_name: null,
    updated_at: new Date().toISOString(),
  }
  await writeWorkspaceMeta(dir, {
    ...existing,
    workspace_id: workspaceId,
    primary_network_id: primaryNetworkId,
    primary_network_name:
      primaryNetworkName !== undefined
        ? primaryNetworkName
        : existing.primary_network_name ?? null,
    updated_at: new Date().toISOString(),
  })
  return dir
}

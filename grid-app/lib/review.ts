import "server-only"
import { spawn } from "node:child_process"
import path from "node:path"
import { pythonEnv } from "@/lib/user-workspace"

// Thin wrapper around `scripts/review_feature.py`. Fires the reviewer
// detached so the request that triggered the review (a feature edit, a draft
// insert) doesn't block on subprocess startup + Supabase round-trips.
//
// The reviewer reads `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` itself so
// we don't need to plumb env through here.
const PY_BIN = process.env.STEINMETZ_PY || "/home/agent/zap/.venv/bin/python"
const SCRIPT =
  process.env.STEINMETZ_REVIEW_SCRIPT ||
  path.join(process.cwd(), "scripts", "review_feature.py")

export function reviewFeatureDetached(artifactId: string, workspace: string): void {
  try {
    const child = spawn(
      PY_BIN,
      [SCRIPT, "--artifact-id", artifactId, "--workspace", workspace],
      {
        detached: true,
        stdio: "ignore",
        env: pythonEnv(workspace),
      },
    )
    child.unref()
  } catch (e) {
    console.error("[review] spawn failed:", e)
  }
}

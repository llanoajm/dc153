STATUS: done
SUMMARY: Per-user pip target (`<workspace>/.python_libs/`) wired into the MCP server env, lib/review.ts, and all upload + fetch route Python spawn sites via a new pythonEnv() helper; workspace AGENTS.md documents `pip install --target=.python_libs` as the convention.
NEXT_STEPS:
ACCEPTANCE:
- pass: workspace AGENTS.md template documents `pip install --target=<WORKSPACE>/.python_libs <pkg>` (lib/user-workspace.ts in the "Installing Python packages" section).
- pass: every Python subprocess spawn site prepends `<WORKSPACE>/.python_libs/` to PYTHONPATH — verified by `rg PYTHONPATH lib app`:
    * lib/user-workspace.ts MCP server env block sets PYTHONPATH to pythonLibsDir(workspaceDir)
    * lib/review.ts reviewFeatureDetached uses pythonEnv(workspace)
    * app/api/upload/route.ts spawnIngestion uses pythonEnv(workspace)
    * app/api/upload/pdf/route.ts spawnIngestion uses pythonEnv(workspace)
    * app/api/upload/source/route.ts spawnIngestion uses pythonEnv(workspace)
    * app/api/upload/reingest/[id]/route.ts spawnIngestion uses pythonEnv(workspace) (workspace now derived via ensureUserWorkspace(user.id))
    * app/api/fetch/route.ts runFetch uses pythonEnv(workspace)
- pass: zap stays read-only in the shared venv — no edits to /home/agent/zap, no changes to zap install paths, STEINMETZ_PY still resolves to /home/agent/zap/.venv/bin/python.
- pass: `npm run build` exits 0 (Next 16, Turbopack default; all routes compile).
- note: PYTHONPATH only prepends — any pre-existing PYTHONPATH from the parent env is preserved, so the shared zap install (resolved via the interpreter's site-packages) keeps working regardless.
- note: ensureUserWorkspace now mkdir -p's `<workspace>/.python_libs` on first materialization so PYTHONPATH always points at a real directory before the user's first pip install.
VERIFIED: yes

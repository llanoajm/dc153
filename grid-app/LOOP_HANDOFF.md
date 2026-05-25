## Current item (from LOOP_QUEUE.md line 111)
- [x] 3.3 Per-user Python environment (HARDENING_ROADMAP §3.3)

## Attempt
1 of 5

## Result
HARDENING §3.3 ships. Per-user venv at `<workspace>/.venv/` is
provisioned on first session by `lib/user-workspace.ts:ensurePerUserVenv`
(idempotent — checks for `.venv/bin/python` before spawning
`python -m venv --without-pip`). zap is exposed read-only via
`_zap_shared.pth` in the venv's site-packages, listing both
`/home/agent/zap` (so `import zap` resolves) and the shared zap venv's
site-packages (so already-installed deps — numpy, torch, pypsa, ... —
are reachable without re-installing per user).

New helpers:
- `pyInterpreterFor(supabaseUid: string): string`
- `pyInterpreterForWorkspace(workspaceDir: string): string`
- `pyVenvDir(workspaceDir: string): string`
- `ensurePerUserVenv(workspaceDir: string): Promise<void>`

All `STEINMETZ_PY` plumbing replaced with per-user resolution in:
`lib/user-workspace.ts` (MCP server command), `lib/review.ts`,
`scripts/fetch_url.py`, `app/api/upload/route.ts`,
`app/api/upload/pdf/route.ts`, `app/api/upload/source/route.ts`,
`app/api/upload/reingest/[id]/route.ts`, `app/api/fetch/route.ts`.
The only remaining `STEINMETZ_PY` mention in the tree is a doc comment
explaining the deprecation; no production code references it.

The seed Python that `python -m venv` uses lives in a separate
`STEINMETZ_VENV_SEED_PYTHON` knob (default `/home/agent/zap/.venv/bin/python`
to keep the per-user venv's Python ABI matched to the shared zap install
that the .pth file points at). That's a one-shot bootstrap path, not a
runtime interpreter.

`npm run build` exits 0. Cross-user isolation verified manually with
two scratch venvs in /tmp: a `fakepkg` written into venv-A's
site-packages is invisible to venv-B's interpreter; both venvs can
still import zap + numpy + pypsa via the .pth file.

## Caveats / follow-ups
- `writeIfMissing` semantics mean already-materialized workspaces keep
  their old AGENTS.md (which still mentions `/home/agent/zap/.venv/bin/python`).
  New workspaces get the updated copy. Re-running ingestion/uploads on
  existing workspaces is unaffected — the venv gets provisioned on the
  next `ensureUserWorkspace` call regardless of the AGENTS.md text.
- The venv is built with `--without-pip` because the host's
  `python3-venv` package is missing `ensurepip` data; AGENTS.md tells
  the agent to run `python -m ensurepip --upgrade` once if they want
  pip in the venv itself (alternatively, the existing `.python_libs`
  pip-target flow from §2.1 still works).

## Constraints
(unchanged from prior LOOP_HANDOFF — left here for the next iteration)

- Do NOT modify the opencode fork at /home/agent/opencode. Permission tightening goes in the workspace opencode.jsonc; auth gating goes in front of opencode, not inside it. Keep our fork clean against upstream dev.
- Do NOT modify zap source at /home/agent/zap in end-user mode. Features are user-space Python that imports from zap.
- Do NOT use opencode.ai hosted layers (no Big Pickle, no OpenCode Zen, no OpenCode Go free models). Direct providers only.
- Do NOT introduce containers, orchestrators, or a second VM. Everything in HARDENING_ROADMAP.md runs as Linux users + systemd units on the existing machine. Single-VM is the explicit target end state; if you think an item needs more than that, surface it in NEXT_STEPS — the escalation lives in a separate doc (TIER3_EXPANSION.md) and is out of scope here.
- Do NOT re-architect the MCP-as-tools model. `may_I_proceed` (item 2.2) is the only way grid-app gates per-tool execution; do not introduce a parallel "operations are HTTP endpoints" catalog.
- Do NOT add a custom opencode fork divergence. If a hardening item seems to require editing the fork, surface it in NEXT_STEPS and ship the rest.
- Do NOT use emojis in user-facing UI or in code unless the user explicitly asked. This includes commit messages and doc files you add.
- Next.js 16.2.6 breaks: `cookies()` / `headers()` / `params` / `searchParams` are async (must `await`); `middleware.ts` is renamed `proxy.ts` with an exported `proxy()` function; Turbopack is the default; `next lint` is removed. Read node_modules/next/dist/docs/ before writing route-handler / middleware-shaped code.
- Bring-your-own keys: never commit secrets. Supabase service-role key lives in `.env.local`. OpenRouter shared key lives in opencode's env. Per-user OpenRouter keys go in `provider_keys` (item 1.4) once that ships.
- If you edit `supabase/schema.sql`, call it out loudly in SUMMARY — the user has to paste the new SQL into Supabase before the change is live; verify steps that depend on the new table will fail until they do.
- Per-user isolation rule: features/skills/chats are per-user, never committed to zap or opencode git history. Storage is filesystem (`/home/agent/grid-workspaces/<id>/`) + Supabase (RLS-gated tables).
- The product roadmap (ROADMAP.md) is out of scope for this queue. Don't pick up feature work even if you notice gaps.

STATUS: done
SUMMARY: HARDENING §3.3 ships: per-user venv at `<workspace>/.venv/` with zap exposed read-only via `_zap_shared.pth`; `pyInterpreterFor` / `pyInterpreterForWorkspace` helpers replace all `STEINMETZ_PY` plumbing in upload/fetch routes, lib/review.ts, and scripts/fetch_url.py.
ACCEPTANCE: pass — `ensurePerUserVenv` provisions `<workspace>/.venv/` idempotently and exports `pyInterpreterFor(supabaseUid)`; every STEINMETZ_PY caller now resolves the per-user interpreter (grep shows only one remaining mention, a doc comment); zap is exposed via a `_zap_shared.pth` file written into each per-user venv's site-packages; `npm run build` exits 0; cross-user isolation smoke (fakepkg in venv-A invisible to venv-B, both still import zap) verified manually.

VERIFIED: yes

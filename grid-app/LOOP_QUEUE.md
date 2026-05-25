# Loop Queue — Hardening

Derived from `HARDENING_ROADMAP.md`. Section pointers (e.g. §1.1) refer to that
file. Acceptance criteria are quoted/condensed from the roadmap's own
"Acceptance:" lists where present, and scripted to be checkable from a shell
(file existence, `npm run build` exit 0, curl checks, SQL/schema greps).

Legend: `- [ ]` pending · `- [x]` done & verified · `- [!]` blocked (see LOOP_ALERTS.md)

This queue is **infrastructure work**, not feature work. The product roadmap
(`ROADMAP.md`) is intentionally separate. Everything here runs on a single VM
— multi-tenancy is achieved through OS-level mechanisms (Linux users, systemd
units, cgroup slices, Unix sockets), not containers or orchestrators. The
single-VM target is end state; if it ever stops being enough, that's a
separate doc (`TIER3_EXPANSION.md`) and out of scope here. Items roll up
under three phase gates:

- Phase 1 (items 1.1–1.4): must ship before user #2 gets a login.
- Phase 2 (items 2.1–2.3): must ship before any paying user.
- Phase 3 (items 3.1–3.4): OS-level execution isolation — kernel-enforced
  rather than honest-broker. Gate: do not onboard any user you don't
  personally trust until this ships.

## Items

- [ ] 1.1 Tighten Bash / Edit / external_directory permissions (HARDENING_ROADMAP §1.1)
  - context: replace `permission: {}` in workspace opencode.jsonc with a real per-tool / per-pattern allow/deny shape gated to the workspace cwd.
  - acceptance:
    - `lib/user-workspace.ts` `writeOpencodeConfig` writes a `permission:` object with `bash`, `edit`, `external_directory`, `webfetch`, `websearch` keys (grep the file for those identifiers).
    - The `external_directory` key is present and set to `"deny"` (grep `external_directory.*deny`).
    - `<WORKSPACE>/**` (literal substitution to the workspace's absolute path at write time) is used as the allow-pattern for `bash` and `edit`.
    - `npm run build` exits 0.
    - Manual cross-user smoke (best-effort, document in handoff if not runnable): asking the agent to `cat /home/agent/grid-workspaces/<otherUid>/glossary.md` is denied or prompts for permission; agents do not access another user's workspace silently.

- [ ] 1.2 Lock opencode behind an auth token (HARDENING_ROADMAP §1.2)
  - context: opencode currently binds 127.0.0.1:4096 with no auth; anyone with shell on the VM gets full session takeover. Front it with a bearer-token proxy; do not modify the opencode fork.
  - acceptance:
    - A new fronting process exists (e.g. `scripts/opencode-proxy.ts` or a Caddy/nginx unit under `infra/` or `deploy/`); the file is committed.
    - The fronting layer rejects requests without `Authorization: Bearer $STEINMETZ_OPENCODE_TOKEN` (curl without bearer → 401; with bearer → 200).
    - `lib/opencode-client.ts` no longer hard-codes `http://127.0.0.1:4096` — it reads the fronted endpoint (e.g. `process.env.STEINMETZ_OPENCODE_URL`) and sends the bearer header.
    - Token name documented in `.env.example` (or AGENTS.md / STATE.md Quick Start) so the user knows where to set it; never committed in plaintext.
    - `npm run build` exits 0.
    - Authed `/app` chat continues to work end-to-end (manual; document in handoff).

- [ ] 1.3 Fix org-overlay stacking bug (HARDENING_ROADMAP §1.3)
  - context: `syncOrgContextOverlays` stacks every org the user belongs to into `instructions:`, leaking cross-org context. Add an `active_org_id` concept and emit only that overlay.
  - acceptance:
    - `supabase/schema.sql` adds `active_org_id uuid` (nullable, FK to `orgs.id`) on `profiles`, OR a session-level mechanism is added with equivalent intent (documented in the handoff).
    - `lib/orgs.ts` `syncOrgContextOverlays` only emits the active org's overlay files; non-active overlays are deleted from the workspace.
    - Session-creation API (`app/api/opencode/session/route.ts` or the route that POSTs to opencode) accepts an `active_org_id`, validates membership via `org_members`, and 403s if the caller isn't a member.
    - UI: a switcher exists in the workspace shell (`components/shell/` or `components/orgs/`) that flips `active_org_id` and triggers re-sync.
    - `npm run build` exits 0.

- [ ] 1.4 Per-user OpenRouter key (HARDENING_ROADMAP §1.4)
  - context: today every session bills against one shared key. Add per-user keys with a managed-secrets path, fall back to shared env only if the user has none configured.
  - acceptance:
    - `supabase/schema.sql` adds `provider_keys(user_id uuid, provider text, encrypted_key text, created_at timestamptz)` with RLS by `auth.uid()`. Encryption path documented (Supabase Vault / pgsodium, or a TODO marker if vault setup is out of scope for this item).
    - `app/api/settings/provider-keys/route.ts` exists with GET (masked list), POST (upsert), DELETE.
    - `app/app/settings/page.tsx` exists with a form to paste a key per provider.
    - `lib/opencode-client.ts` `sendPrompt` (or equivalent session-config plumbing) fetches the user's key and passes it via per-session model config, falling back to the shared env key only when none is set.
    - `npm run build` exits 0.

- [ ] 2.1 Per-user pip target (HARDENING_ROADMAP §2.1)
  - context: `pip install` from the agent's Bash currently lands in the shared `/home/agent/zap/.venv/`; isolate per user via `--target=<WORKSPACE>/.python_libs/` + `PYTHONPATH`.
  - acceptance:
    - Workspace `AGENTS.md` template (in `lib/user-workspace.ts`) documents `pip install --target=<WORKSPACE>/.python_libs <pkg>` as the convention.
    - All Python subprocess spawn sites prepend `<WORKSPACE>/.python_libs/` to `PYTHONPATH` in their env block — at minimum: `lib/user-workspace.ts` (MCP server env), `lib/review.ts` (`reviewFeatureDetached`), `app/api/upload/**/route.ts`, `app/api/fetch/route.ts`. (Grep for `PYTHONPATH` should turn these up; new sites added later should follow the same pattern.)
    - zap stays read-only in the shared venv (no edits to zap source; no zap install paths changed).
    - `npm run build` exits 0.

- [ ] 2.2 Per-user solve concurrency limits + tool-run visibility (HARDENING_ROADMAP §2.2)
  - context: implement the `may_I_proceed()` honest-broker pattern between `scripts/user-mcp-server.py` and grid-app, with per-user and global slot caps and a `tool_runs` audit table.
  - acceptance:
    - `lib/concurrency.ts` exists with an in-memory token bucket (per-user default 1, global default 3).
    - `app/api/internal/proceed/route.ts` and `app/api/internal/release/route.ts` exist; both gated by `STEINMETZ_INTERNAL_TOKEN` and return 401 without it.
    - `supabase/schema.sql` adds `tool_runs(id, user_id, tool, args_digest, token, started_at, expected_deadline, ended_at, runtime_ms, status, error)` with RLS.
    - `scripts/user-mcp-server.py` wraps its `tools/call` handler with proceed/release; existing detached-spawn upload routes call the same endpoints.
    - Hang detection: a sweep (or lazy per-request check) marks runs `orphaned` past `expected_deadline + grace`.
    - `npm run build` exits 0.
    - Behavioural smoke (best-effort, document in handoff): two concurrent same-user `iesp__solve` calls — second returns 429 surfaced as an MCP tool error.

- [ ] 2.3 Disk quotas + monitoring (HARDENING_ROADMAP §2.3)
  - context: keep one user's PPTX-heavy workspace from filling `/` and bricking the VM. Mostly ops-shaped work, but the app-side enforcement and the script need to land in this repo.
  - acceptance:
    - `scripts/quota_check.sh` exists; documents how `du -sh` per workspace is computed and how `profiles.over_quota=true` is flipped at the 80% mark.
    - `supabase/schema.sql` adds `over_quota boolean default false` to `profiles` (or equivalent column documented in the handoff).
    - Upload routes (`app/api/upload/**/route.ts`) reject new uploads with a clear error when the caller's `over_quota=true`.
    - `app/api/admin/health/route.ts` returns JSON with at least: process CPU, free disk on the workspace filesystem, active session count, opencode RSS (best-effort; placeholders allowed but the route must exist and return 200 for an authed admin).
    - Mount + `quotaon` instructions documented in this repo (e.g. `infra/QUOTA.md` or a section in STATE.md / AGENTS.md) — runtime config the user has to apply on the VM is allowed to be doc-only, but the doc must be committed.
    - `npm run build` exits 0.

- [ ] 3.1 Per-user Linux account (HARDENING_ROADMAP §3.1)
  - context: kernel-enforced isolation begins here; spin a per-user OS account on signup, chown the workspace to it, run grid-app in a group that can still read workspace metadata. **VERIFIER NOTE: this item touches the host system (useradd/chown). The verify phase must focus on the in-repo plumbing, not on actually creating Linux users — document any OS-side actions in the handoff rather than executing them.**
  - acceptance:
    - `lib/user-workspace.ts` `ensureUserWorkspace` calls a helper that derives a short-uid (hash of supabase uid, length ≤ 32 chars) and runs `useradd --system --no-create-home --home <workspace> steinmetz-<short-uid>` (idempotent — second call is a no-op).
    - `chown -R steinmetz-<short-uid>:steinmetz` + `chmod 700` applied to the workspace directory.
    - `lib/user-workspace.ts` exposes a `shortUidFor(supabaseUid)` (or equivalent) function used by downstream items 3.2 and 3.3.
    - Documented host-side prereq (in STATE.md or AGENTS.md): grid-app must run in group `steinmetz`; sudoers / capability grant for `useradd`/`chown` recorded.
    - `npm run build` exits 0.

- [ ] 3.2 Per-user opencode server (HARDENING_ROADMAP §3.2)
  - context: one opencode unit per user, bound to a Unix socket; grid-app routes per-request based on the user's short-uid.
  - acceptance:
    - A systemd template unit (e.g. `infra/systemd/steinmetz-opencode@.service` or `deploy/systemd/...`) is committed; parameterised by `<short-uid>`, runs as `User=steinmetz-<short-uid>`, binds `/run/steinmetz/<short-uid>.sock` (mode 0660, group `steinmetz`).
    - `lib/opencode-client.ts` picks the per-user socket per request from the caller's supabase uid → short-uid map (the call must go through the helper added in 3.1).
    - `createSession` (or session-bootstrap) triggers `systemctl start steinmetz-opencode@<short-uid>` idempotently; an idle-eviction strategy is documented (unit `TimeoutStopSec` and/or a watchdog script under `infra/` or `scripts/`).
    - 1.2's bearer-token proxy (or its socket equivalent) is updated to forward per-user.
    - `npm run build` exits 0.
    - Behavioural smoke (best-effort, document in handoff): killing user A's unit doesn't affect user B's chat.

- [ ] 3.3 Per-user Python environment (HARDENING_ROADMAP §3.3)
  - context: per-user venv at `/home/steinmetz-<short-uid>/.venv/` (or under the workspace); zap stays system-wide, exposed read-only via `.pth` or sys.path injection.
  - acceptance:
    - `lib/user-workspace.ts` provisions a per-user venv on first session (idempotent) and exposes a `pyInterpreterFor(supabaseUid)` helper.
    - All callers of the shared interpreter env (`STEINMETZ_PY` and friends) are updated to resolve the per-user interpreter: at minimum `lib/user-workspace.ts`, `lib/review.ts`, `scripts/fetch_url.py`, `app/api/upload/**/route.ts`, `app/api/fetch/route.ts`. Grep for `STEINMETZ_PY` should show no remaining hard references to the shared venv path.
    - zap is exposed to every per-user venv read-only (documented mechanism: pth file, sys.path prepend, or system site-packages mount).
    - `npm run build` exits 0.

- [ ] 3.4 systemd resource limits per user (HARDENING_ROADMAP §3.4)
  - context: every per-user opencode unit runs inside `Slice=steinmetz-<short-uid>.slice` with sane Memory / CPU / IO defaults; per-user tunable via `profiles.compute_tier`.
  - acceptance:
    - The systemd template from 3.2 references a per-user slice (e.g. `Slice=steinmetz-%i.slice`).
    - A slice template (e.g. `infra/systemd/steinmetz-%i.slice`) is committed with `MemoryMax=4G`, `CPUQuota=200%`, `IOWeight=100` (or equivalent documented defaults).
    - `supabase/schema.sql` adds `compute_tier text` (nullable) on `profiles`; a small mapping table or hardcoded resolver in `lib/` selects slice params per tier.
    - Operational note documented (STATE.md / AGENTS.md / infra README): how the slice file is materialised from the template at user-create time.
    - `npm run build` exits 0.
    - Behavioural smoke (best-effort, document in handoff): a runaway allocation in user A's slice gets OOM-killed without taking down the VM.

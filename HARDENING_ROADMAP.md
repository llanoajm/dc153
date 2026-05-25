# Steinmetz — Hardening Roadmap

The product roadmap (`ROADMAP.md`) drives feature work. This file drives the
infrastructure work needed to run Steinmetz safely for multiple users.
Read both — features and isolation evolve in parallel, not sequentially.

## Scope: one VM, many users

Everything in this roadmap runs on a **single VM**. Multi-tenancy is achieved
through OS-level mechanisms — Linux user accounts, `systemd` units, cgroup
slices, per-user venvs, Unix sockets — not through containers, orchestrators,
or per-tenant VMs. This is as far as one machine takes you and is the target
end state. If the single-VM model later proves insufficient for some
customer, see `TIER3_EXPANSION.md` for the escalation paths; that file is
not part of this roadmap and should not influence any decision here.

## Where we are today

Database isolation is real (Supabase RLS on every table, `auth.uid()`-gated).
Execution isolation is not: one `agent` OS user, one opencode process bound
to `127.0.0.1:4096` with no token, one shared `/home/agent/zap/.venv/`, no
per-user concurrency caps, no per-user provider keys, `bash: allow` blanket
in every workspace. Fine for solo use, brittle for two friendly users,
unsafe for two strangers.

## Phasing

Three phases. Each phase has an explicit gate ("don't onboard category X
until phase Y is done"). Phases stack: every later phase assumes earlier
phases shipped. Each item below is self-contained and can be executed by an
agent one-shot in isolation.

---

## Phase 1 — Before user #2

Gate: do not give a second human a login until all three items ship.

### 1.1 Tighten Bash / Edit / external_directory permissions

The workspace `opencode.jsonc` currently writes `permission: {}` which
opencode treats as "allow everything." opencode's permission schema
(`/home/agent/opencode/packages/opencode/src/config/permission.ts:16-37`)
supports per-tool `ask | allow | deny` and per-pattern object rules.

- File to change: `lib/user-workspace.ts:277` (the `permission: {}` block
  inside `writeOpencodeConfig`).
- Target config shape (write per-workspace, with `<WORKSPACE>` substituted):
  ```jsonc
  permission: {
    bash: { "*": "ask", "<WORKSPACE>/**": "allow" },
    edit: { "*": "deny", "<WORKSPACE>/**": "allow" },
    external_directory: "deny",
    webfetch: "ask",
    websearch: "allow",
  }
  ```
- The `external_directory` key is the load-bearing one — it's opencode's
  built-in lever for "the agent may not touch files outside cwd."
- Acceptance:
  - Manual test: ask the agent to `cat /home/agent/grid-workspaces/<otherUid>/glossary.md` — request must be denied or require a permission prompt the grid-app proxy intercepts.
  - `npm run build` exits 0.

### 1.2 Lock opencode behind an auth token

opencode binds `127.0.0.1:4096` and accepts any request. Anyone with
shell access to the VM — including a compromised user's own session
— has full takeover of every other user's chat. We don't want to
modify the opencode fork; do this in front of it instead.

- Add a tiny Bun/Node reverse proxy (or a Caddy/nginx unit) that
  requires `Authorization: Bearer $STEINMETZ_OPENCODE_TOKEN` and
  forwards to `127.0.0.1:4096`.
- Move opencode to bind a Unix socket at `/run/steinmetz/opencode.sock`
  (opencode supports custom `hostname`/`port` via
  `/home/agent/opencode/packages/opencode/src/cli/network.ts:6-13`; for
  a socket path, fronting it is simpler).
- grid-app's `lib/opencode-client.ts:4` switches from
  `http://127.0.0.1:4096` to the new fronted endpoint and adds the
  bearer header.
- Token lives in grid-app's `.env.local`, never committed.
- Acceptance:
  - `curl http://127.0.0.1:<frontport>/session` without bearer → 401.
  - Same call with bearer → 200.
  - Authed `/app` chat continues to work end-to-end.

### 1.3 Fix org-overlay stacking bug

This is technically a bug, not multi-tenancy work — current behavior
leaks one org's context into another for any user in multiple orgs,
even on a single-tenant install. Pulled into Phase 1 because it's
already shippable.

`lib/orgs.ts:syncOrgContextOverlays` writes overlays for **every** org
the user belongs to, and `lib/user-workspace.ts:258-262` stacks all of
them into `instructions:` before the personal files. A consultant who
belongs to two competitor orgs leaks both orgs' context into every
session.

- Add `active_org_id` to either the user's session or a column on
  `profiles`. Default `null` = personal mode (no org overlays).
- Settings UI: org switcher in the header / left rail.
- `syncOrgContextOverlays` only emits the active org's overlay files;
  removes others.
- Make the session-creation API (`/api/opencode/session`) accept and
  validate `active_org_id` against `org_members` before stamping it
  on the session.
- Acceptance:
  - User in orgs A + B with active=A: workspace `glossary.org.A.md`
    present, `glossary.org.B.md` absent.
  - Switching to active=B swaps them; chat that started in A is
    flagged as "this chat used org A's context" and cannot be
    silently re-scoped.
  - Setting `active_org_id` to an org the user isn't in → 403.

### 1.4 Per-user OpenRouter key

Today every session bills against one shared key in opencode's env.
First user with a runaway loop bills the whole org.

- New table: `provider_keys(user_id uuid, provider text, encrypted_key text, created_at timestamptz)`, RLS by `auth.uid()`. Encrypt via Supabase Vault (`pgsodium`).
- New route: `app/api/settings/provider-keys/route.ts` — GET (lists with masked values), POST (upsert), DELETE.
- New page: `app/app/settings/page.tsx` — form to paste a key per provider.
- Modify `lib/opencode-client.ts:sendPrompt` (line 34) to fetch the user's key, pass via session config (opencode supports per-session model config; check
  `/home/agent/opencode/packages/opencode/src/cli/cmd/serve.ts` for the exact field name).
- Fallback to shared env key only if the user has no per-user key configured (toggle this off once Phase 2 begins).
- Acceptance:
  - Two users with different keys can chat concurrently and each sees usage on their own OpenRouter dashboard.
  - User with no key configured is told to add one (not silently billed to the shared key).

---

## Phase 2 — Before paying users

Gate: do not accept money until these ship. Implies real reliability
SLAs, real billing exposure, real abuse vectors.

### 2.1 Per-user pip target

`pip install foo` from the agent's Bash currently lands in
`/home/agent/zap/.venv/` — every user inherits it on their next
session, and version conflicts cascade.

- Convention: when the agent needs a new package, it runs
  `pip install --target=<WORKSPACE>/.python_libs <pkg>` (we already use
  this pattern for the global `pypdf` / `python-pptx` installs — see
  `scripts/ingest_pdf.py:144`, `scripts/ingest_pptx.py:56`).
- All Python subprocesses spawned from grid-app set `PYTHONPATH` to
  prepend the user's `.python_libs/`:
  - `lib/user-workspace.ts:268-274` — MCP server env block
  - `lib/review.ts:16` (`reviewFeatureDetached`) — pass `env`
  - All `spawn` sites in `app/api/upload/**/route.ts` and
    `app/api/fetch/route.ts`
- Workspace `AGENTS.md` (the template in `lib/user-workspace.ts`)
  documents the convention so the agent uses `--target` automatically.
- zap stays in the shared venv read-only.
- Acceptance:
  - User A installs `requests==2.30`; user B's session sees the venv's
    original version, not 2.30.
  - `which python` in the MCP subprocess still resolves to the shared
    interpreter; `python -c "import <userpkg>"` works only inside A's
    workspace.

### 2.2 Per-user solve concurrency limits + tool-run visibility

A 1000-bus planning run blocks the event loop on the VM and starves
every other user. Today grid-app is a passive observer of the SSE
stream — it can't block a tool call before it runs, can't time-bound
it, can't refuse it, can't bill it. This item fixes both at once.

**Pattern: `may_I_proceed()`.** The MCP server (`scripts/user-mcp-server.py`)
gets a two-line wrapper around its `tools/call` handler. Before invoking
the Python feature function, it asks grid-app for a slot; after the
function returns, it releases the slot. Features themselves don't
change; adding a new feature is still "drop a file in `features/`."

**Flow:**

```
MCP server tools/call
  → POST grid-app /api/internal/proceed
       { user_id, tool, args_digest, estimated_seconds? }
       ──► 200 { token, deadline }  OR  429 { retry_after, reason }
  → if 200: run the Python function
  → POST grid-app /api/internal/release
       { token, status, runtime_ms }
  → return JSON-RPC result
```

**Components to build:**

- `lib/concurrency.ts` — in-memory token bucket. Per-user limit
  (start: 1 zap solve in flight), global limit (start: 3). Cost cap
  / priority / preemption can layer in later without touching the
  MCP server.
- `app/api/internal/proceed/route.ts` — evaluates policy, reserves
  a slot, returns a token + deadline. 429 with `Retry-After` if
  over limit.
- `app/api/internal/release/route.ts` — frees the slot, finalizes
  the `tool_runs` row.
- New table: `tool_runs(id, user_id, tool, args_digest, token,
  started_at, expected_deadline, ended_at, runtime_ms, status, error)`.
  Powers the live-status view + audit + a future "cancel" button.
- Internal-only auth: these endpoints are gated by a shared token
  (`STEINMETZ_INTERNAL_TOKEN` in env) so only the MCP server can call
  them. Pairs with the Phase 1.2 opencode-fronting work — same
  pattern.
- The existing grid-app upload routes that already spawn detached
  Python (`app/api/upload/**`, `app/api/fetch`) also call `proceed`
  / `release` so the policy is unified.
- Hang detection: a small periodic sweep (or per-request lazy check)
  marks runs as `orphaned` when `now > expected_deadline + grace`
  with no `release`, and frees the slot.

**Trust note.** This is honest-broker enforcement, suitable for
non-adversarial users. A malicious feature could skip the proceed
call and run anything. Phase 3 (systemd resource slices) is what
makes resource limits enforceable by the kernel; once that's in,
`may_I_proceed` stays as the visibility / audit / UX layer and
cgroups handle the actual budget.

**Acceptance:**

- Two concurrent `iesp__solve` tool calls from the same user → second
  returns the 429 surfaced as a tool error the agent sees.
- Three concurrent solves from three users → all proceed; fourth
  queues.
- `tool_runs` row exists for every long tool call with start/end
  timestamps; orphaned runs get marked within the grace window.
- A request to `/api/internal/proceed` without the internal token
  returns 401.

### 2.3 Disk quotas + monitoring

One PPTX-heavy user can fill `/` and brick the VM for everyone.

- Mount `/home/agent/grid-workspaces` and `/home/agent/zap/.venv` on a
  separate filesystem (ext4 or xfs) so user usage can't take down the
  OS root.
- Enable quotas (`quotaon -aug` for ext4 + `usrquota,grpquota` mount
  opts, or `xfs_quota` for xfs). Default per-user: 5 GB workspace,
  hard limit 10 GB.
- Cron-job (`scripts/quota_check.sh`) that `du -sh`s each workspace,
  flips `profiles.over_quota=true` when >80%, and rejects new
  uploads in `app/api/upload/**/route.ts` until cleared.
- Prometheus / Grafana stub: process CPU, disk free, opencode RSS,
  active sessions. Even a one-pager `/api/admin/health` returning JSON
  is enough until you need a real dashboard.
- Acceptance:
  - User uploads 11 GB → second upload after the 80% mark is rejected
    with a clear error.
  - `df -h` on `/` shows workspace usage on its own filesystem.

---

## Phase 3 — OS-level execution isolation

Gate: do not onboard users from different organizations (or any user you
don't personally trust) until this ships. Phases 1 + 2 close every
*application-layer* gap; Phase 3 is where isolation becomes
**kernel-enforced** rather than honest-broker. After this phase, a
malicious feature, runaway loop, or compromised session is bounded by
Linux UIDs and cgroups — not by the agent's good intentions.

### 3.1 Per-user Linux account

- On user signup (in `lib/user-workspace.ts:ensureUserWorkspace`),
  `useradd --system --no-create-home --home /home/agent/grid-workspaces/<uid>
  steinmetz-<short-uid>` (use a hash of the supabase uid to keep the
  Linux username under 32 chars).
- `chown -R steinmetz-<short-uid>:steinmetz` on the workspace dir;
  `chmod 700`.
- grid-app process runs as `agent`, in group `steinmetz`, so it can
  read workspace metadata but workspace contents are owned per-user.

### 3.2 Per-user opencode server

- systemd template unit `/etc/systemd/system/steinmetz-opencode@.service`,
  parameterized by `<short-uid>`. Runs as `User=steinmetz-<short-uid>`,
  binds Unix socket `/run/steinmetz/<short-uid>.sock` (mode 0660,
  group `steinmetz` so grid-app can connect).
- grid-app's `lib/opencode-client.ts` picks the right socket per request
  by looking up the user's short-uid.
- `lib/opencode-client.ts:createSession` triggers
  `systemctl start steinmetz-opencode@<short-uid>` (idempotent) on
  first session-start of the day; idle eviction handled by the unit
  having `TimeoutStopSec=` and a small watchdog process that stops
  units idle >30 min.
- Acceptance:
  - Two concurrent users have two distinct `systemctl status
    steinmetz-opencode@*` units running.
  - Killing user A's unit doesn't affect user B's chat.
  - Idle user's unit stops within 30 min; reconnect spins it back up.

### 3.3 Per-user Python environment

- Per-user venv at `/home/steinmetz-<short-uid>/.venv/` (or under the
  workspace).
- zap installed once system-wide, exposed to each user venv via a
  read-only `.pth` file or by adding the system site-packages to each
  user venv's `sys.path` head. User-installed packages land in their
  own venv, can't shadow zap.
- Replace `STEINMETZ_PY` plumbing (`lib/user-workspace.ts:6`,
  `lib/review.ts:11`, `scripts/fetch_url.py:50`, etc.) to resolve the
  per-user interpreter from the user's short-uid.
- Acceptance:
  - User A `pip install requests==2.20`; user B's `import requests`
    still resolves to the system-installed version.
  - Both users' agents can `import zap` and run dispatch.

### 3.4 systemd resource limits per user

- Per-user `Slice=steinmetz-<short-uid>.slice` in the opencode unit.
  Slice defaults: `MemoryMax=4G`, `CPUQuota=200%`, `IOWeight=100`.
- Tunable per-user later via a `profiles.compute_tier` column.
- Acceptance:
  - User A's runaway 50 GB allocation gets OOM-killed inside their
    slice; the VM and other users are unaffected.
  - `systemctl status steinmetz-<uid>.slice` shows live CPU / mem
    accounting per user.

---

## Cross-cutting concerns

These aren't a phase — they thread through all three.

- **Audit log scope.** `audit_log` exists (`supabase/schema.sql:374`).
  Every phase adds events: permission denials, quota rejections, key
  rotations, slice OOM kills, org-context switches. Wire them in as
  you ship each item; don't backfill.
- **Secrets handling.** Move both the Supabase service-role key
  (`grid-app/.env.local`) and the OpenRouter shared key out of plain
  env files into a real secrets store (sops, doppler, fly secrets,
  whatever the deploy target supports) before Phase 2.
- **Backups.** Supabase handles DB. Workspace filesystem currently has
  none. Decide before Phase 2: nightly rsync of
  `/home/agent/grid-workspaces` to S3 or equivalent, or treat
  workspaces as derivable from DB + sources and accept reset risk.
- **Cost telemetry.** Tokens-per-user, USD-per-user, per-day. Surface
  in `/app/settings`. Cap defaults in profile (free tier: $5/day).
  Belongs late in Phase 2; depends on per-user keys (1.4) being in
  place.
- **CI gate.** No phase ships without `npm run build` exit 0 + a smoke
  test that another user's data isn't reachable from the just-shipped
  workspace. Land that smoke test (`scripts/cross_user_smoke.sh`?)
  alongside Phase 1.1.

## Anti-goals

- No containers, no orchestrator, no second VM. Everything below runs
  as Linux users + systemd units on the existing machine. If single-VM
  ever stops being enough, that is a separate escalation
  (`TIER3_EXPANSION.md`), not a deviation inside this roadmap.
- No custom opencode fork divergence. Permission tightening goes in
  the workspace `opencode.jsonc`; auth gating goes in front of
  opencode, not inside it. The fork stays clean against upstream
  `dev`.
- No premature row-level encryption. Supabase Vault for provider keys,
  not for general artifact contents. Revisit if a customer asks.
- No re-architecture of the MCP-as-tools model. `may_I_proceed` (item
  2.2) is the *only* way grid-app gates per-tool execution; do not
  introduce a parallel "operations are HTTP endpoints" catalog.

## Sequencing summary

| Phase | Gate | Items |
|---|---|---|
| 1 | before user #2 | 1.1 perms, 1.2 token, 1.3 org overlay fix, 1.4 per-user keys |
| 2 | before paying users | 2.1 pip target, 2.2 concurrency, 2.3 quotas |
| 3 | before any user you don't trust | 3.1 OS users, 3.2 per-user opencode, 3.3 per-user venv, 3.4 systemd limits |

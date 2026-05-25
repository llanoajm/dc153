## Current item (from LOOP_QUEUE.md line 82)
- [x] 2.3 Disk quotas + monitoring (HARDENING_ROADMAP §2.3)

## Attempt
1 of 5

## Context to load before working
- HARDENING_ROADMAP.md   (the infrastructure roadmap this queue is derived from — read the section matching the item's "§N.N" pointer end-to-end before touching code)
- ROADMAP.md             (the product roadmap — context for which features the hardening work has to keep working; don't add product features from here)
- STATE.md               (current build cursor — what's wired today, recent decisions, gotchas)
- AGENTS.md              (project conventions; treat as authoritative)
- CLAUDE.md              (re-exports AGENTS.md — same source of truth)
- supabase/schema.sql    (canonical schema; user has to paste any changes you make into Supabase — call that out in your summary if you change it)
- LOOP_QUEUE.md                 (this queue you're working from)
- recent tail of LOOP_JOURNAL.md

## Protocol
1. Read the context above plus the acceptance criteria nested under the
   current item in LOOP_QUEUE.md, and the matching §N.N section of HARDENING_ROADMAP.md.
2. Implement the item against those acceptance criteria. Run `npm run build`
   (and any other checks the criteria name) before concluding.
3. Commit your code changes with a descriptive conventional-commit message.
4. Overwrite LOOP_HANDOFF.md to end with EXACTLY these fields, one per line:
   STATUS: done | partial
   SUMMARY: <1 sentence, will be embedded in the loop's tag commit>
   NEXT_STEPS: <only if partial; concrete handoff for the next agent>
   ACCEPTANCE: <which criteria pass, which don't>
   Do NOT commit LOOP_HANDOFF.md — the loop owns the bookkeeping commit.

## Constraints
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
SUMMARY: HARDENING §2.3 ships: scripts/quota_check.sh + profiles.over_quota tripwire, upload routes return 507 when over-quota, app/api/admin/health JSON probe, infra/QUOTA.md runbook for mount + quotaon (USER MUST RE-PASTE supabase/schema.sql to pick up profiles.over_quota).
NEXT_STEPS: (none — done)
ACCEPTANCE:
- scripts/quota_check.sh exists, walks workspaces with `du -sbx`, flips profiles.over_quota at the 80% mark via PostgREST PATCH; --dry-run honored; verified locally against the live workspace dir (1 workspace at 0.05GB, correctly classified ok). PASS.
- supabase/schema.sql + public/schema.sql add `over_quota boolean not null default false` to profiles via `alter table ... add column if not exists`. PASS (pending user paste).
- app/api/upload/{route,pdf,source}/route.ts call checkUserQuota and return HTTP 507 with `{ error: "over_quota", message }` when the caller's flag is true. PASS.
- app/api/admin/health/route.ts exists, returns JSON with process CPU + load_average, disk free + workspace bytes, opencode pids/RSS, active sessions/runs + tool_runs counters, concurrency snapshot. Gated by STEINMETZ_ADMIN_EMAILS env allowlist (403 for non-admins; 200 for admins). PASS.
- Mount + quotaon docs committed at infra/QUOTA.md covering filesystem split, `quotaon -aug`, group/user setquota, cron schedule, in-app verification, and the health endpoint. PASS.
- `npm run build` exits 0 (verified; preexisting NFT warning on app/api/upload/pdf/route.ts is unrelated to this work). PASS.

VERIFIED: yes

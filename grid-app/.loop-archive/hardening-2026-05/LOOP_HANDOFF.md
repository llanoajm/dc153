## Current item (from LOOP_QUEUE.md line 119)
- [ ] 3.4 systemd resource limits per user (HARDENING_ROADMAP §3.4)

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
SUMMARY: HARDENING §3.4 ships as opt-in scaffolding — `infra/systemd/steinmetz-%i.slice` template (MemoryMax=4G/CPUQuota=200%/IOWeight=100), `Slice=steinmetz-%i.slice` added to the opencode unit, `lib/compute-tier.ts` exposes `COMPUTE_TIERS`/`resolveComputeTier`/`ensureUserSlice` (sudo install + daemon-reload, gated on `STEINMETZ_PER_USER_SLICES=1`), `ensureUserWorkspace` calls it after `ensureLinuxAccount`, `supabase/schema.sql` adds nullable `profiles.compute_tier` (USER MUST PASTE UPDATED SCHEMA INTO SUPABASE), and `infra/systemd/README.md` + `STATE.md` document host prereqs + materialisation.
NEXT_STEPS: (1) Once the host sudoers entry from STATE.md is added, flip `STEINMETZ_PER_USER_SLICES=1` alongside `STEINMETZ_ENABLE_LINUX_ACCOUNTS=1` and `STEINMETZ_PER_USER_OPENCODE=1` and run the OOM smoke from `infra/systemd/README.md` Step 7. (2) Surface a settings UI for `profiles.compute_tier` and trigger `ensureUserSlice(userId, tier)` on change — today a tier change requires a manual `sed`+`install`+`daemon-reload` walk (also documented in Step 7).
ACCEPTANCE:
 - PASS — opencode template references `Slice=steinmetz-%i.slice` (`infra/systemd/steinmetz-opencode@.service`).
 - PASS — slice template `infra/systemd/steinmetz-%i.slice` committed with `MemoryMax=4G`, `CPUQuota=200%`, `IOWeight=100`.
 - PASS — `supabase/schema.sql` adds nullable `profiles.compute_tier`; `lib/compute-tier.ts:resolveComputeTier` resolves `low|default|high` (unknowns → default).
 - PASS — operational note: `infra/systemd/README.md` Step 7 + `STATE.md` hardening-flag entry document materialisation, sudoers, and verification.
 - PASS — `npm run build` exits 0 (also see `next build` route list in the log).
 - DEFERRED — behavioural OOM smoke is documented in the README but not exercised here because the VM doesn't yet have the §3.4 sudoers entry installed nor the flag flipped; once the operator completes both, the documented `systemd-run --slice=…` smoke executes the kill.

VERIFIED: yes

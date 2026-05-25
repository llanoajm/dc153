## Current item (from LOOP_QUEUE.md line 54)
- [ ] 1.4 Per-user OpenRouter key (HARDENING_ROADMAP §1.4)

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
SUMMARY: Added provider_keys table + RLS, /api/settings/provider-keys (GET/POST/DELETE), /app/settings UI, and lib/opencode-client refreshes the user's workspace `.opencode/opencode.jsonc` `provider.openrouter.options.apiKey` from the DB before each createSession/sendPrompt — opencode's config loader merges that over the env key per request, so per-user keys bill against the user with no fork modification. SCHEMA CHANGED: paste updated supabase/schema.sql into Supabase + set STEINMETZ_PROVIDER_KEYS_SECRET in .env.local (openssl rand -hex 32) before the table or settings page work.
NEXT_STEPS: n/a
ACCEPTANCE:
- pass: `supabase/schema.sql` adds `provider_keys(user_id, provider, encrypted_key, created_at)` with RLS by `auth.uid()`. Schema also carries `id uuid primary key`, `key_hint text`, `updated_at timestamptz`, and a partial unique index on (user_id, provider) so each user has at most one row per provider. Encryption path: AES-256-GCM keyed off `STEINMETZ_PROVIDER_KEYS_SECRET` (documented in `.env.example`); Supabase Vault / pgsodium called out in the schema comment as the future migration target and out of scope here.
- pass: `app/api/settings/provider-keys/route.ts` exists with GET (masked list — never round-trips plaintext), POST (upsert + workspace config refresh), DELETE (delete + config refresh).
- pass: `app/app/settings/page.tsx` exists with a per-provider form (currently the supported set is just `openrouter`; SUPPORTED_PROVIDERS is the single chokepoint for adding more).
- pass: `lib/opencode-client.ts` `sendPrompt` (and `createSession`) call `getUserProviderKeysMap(userId)` + `writeUserProviderConfig(dir, keys)` before posting to opencode. The key is written into `<workspace>/.opencode/opencode.jsonc` under `provider.openrouter.options.apiKey`; opencode's config loader merges this over the env key at request time (verified in /home/agent/opencode/packages/opencode/src/provider/provider.ts:1224-1268,1549 — config provider options are layered over env, with explicit precedence config > env > auth). When no per-user key is stored the provider block is empty and opencode falls back to the shared env key, preserving the today behaviour.
- pass: `npm run build` exits 0 (run from grid-app; static analysis + 30 routes prerendered, pre-existing Turbopack warning about `app/api/upload/pdf/route.ts` is unchanged).
- caveats (not blockers, documented):
  - Plaintext keys land on disk in each user's workspace `opencode.jsonc` (mode 644). Until §3.1 chowns workspaces per-Linux-user, anyone with VM shell can `cat` them. Same blast radius as the existing shared env key — no regression — but worth flagging in STATE.md once you wire the §3.1 plumbing so the chown order-of-operations is clear.
  - The Settings page rail entry is appended after Panels. If you want it at the top (account stuff usually lives above content), reorder DEFAULT_SECTIONS in `components/shell/LeftRail.tsx`.
  - `STEINMETZ_PROVIDER_KEYS_SECRET` rotation invalidates every stored key. Documented in `.env.example`.
VERIFIED: yes

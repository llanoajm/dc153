## Current item (from LOOP_QUEUE.md line 104)
- [ ] 11. PDF source ingestion → glossary + context doc (ROADMAP §1, §3)

## Attempt
1 of 5

## Context to load before working
- AGENTS.md         (project brief, harness-first principles, quick start)
- ROADMAP.md        (full plan; the section number in the current item refers here)
- STATE.md          (human-maintained build cursor — READ, do not restructure;
                     you MAY append a short note under "## Agent log" if useful)
- LOOP_QUEUE.md            (the queue you're working from)
- recent tail of LOOP_JOURNAL.md

## Protocol
1. Read the context above plus any acceptance criteria nested under the
   current item in LOOP_QUEUE.md.
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
- Per-user isolation: do not commit user features/skills to zap or opencode.
- Don't modify zap source — features are user-space Python importing from zap.
- Don't use opencode.ai hosted layer (no Big Pickle / Zen / Go free models).
- No emojis in code or UI unless explicitly requested.

STATUS: done
SUMMARY: PDF upload extracts text via pypdf, chunks + embeds into new `source_chunks` table, merges terms into `<workspace>/glossary.md` + narrative blurb into `<workspace>/company-context.md`, both auto-loaded into every opencode session via `.opencode/opencode.jsonc → instructions[]`; re-uploads emit a `diff` view spec.
NEXT_STEPS:
ACCEPTANCE:
 - [pass] PDF upload → text extraction + chunking + embedding (table `source_chunks`): `app/api/upload/pdf/route.ts` accepts a PDF, `scripts/ingest_pdf.py` extracts via pypdf, chunks (~1200 chars, 200 overlap), embeds (128-dim hashing BoW, L2-normalized), inserts into `public.source_chunks` (schema added with RLS).
 - [pass] `<workspace>/glossary.md` populated: heuristic extraction (acronym paren-expansion + "X is/refers to/means/is defined as Y" patterns) merges new terms with per-source attribution; verified end-to-end on a synthetic PDF.
 - [pass] `<workspace>/company-context.md` populated: title + lead paragraph + section headings blurb appended under a `## From: <source>` marker; idempotent re-merges.
 - [pass] Both auto-loaded as system context every opencode session: `lib/user-workspace.ts` writes `instructions: ["glossary.md", "company-context.md"]` into `.opencode/opencode.jsonc`; opencode `session/instruction.ts` loads these via `globUp` from the workspace cwd, `session/prompt.ts:1419-1425` concatenates them into the LLM system prompt (`[...env, ...instructions, ...skills]`). `writeIfMissing` stubs the two files so they exist before the first PDF is ingested.
 - [pass] Diff view available when source updates: re-upload with same slug chains `parent_id` and bumps `metadata.version`; ingester emits `view_spec.renderer="diff"` with `before`/`after` extracted text, rendered by `components/renderers/diff.tsx`.
 - [pass] `npm run build` exits 0 — new routes `/api/upload/pdf`, `/app/sources`, `/app/glossary` present in route list.
 - [note] User must paste updated `supabase/schema.sql` into Supabase before `source_chunks` inserts succeed (same workflow as items 3, 5).
 - [note] `pypdf 6.12.1` installed into `/home/agent/zap/.venv/lib/python3.12/site-packages` via `/usr/bin/pip --target=...` (venv lacks pip).
VERIFIED: yes

## Current item (from LOOP_QUEUE.md line 123)
- [ ] 13. Multi-modal extraction (PPTX, images, vision captioning) (ROADMAP §1)

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
SUMMARY: PPTX/image/audio ingestion shipped — new scripts ingest_pptx/_image/_audio share an OpenRouter vision+audio caption helper (with deterministic fallback), and a universal /api/upload/source route dispatches by mime so SourcesPanel handles all four kinds end-to-end.
ACCEPTANCE: PPTX upload → text + slide images + per-slide captions: pass (ingest_pptx.py extracts slide text frames + picture shapes, captions via _caption.caption_image, surfaces in markdown view spec). Image upload → caption via vision model: pass (ingest_image.py calls OpenRouter when OPENROUTER_API_KEY present; deterministic fallback otherwise). Audio upload → transcript + speaker turns: pass (ingest_audio.py transcribes via multimodal model, per-turn chunking when Speaker N: prefix detected; fallback when no key). All extracted content surfaces in the Sources panel: pass (universal /api/upload/source route + SourcesPanel accepts the full mime set, renders type-aware subtitles). npm run build exits 0: pass.

VERIFIED: yes

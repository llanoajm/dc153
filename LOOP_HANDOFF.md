## Current item (from LOOP_QUEUE.md line 39)
- [ ] 4. Smoke-validate the existing GPU consumers (ROADMAP §4)

## Attempt
1 of 5

## Context to load before working
- GPU_UNBLOCK_ROADMAP.md          (full roadmap for this loop; the queue item points to a §section here)
- GPU_PARITY_ROADMAP.md           (precedent roadmap; §Phase B.4 / §Phase C.5 / §Phase C.6 are the original specs for items 1-3)
- AGENTS.md                       (project rules: harness-first principle, no-zap-edits in end-user mode, no-emoji, no-deps, conventional commits)
- CLAUDE.md                       (one-line include of AGENTS.md)
- STATE.md                        (current build cursor — what's freshly shipped, what's wired)
- infra/modal/solver_app.py       (deployed Modal app;  returns the payload items 1-2 must adapt)
- infra/modal/PARITY_REPORT.md    (item 9's parity numbers — historical 4.22% LMP diff on ieee-30 is the baseline for items 2 and 4)
- lib/modal-solver.ts             (TS client;  interface mirrors the payload shape on the frontend)
- scripts/smoke_dispatch.py       (CPU baseline  returns  — item 2 extends this; item 3 callers depend on it)
- scripts/run_artifact.py         ( is the downstream consumer; item 1's adapter output must satisfy this contract)
- scripts/_gpu_parity_report.py   (item 9;  is the reference HTTP-call code for item 2)
- scripts/user-mcp-server.py      (item 7;  is the agent-path GPU caller — item 4 smokes it, item 5 cross-checks it against  CLI)
- scripts/seed_networks.py        (item 3 target — adds  flag, forwards through run_dispatch)
- scripts/ingest_pypsa_folder.py  (item 3 target — same pattern)
- data/networks/ieee-30/          (the canonical test network referenced by every acceptance bullet)
- LOOP_QUEUE.md            (the queue you're working from)
- recent tail of LOOP_JOURNAL.md

## Protocol
1. Read the context above plus any acceptance criteria nested under the
   current item in LOOP_QUEUE.md.
2. Implement the item against those acceptance criteria. Run `python scripts/smoke_dispatch.py data/networks/ieee-30 --hours 1 && npm run build`
   (and any other checks the criteria name) before concluding.
3. Commit your code changes with a descriptive conventional-commit message.
4. Overwrite LOOP_HANDOFF.md to end with EXACTLY these fields, one per line:
   STATUS: done | partial
   SUMMARY: <1 sentence, will be embedded in the loop's tag commit>
   NEXT_STEPS: <only if partial; concrete handoff for the next agent>
   ACCEPTANCE: <which criteria pass, which don't>
   Do NOT commit LOOP_HANDOFF.md — the loop owns the bookkeeping commit.

## Constraints
- Do NOT modify /home/agent/zap source. In end-user mode the agent is forbidden from editing zap (AGENTS.md). All work in this loop is in /home/agent/grid-app/scripts/ — zap is consumed as a library.
- Do NOT delete or alter the CPU path's return shape.  must still return  for CPU callers. GPU adapts to CPU, never the other way around (GPU_PARITY_ROADMAP.md §Design).
- Do NOT introduce a CPU-vs-GPU auto-tiering heuristic.  is a manual choice everywhere. Auto-routing is explicitly out of scope (see GPU_PARITY_ROADMAP §Design).
- Do NOT use opencode.ai hosted services (Big Pickle, OpenCode Zen, OpenCode Go free models). Direct providers only.
- Do NOT commit secrets.  holds ZAP_SOLVER_API_KEY, Supabase service-role keys, and OpenRouter keys — never stage them.
- Do NOT add npm or pip dependencies a few lines of code could replace.
- No emojis in code or user-facing strings.
- Modal redeploys take 3-5 min after image changes — none of items 1-5 should need a redeploy (Modal endpoint is unchanged from item 3 of the prior loop). If you find yourself running Usage: modal deploy [OPTIONS] APP_REF

  Deploy a Modal application.

  **Usage:** modal deploy my_script.py modal deploy -m my_package.my_mod

Options:
  --name TEXT                    Name of the deployment.
  -e, --env TEXT                 Environment to interact with. If unspecified,
                                 defers to `MODAL_ENVIRONMENT`, your active
                                 local profile, or your workspace default, in
                                 that order.
  --stream-logs                  Stream logs from the app upon deployment.
  --tag TEXT                     Tag the deployment with a version.
  -m                             Interpret argument as a Python module path
                                 instead of a file/script path
  --timestamps                   Show timestamps for each log line.
  --strategy [rolling|recreate]  Deployment strategy
  -h, --help                     Show this message and exit., stop and re-read the acceptance criteria.
- The previous loop archived its state under . Read it if you need history on items 4-6's earlier failed attempts (the original §Phase B.4 / C.5 / C.6 — now renumbered 1-3 in this loop). Do not modify .loop-archive.
- If  or  is missing from , items 2, 4, and 5 cannot complete. Report this as the genuine blocker rather than rubber-stamping ACCEPTANCE.

STATUS: done
SUMMARY: Smoke-validated MCP solve_opf's CPU + GPU branches via scripts/_smoke_solve_opf.py and refreshed PARITY_REPORT.md (ieee-30 holds at 4.22% max-rel LMP diff, well under the 5% bar).
ACCEPTANCE: pass — `python scripts/_gpu_parity_report.py` exits 0 and rewrites infra/modal/PARITY_REPORT.md; ieee-30 max-rel LMP diff = 4.22% (≤ 5%, well below the 6% regression line). pass — new scripts/_smoke_solve_opf.py imports user-mcp-server.py (via importlib because of the hyphen) and exercises `_solve_via_modal` for gpu=True plus `smoke_dispatch.run_dispatch` for gpu=False against data/networks/ieee-30; both branches return the documented tuple shape with non-empty, all-finite (30,1) price grids. pass — `_smoke_solve_opf.py` exits 0; the Supabase-row-write half of `_builtin_solve_opf` is intentionally bypassed per the documented workaround in the script's docstring (avoids dragging service-role auth and a real workspace network artifact into a self-contained smoke). pass — loop-protocol checks `python scripts/smoke_dispatch.py data/networks/ieee-30 --hours 1` (CPU, exit 0, prices shape (30,1)) and `npm run build` (exit 0) both succeed.

VERIFIED: yes

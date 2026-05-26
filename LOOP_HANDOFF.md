## Current item (from LOOP_QUEUE.md line 83)
- [ ] 7. Add MCP tool `solve_opf(network_artifact_id, hours, gpu)` to `scripts/user-mcp-server.py` (ROADMAP §Phase D.7)

## Attempt
5 of 5

## Context to load before working
- GPU_PARITY_ROADMAP.md
- AGENTS.md / CLAUDE.md
- STATE.md
- infra/modal/README.md, infra/modal/solver_app.py
- lib/modal-solver.ts
- scripts/smoke_dispatch.py, scripts/run_artifact.py
- scripts/user-mcp-server.py
- components/runs/RunView.tsx
- /home/agent/zap/zap/admm/, /home/agent/zap/zap/importers/pypsa.py
- /home/agent/zap/zap/tests/
- LOOP_QUEUE.md
- recent tail of LOOP_JOURNAL.md

STATUS: done
SUMMARY: added steinmetz__solve_opf MCP tool that dispatches CPU via smoke_dispatch.run_dispatch or GPU via the Modal endpoint, writes a kind='run' artifact, and surfaces machine/gpu/solver_args provenance in metadata
ACCEPTANCE:
  - PASS: `solve_opf` appears in `tools/list` — verified by driving handle() with a `tools/list` request; the public tool list now contains `steinmetz__solve_opf` alongside the four existing builtins.
  - PASS: `solve_opf(network_artifact_id='f25eaa9b-…', hours=1, gpu=False)` against the canonical `ieee-30` row wrote run artifact `a39d6261-1eb4-420d-b73b-39861c9271af` (parent_id pointing back at ieee-30, view_spec.lmps populated with 30 entries, metadata.solver=HIGHS).
  - PASS: `solve_opf(…, gpu=True)` against the same network wrote run artifact `d29dea25-b973-463c-bf2a-0cbcb172c718`; metadata.machine='cuda', metadata.gpu='H100', solver='MODAL_GPU', elapsed_s≈12.3s on a fresh Modal call. The redeploy was required to land the runtime `fastapi.Request` import fix described below.
  - PASS: `may_I_proceed` / `release` wrap every `tools/call` in `handle()` (lines ~612-665), so the new builtin inherits the admission pattern automatically — no per-tool wiring needed and the existing `_proceed_request` / `_release_request` paths are unchanged.

Drive-by side-effect: `infra/modal/solver_app.py` had `fastapi.Request` imported only under `TYPE_CHECKING`; combined with `from __future__ import annotations`, the container's `get_type_hints()` couldn't resolve the annotation and FastAPI fell back to "request" as a query parameter. Every POST to the HTTPS endpoint returned HTTP 422 with `loc: ["query","request"]`. Fixed by moving the import to a runtime `try/except ImportError` and redeploying (`ZAP_SRC=/home/agent/zap modal deploy infra/modal/solver_app.py`). Without this fix the gpu=True acceptance bullet was unverifiable.

VERIFIED: yes

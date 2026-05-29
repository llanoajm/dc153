# Loop Queue — Workspaces redesign + chat-centric UX + planning hero

Legend: `[ ]` pending · `[x]` done · `[!]` blocked (manual review).
Source roadmap: `REDESIGN_ROADMAP.md` (each item points to its number there).
Design rationale + the §11 GUARDRAILS: `WORKSPACE_REDESIGN.md`.

GUARDRAILS (hard): prod is live on :3000 via `next start` from this checkout —
NEVER run `next build`/`npm run build`/`npm run dev`/`npm run start` or disturb
:3000; verify with `npx tsc --noEmit && npm run test:unit` only. Never edit
`/home/agent/zap`. Never auto-apply DDL to the live Supabase DB (write `.sql` +
backfill for a human). Build additively; the harness owns rollback.

Order matters: foundation (1-3) → chat UX (4-8) → gallery/wizard (9-11) →
planning hero (12-15) → polish (16). Process top-to-bottom.

---

- [x] 1. Additive schema migration: workspaces table + artifacts.workspace_id (ROADMAP §1)
  - context: idempotent SQL from WORKSPACE_REDESIGN.md §4.1–4.2; RLS mirrors artifacts.
  - acceptance:
    - new `supabase/migrations/0001_workspaces.sql` with the `workspaces` table, 4 RLS policies, and `artifacts.workspace_id` column + index, verbatim from §4.1/§4.2, re-pasteable on top of `supabase/schema.sql`
    - `supabase/schema.sql` updated so a fresh paste includes the new objects
    - SQL is NOT applied to the live DB; parse-check only (or mark `[!]` if no parser available, noting why)

- [x] 2. Backfill script: default workspace per user (ROADMAP §2)
  - context: §4.3; one-time, service-role, idempotent.
  - acceptance:
    - `scripts/backfill_workspaces.(py|ts)` creates a default "My workspace" per user, sets `workspace_id` on their artifacts/features, leaves canonical (`user_id NULL`) networks at `workspace_id NULL`
    - `--dry-run` prints planned changes and writes nothing (real apply gated behind explicit `--apply`)
    - re-running `--dry-run` post-apply would be a no-op (idempotent by design)

- [x] 3. ensureWorkspace(workspaceId) + per-workspace dir (ROADMAP §3)
  - context: §4.4; generalize lib/user-workspace.ts to per-workspace dir; keep a back-compat shim.
  - acceptance:
    - `lib/workspace.ts` exports `ensureWorkspace(workspaceId)` materializing `grid-workspaces/<workspace-id>/` and recording the primary network in `.steinmetz/workspace.json`
    - opencode session creation accepts a `workspaceId` and opens with `cwd` = that dir (thread through lib/opencode-client.ts)
    - `npx tsc --noEmit` passes; existing per-user path still compiles

- [x] 4. Chat persistence + chats store (ROADMAP §4)
  - context: §10; chats stored per workspace, mapping title + opencode session id.
  - acceptance:
    - new `supabase/migrations/0002_chats.sql` (a `chats` table) OR documented `kind='chat'` artifact approach; first message persists a chat (workspace id, session id, title, created_at)
    - a GET route lists a workspace's chats; opening a past chat reloads its messages
    - `npx tsc --noEmit && npm run test:unit` passes; a unit test covers create→list→reopen of the store layer

- [x] 5. Left sidebar: {single Network, Chats, profile} (ROADMAP §5)
  - context: §10; rework components/shell/LeftRail.tsx + WorkspaceShell.
  - acceptance:
    - sidebar shows the single network at top, a chat-history list with a new-chat button, and a profile circle pinned bottom-left whose menu holds account + Sign out
    - the top-right header logout is removed (grep shows no header signout)
    - `npx tsc --noEmit` passes

- [x] 6. Remove the right context rail (ROADMAP §6)
  - context: §10; delete components/shell/RightRail.tsx and its usage.
  - acceptance:
    - `grep -rn RightRail components app` returns nothing (file + imports gone)
    - WorkspaceShell reflows with no empty reserved column; `npx tsc --noEmit` passes

- [x] 7. In-chat file upload (+ in composer) (ROADMAP §7)
  - context: §10; attach control uploads via existing /api/upload; show attachment chip; file also appears in Sources.
  - acceptance:
    - composer has an attach button; selecting a file POSTs to /api/upload and renders a sent/attachment chip in the thread
    - the uploaded artifact appears in the existing Sources/Networks listing
    - `npx tsc --noEmit && npm run test:unit` passes; a unit test covers the upload-call wiring

- [x] 8. Premium visual refresh of the chat surface (ROADMAP §8)
  - context: §10; ChatGPT/Gemini-grade, simple but premium; reuse existing CSS vars/fonts; no heavy deps.
  - acceptance:
    - chat page (message rows, empty state, composer) restyled to a clean modern layout; tool-call cards still render correctly
    - `npx tsc --noEmit` passes; note in LOOP_JOURNAL.md that the "premium feel" is pending human visual review (do not run a browser against :3000)

- [x] 9. Workspace gallery at /app (ROADMAP §9)
  - context: §5; cards (cover image, name, grid, focus chips, last activity) + a New-workspace card; workspaces under /app/w/[id].
  - acceptance:
    - `/app` lists the user's workspaces as cards from the `workspaces` table; "＋" opens the wizard (item 10); a card opens `/app/w/[id]`
    - `npx tsc --noEmit` passes

- [x] 10. Creation wizard (ROADMAP §10)
  - context: §5; name → focus multi-select → data source (template/fetch/upload/skip) → land in workspace chat.
  - acceptance:
    - wizard creates a `workspaces` row with name + focus[] + optional primary_network_id and redirects to `/app/w/[id]`
    - focus is multi-select; data-source step can pick a canonical template or defer
    - `npx tsc --noEmit && npm run test:unit` passes; a unit test covers the create-workspace happy path

- [x] 11. Data Source tab (singular network) (ROADMAP §11)
  - context: §5; /app/w/[id]/source shows the one anchored grid; allow swap/add; template picker; "ask the agent to fetch" entry.
  - acceptance:
    - tab renders the workspace's primary network (topology + bus/line/carrier counts); changing it updates `workspaces.primary_network_id`
    - `npx tsc --noEmit` passes

- [x] 12. solve_plan MCP tool wrapping PlanningProblem.solve (ROADMAP §12)
  - context: §7; builtin in scripts/user-mcp-server.py building DispatchLayer → MultiObjective → InvestmentObjective → PlanningProblem(...).solve(...), writing a kind='plan' artifact.
  - acceptance:
    - driving the MCP server over stdio (as the existing list_networks verification does), `solve_plan` runs a SMALL CPU plan (few iterations) on `data/networks/ieee-30` end-to-end, returns a plan artifact id, and metadata carries history (loss, op_cost, inv_cost) + final caps
    - CPU-only, bounded iterations, finishes well under the work timeout; never requires GPU/Modal

- [x] 13. kind='plan' view_spec + renderer (ROADMAP §13)
  - context: §7; extend scripts/run_artifact.py (or new plan_artifact.py) + add components/renderers/plan.tsx.
  - acceptance:
    - a plan artifact's view_spec encodes loss curve, capacity trajectory, final-build table, resulting dispatch (reuse run renderer), and a cost-vs-emissions panel
    - components/renderers/plan.tsx renders them; `npx tsc --noEmit` passes

- [x] 14. Focus → planning-problem assembly helper (ROADMAP §14)
  - context: §6; helper mapping focus tags → parameter_names + objective composition.
  - acceptance:
    - given focus [Generation, Decarbonization] the helper returns free generator capacities + `DispatchCost + λ*Emissions` + `InvestmentObjective`
    - a python smoke (import + call against ieee-30 shapes) exits 0; `npx tsc --noEmit` passes if any TS added

- [ ] 15. Intent routing in the agent (no "zap", no UUID) (ROADMAP §15)
  - context: §10; update grid-engineer persona template so NL routes to dispatch (Run) vs planning (Plan) against the workspace's primary network.
  - acceptance:
    - persona template (in lib/workspace.ts / lib/user-workspace.ts) updated with routing rules + the workspace-network default (never ask for a UUID, never say "zap")
    - a documented transcript in REDESIGN_NOTES.md shows the two phrasings routing to solve_opf vs solve_plan (if full in-loop agent execution isn't feasible, note that and leave the template change as the deliverable)
    - `npx tsc --noEmit` passes

- [ ] 16. Ontology polish: features→Objectives, Runs&Plans tab, demote panels (ROADMAP §16)
  - context: §3,§5; rename features→Objectives in UI; add Runs & Plans tab; move generic panels into a secondary Library.
  - acceptance:
    - nav reflects the 5 nouns (Data Source, Chats, Objectives, Runs & Plans, Library); old routes still resolve
    - `npx tsc --noEmit` passes

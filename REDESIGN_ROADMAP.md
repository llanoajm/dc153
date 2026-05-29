# Redesign Roadmap — Workspaces + chat-centric UX + planning hero

Source design: `WORKSPACE_REDESIGN.md` (read it for rationale, ontology, schema,
IA, hero loop, and the §11 build guardrails). This file is the **ordered,
checkbox backlog** an autonomous loop drives. Legend: `[ ]` pending · `[x]` done
· `[!]` blocked (needs a human).

GUARDRAILS (from `WORKSPACE_REDESIGN.md` §11 — non-negotiable):
- Never stop/rebuild/restart the prod `next start` on `:3000`.
- Never `git reset --hard`/`clean`/discard existing working-tree changes; build
  additively; commit per item; never force-push.
- `npx tsc --noEmit` must pass before marking an item `[x]`.
- Do NOT auto-apply DDL to the live Supabase DB; write reviewed `.sql` + backfill
  under `supabase/` for a human to apply.
- UI checks via typecheck + Playwright/unit or a scratch dev server on a
  throwaway port — never prod `.next`/:3000.
- If acceptance can't be met safely, mark `[!]` and move on.

Order matters: foundation (1-3) before UX (4-8) before gallery/wizard (9-11)
before the planning hero (12-15) before polish (16). Process top-to-bottom.

---

### Foundation — workspace data model

- [ ] 1. Additive schema migration: `workspaces` table + `artifacts.workspace_id`
  - context: see `WORKSPACE_REDESIGN.md` §4.1–4.2. Idempotent `create table if
    not exists` / `add column if not exists`; RLS mirrors `artifacts` (own
    personal or member org).
  - acceptance:
    - new file `supabase/migrations/0001_workspaces.sql` containing the
      `workspaces` table, its 4 RLS policies, the `artifacts.workspace_id`
      column + index — copied verbatim from §4.1/§4.2 and re-pasteable on top of
      `supabase/schema.sql` without error
    - SQL parses (e.g. `psql --no-psqlrc -f … ` against a throwaway local pg, or
      a `sqlfluff`/`pg_query` parse) — NOT applied to the live DB
    - `supabase/schema.sql` updated to include the new objects so a fresh paste
      is complete
    - mark `[!]` with a note if no parser is available; do not apply to prod

- [ ] 2. Backfill script: default workspace per user
  - context: §4.3. One-time, service-role. Idempotent.
  - acceptance:
    - `scripts/backfill_workspaces.py` (or `.ts`) creates a "My workspace" per
      user that has artifacts/features, sets `workspace_id` on their rows, leaves
      canonical (`user_id NULL`) network rows at `workspace_id NULL`
    - runs in `--dry-run` mode printing the planned changes and exits 0 WITHOUT
      writing (real apply gated behind an explicit `--apply` flag a human runs)
    - re-running `--dry-run` after a hypothetical apply is a no-op (idempotent)

- [ ] 3. `ensureWorkspace(workspaceId)` + per-workspace dir
  - context: §4.4. Generalize `lib/user-workspace.ts` from per-user to
    per-workspace dir `grid-workspaces/<workspace-id>/`; record the workspace's
    primary network in `.steinmetz/workspace.json`. Keep a back-compat shim so
    existing per-user callers don't break.
  - acceptance:
    - `lib/workspace.ts` exports `ensureWorkspace(workspaceId)` returning the dir;
      materializes `.opencode/`, `features/`, venv, etc. (reuse existing logic)
    - opencode session creation can open with `cwd = <workspace dir>` given a
      workspace id (wire a `workspaceId` param through `lib/opencode-client.ts`)
    - `npx tsc --noEmit` passes; existing per-user path still compiles

### Chat-centric UX

- [ ] 4. Chat persistence + `chats` store
  - context: §10. Chats stored per workspace, mapping a title + opencode session
    id. Use a `chats` table (additive migration `supabase/migrations/0002_chats.sql`)
    or a `kind='chat'` artifact — pick one and document why.
  - acceptance:
    - sending the first message in a chat persists a chat row/artifact (workspace
      id, opencode session id, generated title, created_at)
    - `GET` route lists a workspace's chats; reload restores the list
    - opening a past chat reloads its messages from opencode
    - typecheck passes; a Playwright or unit test covers create→list→reopen

- [ ] 5. Left sidebar redesign: {single Network, Chats, profile}
  - context: §10. Rework `components/shell/LeftRail.tsx` (+ `WorkspaceShell`).
  - acceptance:
    - sidebar shows the workspace's single network at top, a chat-history list
      below (new-chat button), and a profile circle pinned bottom-left
    - profile circle opens a menu containing account + **Sign out**; the
      top-right header logout is removed
    - typecheck passes; Playwright asserts logout is reachable from the
      bottom-left profile menu and absent from the header

- [ ] 6. Remove the right context rail
  - context: §10. Delete `components/shell/RightRail.tsx` and its usage in
    `WorkspaceShell`; reflow so chat takes the center.
  - acceptance:
    - RightRail no longer imported/rendered anywhere (`grep` clean)
    - layout has no empty reserved column; typecheck passes; Playwright snapshot
      of `/app` shows chat centered

- [ ] 7. In-chat file upload (`+` in composer)
  - context: §10. Add a `+`/attach control to the chat composer that uploads via
    the existing `/api/upload`; show the attachment as a chip in the sent
    message; the file also appears in the Files/Sources tab.
  - acceptance:
    - composer has an attach button; selecting a file uploads it and shows a
      progress/sent chip in the chat
    - the uploaded artifact appears in the existing Sources/Networks listing
    - typecheck passes; a test exercises attach → upload call → chip render

- [ ] 8. Premium visual refresh of the chat surface
  - context: §10. ChatGPT/Gemini-grade: spacing, type, calm empty state, single
    focused composer. Reuse existing CSS vars/fonts; no new heavy deps.
  - acceptance:
    - chat page restyled (message rows, empty state, composer) to a clean modern
      layout; no layout regressions in tool-call cards
    - typecheck passes; Playwright snapshots for empty state + a populated thread
      look clean (reviewer/human confirms premium feel later)

### Workspace gallery + creation

- [ ] 9. Workspace gallery at `/app`
  - context: §5. Cards: cover image, name, grid, focus chips, last activity, plus
    a "＋ New workspace" card. Route workspaces under `/app/w/[id]`.
  - acceptance:
    - `/app` lists the user's workspaces as cards from the `workspaces` table
    - clicking a card opens `/app/w/[id]` (chat); "＋" opens the wizard (item 10)
    - typecheck passes; Playwright lists ≥1 seeded workspace card

- [ ] 10. Creation wizard
  - context: §5. name → focus multi-select → data source (template/fetch/upload/
    skip) → land in workspace chat with focus-tailored suggested prompts.
  - acceptance:
    - wizard creates a `workspaces` row with `name`, `focus[]`, optional
      `primary_network_id`; redirects to `/app/w/[id]`
    - focus is multi-select; data-source step can pick a canonical template or
      defer; typecheck passes; a test drives the happy path

- [ ] 11. Data Source tab (singular network)
  - context: §5. `/app/w/[id]/source` shows the one anchored grid (topology +
    bus/line/carrier counts), allows swap/add, template picker, and an
    "ask the agent to fetch" entry (uses existing `fetch_network`).
  - acceptance:
    - tab renders the workspace's primary network; can change it (updates
      `workspaces.primary_network_id`); typecheck passes

### Planning hero (the payoff)

- [ ] 12. `solve_plan` MCP tool wrapping `PlanningProblem.solve`
  - context: §7. Add to `scripts/user-mcp-server.py` a builtin that, given the
    workspace's network + free-capacity params + objective weights + bounds +
    iterations, builds `DispatchLayer` → op `MultiObjective` → `InvestmentObjective`
    → `PlanningProblem(...).solve(...)` and writes a `kind='plan'` artifact.
  - acceptance:
    - driving the MCP server over stdio (as in the existing `list_networks`
      verification) `solve_plan` runs a SMALL plan (few iterations) on
      `data/networks/ieee-30` end-to-end, returns a plan artifact id, and the
      artifact metadata carries history (loss, op_cost, inv_cost) + final caps
    - CPU-only; bounded iterations so it finishes in well under the loop's
      per-item timeout; never requires GPU/Modal

- [ ] 13. `kind='plan'` view_spec + renderer
  - context: §7. Extend `scripts/run_artifact.py` (or a new `plan_artifact.py`)
    to build the plan view_spec; add `components/renderers/plan.tsx`.
  - acceptance:
    - a plan artifact renders: loss curve, capacity trajectory, final-build
      table, resulting dispatch (LMP map reusing the run renderer), and a
      cost-vs-emissions panel; typecheck passes; Playwright snapshot of a
      seeded plan artifact

- [ ] 14. Focus → planning-problem assembly helpers
  - context: §6. Helper (in the workspace `features/` template or a shared
    module) that maps focus tags → `parameter_names` (which device capacities
    are free) + objective composition (DispatchCost [+ λ·Emissions] + Investment).
  - acceptance:
    - given focus `[Generation, Decarbonization]` the helper returns free
      generator capacities + `DispatchCost + λ*Emissions` + `InvestmentObjective`
    - unit-tested against `ieee-30` shapes; typecheck/py-import passes

- [x] 15. Intent routing in the agent (no "zap", no UUID)
  - context: §10. Update the `grid-engineer` persona template (`lib/workspace.ts`)
    so NL like "generation schedules for the next few days" → dispatch (Run) and
    "plan expansion optimizing for <metric>" → planning (Plan), always against
    the workspace's primary network, never asking for a UUID or naming zap.
  - acceptance:
    - persona template updated with the routing rules + the workspace-network
      default; a fresh workspace session, given those phrasings, calls the right
      tool (`solve_opf` vs `solve_plan`) and produces a Run/Plan
    - documented manual transcript in `REDESIGN_NOTES.md` if full automation of
      the agent check isn't feasible in-loop

### Polish

- [ ] 16. Ontology polish: features→Objectives, Runs&Plans tab, demote panels
  - context: §3, §5. Rename "features" to "Objectives" in the UI; add a Runs &
    Plans tab; move generic Panels/Dashboards/Glossary into a secondary library.
  - acceptance:
    - nav reflects the 5 nouns (Data Source, Chats, Objectives, Runs & Plans,
      Library); old routes still resolve; typecheck passes; Playwright nav check

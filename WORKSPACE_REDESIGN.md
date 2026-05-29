# Steinmetz redesign — Workspaces, planning-first

Status: **proposal / design doc** (2026-05-28). Decisions locked with the user:
**planning-first** hero, **full ontology reframe**, **design before code**. This
doc is the spec to review before we touch schema or UI.

---

## 1. Why we're doing this

The product today is a chat + a pile of generic "artifacts of any kind" panels
(Networks, Runs, Features, Sources, Panels, Dashboards…). Three problems:

1. **No center of gravity.** A new user can't tell what the thing *does*. The
   value is scattered across tabs.
2. **"Which network?" is unanswerable.** The chat isn't bound to any data
   source; `solve_opf` needs a raw artifact UUID. (We band-aided this with a
   `list_networks` tool + a composer picker — those are stopgaps this redesign
   subsumes.)
3. **We ship the least interesting 10% of zap.** Today we only do single-shot
   dispatch (`solve_opf`). zap's actual superpower — *differentiable,
   gradient-based expansion planning* — is invisible.

## 2. What zap is (the thing to build around)

zap is a **differentiable optimization layer for power grids** (verified in
source):

- **Operate (forward):** solve OPF / economic dispatch → optimal power schedule
  per device + nodal prices (LMPs). `DispatchLayer.forward` → `network.dispatch`
  (`zap/layer.py:55`). Fast (cvxpy/ECOS ms on CPU; ADMM/GPU for large nets).
- **Plan (backward):** the objective over the dispatch is a differentiable
  scalar, so zap returns **exact gradients of that metric w.r.t. device
  parameters** (gen/line/storage capacities, costs) via a KKT adjoint
  (`DispatchLayer.backward`, `zap/layer.py:70`). That powers gradient-based
  **capacity-expansion planning** (`PlanningProblem`, `zap/planning/problem_api.py:8`).
- **Objectives compose like math:** `DispatchCostObjective + 0.5*EmissionsObjective`
  via operator overloading (`zap/planning/operation_objectives.py:26`). zap's
  own papers call this *multi-value expansion planning*.

**Product one-liner:** *describe in language what a grid should do or become →
the agent assembles a differentiable objective → zap optimizes the schedule
(operate) or the build-out (plan) against real physics.*

## 3. Ontology

Full reframe **at the product/UX layer**. The `artifacts` table stays the
storage substrate (it's already generic); we present five legible nouns instead
of "artifacts of any kind," add one new table (`workspaces`), one column
(`artifacts.workspace_id`), and two new `kind` values (`objective`, `plan`).

```
Workspace = a Grid (data source) + an Intent (focus) + its Objectives, Runs, Plans, and chat
   ├─ Data Source  one primary grid the study is about (compare others later)
   ├─ Objective    a differentiable metric authored from NL  (reframe of today's "feature")
   ├─ Run          a dispatch solve: power schedule + LMPs    (artifact kind='run', exists)
   └─ Plan         a gradient optimization: recommended capacities + trajectory + achieved metrics  (NEW kind='plan')
```

| Noun | zap mapping | storage today → after |
|------|-------------|-----------------------|
| **Workspace** | the study context; sets `cwd` for the agent | NEW `workspaces` table |
| **Data Source** | PyPSA folder → `load_pypsa_network` → `(net, devices)` (`zap/importers/pypsa.py:538`) | `artifacts kind='network'` (unchanged) |
| **Objective** | `AbstractOperationObjective` subclass / `MultiObjective` composition | `features` + `artifacts kind='feature'` → reframed to `kind='objective'` |
| **Run** | `DispatchLayer.forward` / `network.dispatch` → `DispatchOutcome` | `artifacts kind='run'` (unchanged; view_spec built by `scripts/run_artifact.py`) |
| **Plan** | `PlanningProblem(op_obj, inv_obj, layer, bounds).solve()` → optimized params + history | NEW `artifacts kind='plan'` + new view_spec type |

The generic Panels/Dashboards/Sources/Glossary stay available but demote to a
secondary "Workspace library" — they are not the spine anymore.

## 4. Schema migration (additive, non-breaking, phased)

Everything is `add column if not exists` / `create table if not exists` so the
existing schema re-pastes cleanly and nothing is dropped.

### 4.1 New `workspaces` table
```sql
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,   -- personal owner
  org_id  uuid references public.orgs(id) on delete cascade,  -- or org-owned
  name text not null,
  focus text[] not null default '{}',          -- intent tags (see §6)
  primary_network_id uuid references public.artifacts(id) on delete set null,
  cover_image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check ((user_id is null) <> (org_id is null)) -- exactly one owner kind
);
create index if not exists workspaces_user_created_idx on public.workspaces (user_id, created_at desc);
create index if not exists workspaces_org_created_idx  on public.workspaces (org_id, created_at desc);
alter table public.workspaces enable row level security;
-- RLS mirrors artifacts: own personal, or org you're a member of.
create policy "workspaces select scope" on public.workspaces for select using (
  auth.uid() = user_id or (org_id is not null and public.is_org_member(org_id)));
create policy "workspaces insert scope" on public.workspaces for insert with check (
  (org_id is null and auth.uid() = user_id)
  or (org_id is not null and public.is_org_member(org_id)));
create policy "workspaces update scope" on public.workspaces for update using (
  auth.uid() = user_id or (org_id is not null and public.has_org_role(org_id, array['owner','admin'])));
create policy "workspaces delete scope" on public.workspaces for delete using (
  auth.uid() = user_id or (org_id is not null and public.has_org_role(org_id, array['owner','admin'])));
```

### 4.2 Scope artifacts to a workspace
```sql
alter table public.artifacts add column if not exists workspace_id uuid
  references public.workspaces(id) on delete cascade;
create index if not exists artifacts_workspace_created_idx
  on public.artifacts (workspace_id, created_at desc);
```
- `workspace_id` is **nullable**. Canonical/template networks keep
  `workspace_id NULL` (shared, usable as any workspace's data source — same as
  today's bundled-canonical rule). RLS is unchanged and still governs
  visibility; `workspace_id` is a *grouping* key, not a new visibility axis.

### 4.3 Backfill (one-time, service-role script)
- For each user with existing artifacts/features, create a default workspace
  "My workspace" and set `workspace_id` on their rows.
- Leave canonical (`user_id NULL`) network rows untouched (`workspace_id NULL`).

### 4.4 Filesystem + opencode
- Workspace dir becomes **per-workspace**: `grid-workspaces/<workspace-id>/`
  (today it's per-user `<supabase-uid>/`). `lib/user-workspace.ts` →
  `ensureWorkspace(workspaceId)`; opencode session opens with `cwd` = that dir.
- The workspace's primary network is recorded in the dir (e.g.
  `.steinmetz/workspace.json`) so the agent + a workspace-aware `solve_opf` /
  planning tool default to it with **no UUID needed** — this is what retires
  the composer picker.
- Hardening (per-user Linux account / venv / cgroup) re-keys from user to
  *workspace* owner; the existing gates (`STEINMETZ_*`) stay off in dev.

## 5. Information architecture / screens

```
/app                       → Workspace gallery (cards)
/app/w/[id]                → workspace home; default tab = Chat
/app/w/[id]/source         → Data Source tab
/app/w/[id]/objectives     → Objectives
/app/w/[id]/runs           → Runs & Plans
/app/settings, /app/orgs   → unchanged (account-level)
```

- **Gallery (`/app`):** grid of rounded cards. Each: cover image (Unsplash
  utilities/grid/solar, or a generated network thumbnail), workspace name, grid
  name, focus chips, last-activity. A "＋ New workspace" card opens the wizard.
- **Creation wizard:** (1) name → (2) focus multi-select chips → (3) data
  source *now or later*: pick a template / "ask the agent to find me WECC" /
  upload / skip → (4) land in Chat with focus-tailored suggested prompts.
- **Workspace header:** shows the anchored grid + focus chips (this is the
  permanent answer to "which network?"). Chat composer no longer needs a picker.
- **Data Source tab:** topology + buses/lines/carriers; swap/add source; the
  home for a real **networks catalog/API** (PyPSA-USA / PyPSA-Eur / Zenodo / ISO
  portals) behind the agent's existing `fetch_network`.
- **Runs & Plans tab:** dispatch Runs (LMP map, carrier dispatch, line flows —
  already built in `scripts/run_artifact.py:137`) **and** the new Plan view
  (§7).

## 6. Focus tags configure the planning problem (not cosmetic)

The wizard's focus selection literally assembles the zap problem: which device
attributes become free decision variables (`DispatchLayer.parameter_names`,
`zap/layer.py:17`) and which objective terms turn on.

| Focus tag | Free parameters (`parameter_names`) | Objective terms added |
|-----------|-------------------------------------|-----------------------|
| **Operations** | none (dispatch only) | DispatchCost → produces **Runs**, not Plans |
| **Generation expansion** | generator `nominal_capacity` | + InvestmentObjective(capex) |
| **Transmission expansion** | line `nominal_capacity` | + InvestmentObjective(capex) |
| **Storage & flexibility** | storage `power_capacity` / `duration` | + InvestmentObjective(capex) |
| **Decarbonization** | (combines with the above) | + λ·EmissionsObjective |
| **General / all** | all capacities free | DispatchCost + EmissionsObjective + Investment |

So "Generation + Decarbonization" → free generator capacities, objective =
`DispatchCost + λ·Emissions`, plus `InvestmentObjective` capex. The agent fills
in λ / bounds from the conversation.

## 7. Hero loop (the planning demo) — grounded in zap calls

**Scenario:** workspace "California decarbonization", focus
`[Generation, Decarbonization]`, source PyPSA-USA / WECC.

User: *"Find the cheapest solar + storage build-out that cuts emissions 50%
without overloading any line."*

Agent (in a workspace-scoped feature/objective module that imports zap):
1. `net, devices = load_pypsa_network(pn, snapshots)` (`zap/importers/pypsa.py:538`).
2. Build `parameter_names` for the generators (and storage) whose capacity is
   free; `layer = DispatchLayer(net, devices, parameter_names, time_horizon=T)`.
3. `op = DispatchCostObjective(net, devices) + λ*EmissionsObjective(devices)`
   (`operation_objectives.py`).
4. `inv = InvestmentObjective(devices, layer)` (`investment_objectives.py:26`).
5. `prob = PlanningProblem(op, inv, layer, lower_bounds, upper_bounds)`;
   `result = prob.solve(num_iterations=N, ...)` → optimized capacities + history
   trackers (loss, grad norm, op cost, inv cost) (`problem_abstract.py:81`).
6. Emit a **Plan artifact** (`kind='plan'`) whose `view_spec` renders:
   - **loss / objective curve** over iterations (from trackers),
   - **capacity trajectory** per device,
   - **final recommended build** (table: device, before → after, capex),
   - **resulting dispatch** (a Run solved at the final capacities — LMP map +
     carrier mix),
   - **cost-vs-emissions Pareto** (sweep λ → the frontier; mark the point that
     hits the 50% target).
7. Save the objective composition as a reusable **Objective** (feature module +
   SKILL.md); the Plan + Run persist in the workspace.

**Why this is the demo:** "without overloading any line" is *free* — line limits
are dispatch-feasibility constraints, so any plan zap returns already respects
them. The user expresses a goal in language; zap turns it into gradients and an
optimal build-out. Nothing else on the market does this ergonomically.

## 8. Build phasing (after this doc is approved)

1. **Schema + workspace context.** Migration (§4.1–4.3), `ensureWorkspace`,
   route the existing chat into a workspace, header shows the grid. Backfill a
   default workspace per user. *(Fixes legibility + "which network" structurally.)*
2. **Gallery + creation wizard.** Cards, focus picker, data-source step.
3. **Planning hero.** New `solve_plan` tool (wraps `PlanningProblem.solve`),
   `kind='plan'` view_spec + renderer (loss/trajectory/Pareto), suggested
   prompts. *(This is the payoff — schedule it as soon as #1 lands.)*
4. **Ontology polish.** Rename features→Objectives in UI; Runs&Plans tab;
   demote generic panels to a library.
5. **Data-source catalog/API.** Curated network catalog behind the Data Source
   tab + `fetch_network`.

## 9. Open questions (need the user)

1. **Targets vs weights.** zap planning minimizes a *weighted* objective with
   parameter *bounds* — it has no hard "emissions = 50% lower" constraint. To
   hit a target we either (a) sweep λ to find the point that achieves it, or
   (b) add a penalty term. Sweep is more honest (gives the Pareto curve) but
   costs more solves. Which is the default UX?
2. **Compute/time + streaming.** A plan = N gradient iterations, each a
   dispatch solve. 200-bus × T snapshots × N≈100 could be seconds→minutes on
   CPU (GPU/ADMM for big). We need progress streaming in the Plan view. Is a
   minutes-long run acceptable for the demo, or do we cap N / network size?
3. **Objective authoring surface.** Is an Objective always agent-authored
   Python (`AbstractOperationObjective` subclass), or do we also want a
   guided/templated builder for common ones (cost, emissions, reliability)?
4. **Operations-only workspaces.** If focus = Operations only, there are no
   Plans — just Runs. Confirm that's the intended degenerate case.
5. **Migration timing.** The live app's working tree is mid-refactor; the
   schema migration is additive and safe, but rollout should be sequenced
   against whatever that in-flight work is. Who owns reconciling it?

---

## 10. Chat-centric UX (added 2026-05-28)

Guiding principle the user emphasized: **a harness makes implementation easier
AND lets the user *declare* their experience inside the system.** We have too
many tabs where users "go somewhere to do a thing." Collapse that — the **chat
is the centerpiece**; capabilities live *in* the chat, not in separate screens.

- **Chat is the product.** Enter a workspace → land in a chat. Everything the
  user wants — ask about the grid, upload a file, run a schedule, plan an
  expansion — happens by *talking*, not by navigating tabs.
- **In-chat upload.** A `+` in the composer uploads an arbitrary file (routes
  through the existing `/api/upload`). Uploaded files still surface in a Files
  tab (keep it), but the *capability* lives in the chat. Attachments render as
  chips in the message.
- **Chat history + persistence.** Chats are stored per workspace. The left
  sidebar lists chats (history); selecting one resumes it. (Today sessions are
  ephemeral opencode sessions with no durable list — needs a `chats` store
  keyed by workspace, mapping to opencode session ids + a title.)
- **Left sidebar = {single Network, Chats, profile}.** The workspace's network
  is singular, so show it once at top. Below it, the chat list. At the
  **bottom-left, a profile circle** that holds account + **logout** (move logout
  off the top-right header entirely).
- **Kill the right context rail.** `components/shell/RightRail.tsx` is clutter
  with nothing to populate it — remove it; let the chat take the center. (User
  flagged this as low-priority; do it but don't over-invest.)
- **Premium, modern feel.** Target a ChatGPT/Gemini-grade surface: simple but
  premium — generous spacing, clean type, a calm empty state, a single focused
  composer. The chat, not chrome, is the hero.
- **Intent → zap, without naming zap.** The user should say things like *"get
  me the power generation schedules for the next couple days,"* *"estimate
  this,"* or *"plan some expansion in this area optimizing for <metric>"* and
  the harness routes to dispatch (Run) or planning (Plan). Never make the user
  say "zap" or pass a UUID — the workspace's network is the implicit subject.

This *reinforces* §3–§7: the workspace anchors a single network, so the chat
always has a subject; Objectives/Runs/Plans are produced *from* the chat and
listed in the sidebar/tabs, not authored in separate form-driven screens.

---

## 11. Build guardrails for the autonomous loop

The repo serves **production** from this VM via `next start` on `:3000`. An
overnight loop MUST NOT destabilize it. Hard rules for every iteration:

- **Never** stop, rebuild, or restart the prod `next start` on `:3000`.
- **Never** `git reset --hard` / `clean -f` / discard the existing working-tree
  changes (a mid-refactor from other work is present). Build *additively* on
  top; commit per item; never force-push.
- Keep the app buildable: `npx tsc --noEmit` must pass before an item is `[x]`.
- **Do not auto-apply DDL to the live Supabase DB.** Schema items produce
  reviewed `.sql` migration files + a backfill script under `supabase/`; a human
  applies them. (RLS changes unattended = too risky.)
- UI verification uses typecheck + Playwright/unit tests, or a *scratch* dev
  server on a throwaway port — never the prod `.next`/:3000.
- If an item can't meet its acceptance criteria safely, mark it `[!]` (blocked)
  and move on; don't force it.

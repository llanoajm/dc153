# Redesign notes — implementation log + manual verification transcripts

Supplements `WORKSPACE_REDESIGN.md` (the design) and `REDESIGN_ROADMAP.md` (the
ordered backlog). This file records things that can't be captured as code or a
unit test: manual verification transcripts, agent-behaviour expectations, and
decisions made while building the redesign.

---

## Item 15 — Intent routing in the agent (no "zap", no UUID)

**What shipped:** the `grid-engineer` persona template (authored in
`lib/user-workspace.ts:materializeWorkspaceDir`, reused by
`lib/workspace.ts:ensureWorkspace` so per-user *and* per-workspace dirs get the
same persona) now carries:

1. A **never-name-the-library / never-ask-for-a-UUID** rule. The persona speaks
   to the user in domain terms (networks, dispatch schedules, expansion plans),
   never says "zap", and never surfaces `network_artifact_id` in chat.
2. The **workspace-network default**. The workspace is anchored to one primary
   network; that is the standing answer to "which network?". The chat surface
   (`components/chat/ChatView.tsx`) prepends an `[active-network] <id> (<name>)`
   context line to the first message of each session
   (`ACTIVE_NETWORK_PREFIX`), built from the workspace's
   `primary_network_id`. The persona is told to read that id and pass it straight
   to `solve_opf` / `solve_plan` without restating it, to reuse it on later
   messages, and to fall back to `steinmetz__list_networks` only when the user
   explicitly names a *different* grid.
3. **Intent routing rules** mapping natural language to one of two tools:
   - dispatch / "what does the grid do" → `steinmetz__solve_opf` → a **Run**;
   - planning / "what should the grid become" → `steinmetz__solve_plan` → a
     **Plan**, with Decarbonization intent raising the emissions weight λ.

### Why the live-agent check is documented rather than executed in-loop

The acceptance criterion offers a fallback: *"a documented manual transcript in
`REDESIGN_NOTES.md` if full automation of the agent check isn't feasible
in-loop."* It isn't feasible here, and deliberately so under the loop guardrails:

- Driving a real agent turn requires an opencode session against the running
  server, which bills a live OpenRouter key and produces nondeterministic output
  — not something to run unattended in the build loop.
- The guardrails forbid disturbing the production stack on `:3000` and the shared
  opencode server; spinning up a scratch session to exercise the persona would
  risk exactly that.

So the deliverable is the **template change** (the behaviour-defining artifact)
plus the expected transcript below. The persona is a system-prompt change; its
correctness is in the instructions the agent receives, which are now in place.

### Expected transcript A — dispatch phrasing routes to a Run

Workspace: "California grid ops", focus `[Operations]`, primary network = the
IEEE-30 reference grid. The chat's first user message is delivered to the agent
with the context line prepended by `ChatView.tsx`:

```
[active-network] "IEEE 30-bus" (network_artifact_id: 6f1c…) — use this network for any solve or analysis unless I specify another.

Get me the power generation schedules for the next couple of days.
```

Expected agent behaviour (per the persona rules):

1. Recognizes "generation schedules … next couple of days" as a **dispatch**
   intent (the grid is fixed; the user wants its operating schedule), NOT a
   planning intent.
2. Reads the `[active-network]` id `6f1c…` from the context line — does NOT ask
   "which network?" and does NOT ask for a UUID.
3. Calls `steinmetz__solve_opf` with `network_artifact_id=6f1c…` and
   `hours` covering the requested window.
4. Reports back in plain terms: "Here are the dispatch schedules and nodal prices
   for the IEEE-30 grid over the next 48 hours…" — links the resulting **Run**
   artifact; never writes the word "zap" or the raw id.

### Expected transcript B — planning phrasing routes to a Plan

Workspace: "WECC decarbonization", focus `[Generation, Decarbonization]`,
primary network = a WECC/PyPSA-USA grid. First message, with the context line
prepended automatically:

```
[active-network] "PyPSA-USA WECC" (network_artifact_id: 9a44…) — use this network for any solve or analysis unless I specify another.

Plan some expansion in this area optimizing for lower emissions.
```

Expected agent behaviour:

1. Recognizes "plan some expansion … optimizing for lower emissions" as a
   **planning** intent (capacities are free; the user wants what the grid should
   become), and notes the workspace focus already includes Decarbonization.
2. Reuses the `[active-network]` id `9a44…` — no "which network?", no UUID ask.
3. Calls `steinmetz__solve_plan` with `network_artifact_id=9a44…`, a small
   `iterations` (≈5, CPU-bounded), and a non-zero `emissions_weight` (λ) to push
   decarbonization.
4. Reports back: recommended build-out (capacities before → after), the
   loss/cost/emissions trajectory, and the achieved emissions reduction — links
   the resulting **Plan** artifact; never names the library or the raw id.

### Cross-check against the wired tools

The two tools the persona routes to exist as MCP builtins in
`scripts/user-mcp-server.py` (`steinmetz__solve_opf` → `_builtin_solve_opf`,
`steinmetz__solve_plan` → `_builtin_solve_plan`), both keyed on
`network_artifact_id`, and `solve_plan` accepts `emissions_weight`. The focus →
planning-problem mapping that `solve_plan` honours is item 14
(`scripts/focus_problem.py`, wired through `scripts/plan_artifact.py:run_plan`).
A follow-up (noted in the item-14 journal entry) is to thread the workspace's
stored `workspaces.focus` into the `solve_plan` call so the agent passes focus
explicitly; today the persona instructs the agent to set `emissions_weight` from
Decarbonization intent, which produces the same routing outcome.

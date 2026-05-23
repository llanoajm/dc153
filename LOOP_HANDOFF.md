## Current item (from LOOP_QUEUE.md line 160)
- [ ] 17. Agentic view authoring v2: sandboxed custom panels (ROADMAP §11.8)

## Attempt
1 of 5

## Context loaded
- AGENTS.md / ROADMAP.md / STATE.md / LOOP_QUEUE.md
- prior attempt commits c815dd8..18137cb (the sandbox + spec + promote-skill
  route + PanelReviewStrip + PromoteToSkillButton actually shipped on those
  attempts; the loop tagged them "Unsuccessful" only because the agent never
  wrote STATUS:done into LOOP_HANDOFF.md)

## What landed this attempt
- /app/panels index page (`app/app/panels/page.tsx`) — lists every
  `kind='panel'` artifact via `lib/dashboards.ts:listPanels()`, with inline
  PinButton and a "skill" badge when `metadata.promoted_to_skill` is true.
- LeftRail gains a "Panels" section; WorkspaceShell routes `panels` →
  `/app/panels`, sets the tab label, and matches the active-rail key.
- Single commit: `feat(panels): sandboxed custom panels v2 — promotion ladder UI` (2282cce).
- `npm run build` exits 0.

## What was already in the tree
- `lib/view-specs/panel.ts` — JSX subset spec (PANEL_COMPONENTS allowlist,
  validatePanelSpec, $bind / $fmt / $eq value resolution, PanelAction verbs
  set_state / toggle_state / increment_state / open_artifact, no DOM
  access, no string-to-code path documented in the file header).
- `components/sandbox/PanelHost.tsx` — the runner. Walks the JSON tree,
  resolves bindings against a local `useState` map, dispatches to an
  allowlisted component registry (Stack/Row/Box/Grid/Heading/Text/Markdown/
  Code/Metric/Badge/Table/Button/Slider/Select/NumberInput/TextInput/Toggle/
  ChartPanel/ArtifactView). Unknown nodes render inline errors and the rest
  of the tree keeps rendering.
- `components/renderers/panel.tsx` + types.ts wiring so `kind='panel'`
  routes through PanelHost via the universal renderer.
- `lib/dashboards.ts` — `isPanelArtifact`, `isPinnableArtifact`, `listPanels()`;
  pin button on /app/artifacts/[id] handles ephemeral → pinned.
- `components/panels/PanelReviewStrip.tsx` — server component on the
  artifact view page that shows validation, components-used,
  out-of-allowlist count, and a JSON diff against the parent panel when
  `parent_id` is set (the "reviewable diff before pin" requirement).
- `components/panels/PromoteToSkillButton.tsx` +
  `app/api/artifacts/[id]/promote-skill/route.ts` — writes
  `.opencode/skills/panel-<slug>/SKILL.md` + creates a `skill` artifact
  row + flips `metadata.promoted_to_skill=true`. Audit log entries on
  every step.

STATUS: done
SUMMARY: Sandboxed custom panels — kind='panel' artifacts render through components/sandbox/PanelHost.tsx (allowlisted JSON tree, no eval, no DOM), with /app/panels index, pin-to-rail, and a promote-to-skill route that writes SKILL.md into the user's workspace.
NEXT_STEPS: (n/a — done)
ACCEPTANCE: JSX subset documented in lib/view-specs/panel.ts (pass); sandbox runner components/sandbox/PanelHost.tsx exists and executes via allowlist with no eval / DOM path (pass); kind='panel' artifacts with reviewable diff via PanelReviewStrip on /app/artifacts/[id] (pass); promotion ladder ephemeral → pinned (PinButton in artifact header + /app/panels) → callable skill (PromoteToSkillButton + promote-skill route writing SKILL.md) (pass); `npm run build` exits 0 (pass).
VERIFIED: yes

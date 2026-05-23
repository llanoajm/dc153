# Loop Queue

Derived from `ROADMAP.md` "Suggested build order". Section numbers in parentheses
point to ROADMAP.md sections for full context. Acceptance criteria are
intentionally programmatically verifiable (build succeeds, files exist, endpoints
return expected shapes) — UI behavior gets minimal verification.

Legend: `- [ ]` pending · `- [x]` done & verified · `- [!]` blocked (see LOOP_ALERTS.md)

## Items

- [x] 1. Streaming + tool-call cards in the chat (ROADMAP §11)
  - context: replaces the 2.5s poll in `app/app/page.tsx`; first inline tool-call cards
  - acceptance:
    - `app/api/opencode/sessions/[id]/stream/route.ts` (or equivalent) returns `text/event-stream`
    - `app/app/page.tsx` consumes the stream (no `setInterval` polling left)
    - `components/chat/ToolCallCard.tsx` (or `components/chat/cards/*.tsx`) renders cards for: Read, Edit, Write, Bash, Grep, Glob, WebFetch, WebSearch, Skill
    - `npm run build` exits 0
    - `curl -N http://localhost:3000/api/opencode/sessions/<id>/stream` streams chunks (manual ok)

- [x] 2. Workspace shell (ROADMAP §11.5)
  - context: left rail + center tabs + right rail; replaces the bare header+chat layout
  - acceptance:
    - `components/shell/LeftRail.tsx`, `CenterTabs.tsx`, `RightRail.tsx` exist
    - `app/app/layout.tsx` renders the shell; chat is the default center tab
    - Left rail has default sections: Chats, Sources, Networks, Datasets, Runs, Reports, Skills/Features, Glossary
    - Cmd+K palette mounts (even if empty)
    - `npm run build` exits 0

- [x] 3. Artifacts table + universal renderer (ROADMAP §2, §11.6)
  - context: single first-class concept; renderers are generic
  - acceptance:
    - `supabase/schema.sql` adds `artifacts(id, user_id, org_id, kind, name, slug, fs_path, storage_path, metadata jsonb, view_spec jsonb, parent_id, parent_session_id, status, created_at, updated_at)` with RLS
    - `lib/artifacts.ts` exposes `createArtifact`, `getArtifact`, `listArtifacts`
    - `components/renderers/{markdown,table,chart,diff,code,file,log,dashboard}.tsx` exist
    - `app/api/artifacts/route.ts` GET returns []; POST creates one
    - `app/app/artifacts/[id]/page.tsx` renders an artifact through the matching renderer
    - `npm run build` exits 0

- [ ] 4. Per-user MCP server exposing `features/` (ROADMAP §5)
  - context: agent sees per-user Python features as typed MCP tools
  - acceptance:
    - `lib/user-mcp.ts` (or `scripts/user-mcp-server.py`) introspects `<workspace>/features/` and exposes each public function as an MCP tool
    - Opencode session config includes this MCP server (visible in session creation request body / opencode config)
    - Add a sample `features/example.py` to a test workspace; the tool appears in the agent's tool list
    - `npm run build` exits 0

- [ ] 5. Bundled reference networks (ROADMAP §0)
  - context: canonical artifacts visible on first login
  - acceptance:
    - `data/networks/ieee-30/`, `data/networks/wecc-240/` (or `pypsa-usa/`), `data/networks/pypsa-eur-slice/` exist with required files
    - Per-network card file: `card.md` with source URL, license, node count, carrier mix, example zap solve script, suggested first prompt
    - `scripts/seed_networks.py` (or equivalent) inserts canonical `artifacts` rows (`status='canonical'`, `org_id=null`)
    - 1-hour smoke-dispatch passes for each: `python scripts/smoke_dispatch.py data/networks/<name>` exits 0
    - `npm run build` exits 0

- [ ] 6. Network-graph renderer + PyPSA folder ingest + smoke-dispatch on upload (ROADMAP §1, §6, §11.6)
  - context: drag-drop a PyPSA folder, see it render, dispatched in the background
  - acceptance:
    - `components/renderers/network-graph.tsx` renders bus/line topology (force-directed or D3)
    - `app/api/upload/route.ts` accepts a PyPSA folder (zip or multi-file), writes to `<workspace>/sources/<slug>/raw/`, creates a `network` artifact
    - Smoke-dispatch kicked off detached; status moves queued → extracting → embedded → ready
    - Networks panel lists uploaded networks; click renders via network-graph
    - `npm run build` exits 0

- [ ] 7. Heterogeneous upload + custom-importer skill loop (ROADMAP §1)
  - context: unknown CSV → agent inspects → writes a reusable importer feature
  - acceptance:
    - Standard converters tried first; on failure, agent gets a tool-call to inspect the file
    - Agent writes `<workspace>/features/import_<source-slug>.py` and a matching `.opencode/skills/<slug>/SKILL.md`
    - Subsequent uploads of the same schema invoke the importer (schema detection logic exists)
    - Failed extractions saved with `status='failed_validation'`
    - `npm run build` exits 0

- [ ] 8. Agentic data acquisition (web-fetch a named network) (ROADMAP §6.5)
  - context: "Pull WECC 240" end-to-end with license + checksum
  - acceptance:
    - Agent uses WebSearch/WebFetch via existing opencode tools
    - Fetched data lands in `<workspace>/sources/<slug>/raw/`
    - Artifact row has `metadata.source_url`, `metadata.license`, `metadata.fetched_at`, `metadata.checksum`
    - License capture: if license can't be determined, agent prompts user before saving canonical
    - Validation re-uses the upload pipeline
    - `npm run build` exits 0

- [ ] 9. Geo-map renderer + LMP heatmap + time slider (ROADMAP §11.7)
  - context: spatial network view, the way grid people think
  - acceptance:
    - `components/renderers/geo-map.tsx` uses MapLibre + OpenStreetMap tiles (no Mapbox token requirement for default)
    - Bus glyphs by lat/lon when metadata has it; force-directed fallback otherwise
    - Line styling: color by flow, thickness by capacity, dashed for DC
    - LMP color overlay (per-bus prices from a dispatch run)
    - Time slider scrubs dispatch hours
    - `npm run build` exits 0

- [ ] 10. Runs panel + chart view spec for time series (ROADMAP §6)
  - context: existing artifact renderer + saved filter
  - acceptance:
    - `app/app/runs/page.tsx` lists `kind='run'` artifacts
    - Chart renderer uses Vega-Lite (already in §3's renderer set; this exercises it for runs)
    - Click run → time-series chart of LMPs / dispatch by carrier / line flows
    - "Compare two runs" view side-by-side
    - `npm run build` exits 0

- [ ] 11. PDF source ingestion → glossary + context doc (ROADMAP §1, §3)
  - context: first taste of the company-context flywheel
  - acceptance:
    - PDF upload → text extraction + chunking + embedding (table `source_chunks` or similar)
    - `<workspace>/glossary.md` populated with extracted domain terms + definitions
    - `<workspace>/company-context.md` populated with narrative system context
    - Both auto-loaded as system context every opencode session (verify by inspecting session system prompt)
    - Diff view available when source updates
    - `npm run build` exits 0

- [ ] 12. Candidate feature drafting from sources + approval flow (ROADMAP §4)
  - context: intake agent drafts features; user approves
  - acceptance:
    - When a document contains concrete enough math, an intake agent writes `<workspace>/features/<slug>.py` with `status='draft'` in artifacts
    - `app/app/features/page.tsx` shows approve/edit/reject per draft
    - Approval flips `status='canonical'`; deprecation flips to `'deprecated'`
    - Lineage view shows source document → feature draft
    - `npm run build` exits 0

- [ ] 13. Multi-modal extraction (PPTX, images, vision captioning) (ROADMAP §1)
  - context: extends ingestion beyond text PDFs
  - acceptance:
    - PPTX upload → text + slide images + per-slide captions
    - Image upload → caption via vision model (provider already wired via OpenRouter)
    - Audio upload → transcript + speaker turns
    - All extracted content surfaces in the Sources panel
    - `npm run build` exits 0

- [ ] 14. Org scopes + shared glossary/skills/networks (ROADMAP §10)
  - context: multi-user; same Supabase project
  - acceptance:
    - `orgs` + `org_members` tables in schema with roles (owner, admin, member) and RLS
    - Artifacts can be `personal` or `org`-scoped
    - Glossary and context docs compose at session time: org first, personal layered on top
    - Onboarding flow: new member sees org's canonical features and glossary on first login
    - `npm run build` exits 0

- [ ] 15. Reviewer agent validation pass + status workflow (ROADMAP §9)
  - context: post-turn reviewer guards AI-generated objectives
  - acceptance:
    - Post-turn hook (opencode hook or server-side handler) invokes a reviewer agent on new feature artifacts
    - Reviewer checks imports, type signatures (against `DispatchOutcome`), runs a smoke
    - Sets `status='canonical'` or `'failed_validation'`
    - Per-user/org policy: auto-promote vs require-approval
    - Audit log row written for every artifact write + agent decision
    - `npm run build` exits 0

- [ ] 16. Agentic view authoring v1: dashboards as composed view specs (ROADMAP §11.8)
  - context: agent composes multi-panel layouts; saved as artifacts
  - acceptance:
    - Dashboard view spec schema documented in `lib/view-specs/dashboard.ts`
    - Agent can emit a dashboard spec composing existing renderers (chart + table + network-graph + map sharing controls)
    - Saved as `kind='view'` artifact; re-rendering reproduces the layout
    - User can pin a dashboard to the workspace rail
    - `npm run build` exits 0

- [ ] 17. Agentic view authoring v2: sandboxed custom panels (ROADMAP §11.8)
  - context: small interactive JSX panels in a constrained subset
  - acceptance:
    - JSX subset spec documented (allowed components, no DOM access, no arbitrary JS)
    - Sandbox runner (`components/sandbox/PanelHost.tsx`) executes agent-authored panels safely
    - Stored as `kind='panel'` artifacts; reviewable diff before pin
    - Promotion ladder: ephemeral → pinned → callable skill
    - `npm run build` exits 0

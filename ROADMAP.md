# Steinmetz — Feature Roadmap

Compiled from conversations about the data layer, multi-modal context
absorption, and the workspace/UI shape. This is the durable list. Items are
roughly grouped by area and ordered within each group by what unlocks the
most downstream value first.

## Design principle (read this first)

This is a **harness-first product**, not a traditional app where the agent
fills in pre-defined forms and panels. Old software shape: engineers wire
deterministic flows; AI is bolted on as a chat box. New shape: the harness
is the substrate; the UI is a flexible canvas the agent can shape. Every
design choice below is judged against one question: **does it expand or cap
the agent's expressivity?**

Concrete rules this implies:

- **No pre-frozen panel schemas.** A "Networks panel" that hard-codes the
  columns + chart types means the agent can't show a network in a way we
  didn't anticipate. Instead, panels are *generic artifact renderers* driven
  by metadata the agent emits.
- **Every output is an artifact with a declared view spec.** The agent
  produces `{kind, payload, view_spec}` triples; the frontend picks (or the
  agent specifies) how to render. Built-in view specs cover the common cases
  (table, chart, markdown, map, network-graph, code, diff, file, log).
  Custom specs are first-class.
- **The agent can author new view types and dashboards.** A multi-panel
  analysis ("here's the LMP heatmap + dispatch breakdown + the comparison
  table I just produced — laid out as a 3-panel dashboard") is itself an
  artifact the user can save, share, modify, re-run.
- **Tool calls are exposed, not hidden.** Reads, Edits, Bash runs, Web
  fetches, skill invocations — all of it is visible as inline cards in the
  chat. The product feels magical *because* you see what the agent does, not
  in spite of it.
- **Taxonomy is descriptive, not prescriptive.** We provide a default
  category set; the agent can route artifacts into them, but the agent can
  also *create new categories at runtime* and pin them in the user's
  workspace. The user can override.
- **Bias toward declarative + sandboxed.** When the agent generates UI
  (charts, dashboards, custom panels), prefer declarative specs (Vega-Lite,
  GeoJSON+Mapbox style, markdown+JSX subset) over arbitrary code. Safe,
  cacheable, composable. Arbitrary JSX is a later, gated capability.
- **Deterministic flows are a fallback, not the default.** A few rigid
  surfaces are fine (auth pages, billing). For anything domain-shaped, the
  harness drives.

When in doubt: pick the design that lets the agent do something we didn't
think of, not the design that fits the screenshot in your head.

## 0. Bundled reference networks (ship with the product)

Two or three real-or-realistic networks already loaded as canonical artifacts
the moment a user signs up, so the very first session has something to chew
on without an upload step. Each one comes with a written description,
topology preview, and an example chat prompt that works against it.

- **Tier-1 (must have, day one):**
  - A small IEEE test case (14-bus or 30-bus) — instant demos, every paper
    uses it, fast solves.
  - **PyPSA-USA** snapshot (or **WECC 240-bus**) — real US Western
    Interconnection topology. Realistic node count, used by zap's papers,
    openly licensed.
  - **PyPSA-Eur** subset (e.g., Germany or France slice) — real European
    grid, well-documented, MIT/CC-BY licensed.
- **Tier-2 (nice to have):**
  - A **Texas A&M synthetic** network (ACTIVSg2000 or similar) — synthetic
    but US-scale; useful when public real data is sparse.
  - **PyPSA-Eur** at full European scale for stress-testing solver
    performance.
- **Requirements per bundled network:**
  - Source URL + license recorded as metadata.
  - Already validated: 1-hour smoke-dispatch passes on first install.
  - Has a per-network "card" describing: node count, carrier mix, time
    coverage, where to read about it, an example zap solve script, and a
    suggested first prompt ("compare cost vs emissions for two expansion
    plans").
  - Shipped as `artifacts.status='canonical', org_id=null` rows — visible to
    every user; users can clone them into their personal scope to modify.

## 1. Universal file ingestion (the headline feature)

Like the file-upload surface in ChatGPT or Claude Code, but with two modes:
**ephemeral** (just this session) vs **canonical** (becomes part of the user's
permanent context). Both go through the same pipeline; the user decides at
upload time (or later, by promoting an ephemeral file).

- **Drag-and-drop into chat** + a dedicated "Sources" panel for browsing the
  library.
- **File types in scope:** PDF, DOCX, PPTX, XLSX/CSV, TXT/MD, images
  (JPEG/PNG/SVG), code (.py/.ts/.json/etc), NetCDF, audio (transcribed),
  zipped folders, PyPSA CSV folders, **plus grid-specific formats:**
  MATPOWER `.m`, PSS/E `.raw`, CIM/XML, GridLAB-D `.glm`, OpenDSS `.dss`.
- **Per-type extraction:**
  - PDF/DOCX/PPTX → text + structure (sections, slides, headings) + extracted
    images.
  - PPTX/slide images / diagrams / charts → vision-model captioning.
  - Spreadsheets → schema inference + sample rows + type detection.
  - CSVs → registered as datasets with shape + dtypes.
  - Images → captions; if technical (chart/diagram), structured extraction of
    axes/legends if possible.
  - Code files → AST summary + module exports; usable as reference.
  - Audio/video → transcript + speaker turns if available.
  - PyPSA folders / NetCDF → validated as networks, smoke-dispatched.
  - Grid-specific formats → converted to PyPSA via standard converters
    (`pypsa.Network.import_from_matpower`, etc.), then smoke-dispatched.
- **Non-standardized / custom formats (the important one):** users will
  upload utility-specific CSVs, weird Excel layouts, even photos of network
  diagrams. The pipeline must handle these gracefully:
  - On upload, a classifier tries the standard converters first.
  - If nothing matches, the agent inspects the file in a chat turn:
    "I see a 1,247-row CSV with columns `from_substation, to_substation,
    kV, miles, rating_MW, in_service_date`. Looks like a transmission-lines
    table. Is `kV` the operating voltage, and should I treat `rating_MW`
    as line capacity? What's the bus-id convention?"
  - User confirms / corrects via chat.
  - Agent writes a **custom importer** as a feature
    (`features/import_<source-slug>.py`) that converts this format to a
    PyPSA-compatible network. That importer is now a reusable skill —
    next time they upload an Acme Utility CSV, the agent recognizes the
    schema and uses the existing importer.
  - For diagram photos: vision extraction tries to recover topology
    (substation labels, line connections). User reviews and corrects
    before the network is canonicalized.
  - Failed extractions are saved as `status=failed_validation` so the user
    can retry after refining.
- **Ingestion status visible:** queued → extracting → embedded → ready. Errors
  surfaced with retry.
- **Per-file controls:** rename, retag, re-extract (when extractor improves),
  delete (with provenance warning if anything depends on it).
- **Ephemeral vs canonical:** ephemeral uploads die with the chat session.
  Canonical uploads update the user's permanent context.

## 2. Artifacts as a single first-class concept

One unified Supabase table replaces the ad-hoc per-kind tables. RLS by
`user_id` and (later) `org_id`.

- Schema: `artifacts(id, user_id, org_id, kind, name, slug, fs_path,
  storage_path, metadata jsonb, parent_id, parent_session_id, status,
  created_at, updated_at)`.
- **Kinds:** `source_document`, `dataset`, `network`, `run`, `feature`,
  `skill`, `glossary`, `context_doc`.
- **Status:** `draft`, `canonical`, `deprecated`, `failed_validation`.
- **Storage:** Supabase Storage buckets per kind. Raw files live there;
  filesystem caches are derivable.
- **Provenance:** every artifact links to the chat session and prompt that
  produced it (`parent_session_id`). Lineage view: "this run came from this
  feature came from this document."
- **Versioning:** re-uploaded source docs produce new versions; downstream
  artifacts can pin to a specific source version.

## 3. Per-user / per-org context absorption

From uploaded sources, the system extracts and maintains:

- **`glossary.md`** — domain terms the user/org uses, with definitions and
  mappings to zap concepts. Auto-built from sources; user-editable; versioned.
- **`company-context.md`** — narrative system context (who they are, what
  they optimize for, hard constraints, decision frameworks, regulatory
  posture). Auto-built; user-editable.
- **Both are auto-loaded as system context every session**, the same way
  `AGENTS.md` is today.
- **Diffable when sources update:** "Acme 2030 IRP v3 changes 'avoided MWh'
  definition — accept update?"

## 4. Candidate feature drafting from sources

When a document describes an objective/constraint/analysis in concrete-enough
math, an "intake" agent drafts a feature implementation against zap.

- Drafts land as `features/<slug>.py` with `status=draft` in artifacts.
- Each draft has an "approve / edit / reject" flow in the Features panel.
- Approved drafts become `canonical` — joined to the user's working skill
  set. The agent can invoke them by name in future sessions.
- Edits are tracked; user can see "this is the version I shipped vs the draft
  the agent proposed."

## 5. Agent capability growth (tools the agent built)

Currently the agent re-reads its old code each session. Make it feel like a
growing palette of typed actions.

- **Per-user MCP server** that introspects the user's `features/` directory
  and exposes each public function as a typed MCP tool. opencode picks these
  up automatically; the agent sees them in its tool list.
- **Skill discovery** stays the heavyweight layer (full SKILL.md description);
  MCP layer is the lightweight typed-call layer.
- **Tool usage telemetry:** count invocations per feature. Deprecate or
  archive features unused for N days (with the user's consent).
- **Composition:** because zap's `AbstractOperationObjective` overloads `+`
  and `*`, features compose naturally. A "compose features" affordance in the
  UI (drag-and-drop or chat) makes this discoverable.

## 6. UI surfaces (the panels)

Each panel reads from artifacts + filesystem; each can also be the launch
point for a chat with that artifact pre-attached as `@`-context.

- **Networks** — list, upload, inspect (topology, generator mix, load shape),
  version, tag, clone. Topology view later (map + force-directed graph).
- **Datasets** — CSVs, time series, parameter sets. Schema preview. Quick
  charts.
- **Documents (Sources)** — raw uploads + their extraction status. Click into
  a source to see the chunks it produced, the glossary entries it generated,
  the feature drafts it spawned.
- **Runs** — solve results. Status, runtime, network+feature combo. Click in
  to see time-series charts (LMPs, dispatch by carrier, line flows). Diff
  runs side by side.
- **Features** — library + status (draft/canonical/deprecated). Code view.
  Lineage to source documents and chat sessions. "Use in current chat"
  button.
- **Glossary editor** — read/write the user's glossary. Each entry shows
  source documents and zap mapping.
- **Context doc editor** — same for the company-context narrative.

## 6.5. Agentic data acquisition ("pull X network from the web")

The agent uses its existing web tools (WebSearch / WebFetch) to find and
fetch data the user names but hasn't uploaded. Prompts like:

- "Pull the WECC 240-bus network."
- "Find me an ERCOT topology I can use."
- "Get me the PJM transmission expansion plan for 2024."
- "Download Ontario's IESO market data for the last year."

What the agent does:

1. **Resolve.** Search the open web (papers, public repos, EIA, FERC,
   ENTSO-E, ISO websites, Zenodo, Hugging Face Datasets). Surface candidate
   sources with their licenses; let the user pick if ambiguous.
2. **Fetch.** Download to the user's workspace (`users/<id>/sources/
   <slug>/raw/`). For folders / multi-file releases, `git clone` or `curl`
   a zip; for single files, plain HTTP.
3. **Validate.** Run the same ingestion pipeline as a manual upload: detect
   format, convert if known, smoke-dispatch if it's a network.
4. **Register.** Insert an `artifacts` row with `source_url`, `license`,
   `fetched_at`, `checksum`. Show the user: "Got it — 240 buses, 448 lines,
   carriers: gas/solar/wind/hydro. Source: github.com/PyPSA/pypsa-usa,
   commit abc123, MIT. Want to use it now?"
5. **Track.** If the source updates, the user can ask "refresh wecc-240"
   and the agent re-pulls + diffs against the existing version.

Requirements:

- **License capture is non-negotiable.** Every fetched artifact records
  source URL + license string + fetched timestamp. If the agent can't
  determine the license, it asks the user before saving as canonical.
- **Checksums.** When the source publishes one (Zenodo DOIs do, GitHub
  releases do), record it so re-pulls can verify integrity.
- **Credentialed sources.** If the data lives behind a login/API key
  (e.g., EIA API), the agent prompts the user to provide credentials,
  stored encrypted per user (not in chat).
- **Refusal cases.** Paywalled or copyright-restricted data: agent
  declines and tells the user where they can obtain it themselves.
- **Provenance in chat:** every fetched-and-used artifact shows up in
  the conversation as a tool-call card with the URL, so the user can
  audit what the agent grabbed.

## 7. Chat affordances for data

- **Drag-and-drop a file into the chat** → uploaded, parsed, available as
  ephemeral context for the next prompt.
- **`@network <name>`, `@dataset <name>`, `@feature <name>`, `@source <name>`
  mentions** that auto-attach an artifact's metadata to the prompt.
- **Inline previews** of attached artifacts (a small chip with name + kind +
  shape).
- **Slash commands**: `/use <feature>`, `/run dispatch on <network>`,
  `/compare runs <a> <b>`.

## 8. Background jobs

Long solves shouldn't block the chat.

- **Job runner:** detached Python process per solve. Writes progress + result
  to a `runs` artifact. Status surfaces in UI.
- **Cancel / retry / re-run with modified params.**
- **Notifications** when a job finishes (in-app + optional email).
- **Concurrency limits** per user to avoid runaway costs.
- **Future:** a real queue (Redis/Inngest/Cloudflare Queues) when scale
  demands it.

## 9. Validation + safety

Especially important for AI-generated objectives driving real planning.

- **Reviewer agent** invoked post-turn. Re-reads the new feature, checks:
  imports, type signatures, math sanity (units, tensor shapes against
  `DispatchOutcome`), runs a tiny smoke. Sets `status=canonical` or
  `failed_validation`.
- **Auto-promote vs. require-approval policy** per user/org.
- **Permission scopes** the agent already has, but tightened: e.g.,
  default-deny writes outside the user workspace; default-deny network calls
  except via approved tools.
- **Audit log** — every artifact write + agent decision logged.

## 10. Org / team scopes (multi-user posture)

Same Supabase project, additional scopes.

- **`orgs` table + `org_members`** (with roles: owner, admin, member).
- **Artifacts can be `personal` or `org`-scoped.**
- **Glossary and context docs** can be org-level (shared) AND personal
  (override). Compose at session time: org first, personal layered on top.
- **Onboarding flow:** new analyst joins → org's canonical features and
  glossary already loaded → they can start in their team's vocabulary on day
  one.
- **Conflict resolution** for shared definitions (proposed edits go through
  review).

## 11. Streaming + tool-call rendering (the magic layer)

Every tool call the agent makes is rendered inline in the chat as a
card — the product feels alive *because* the agent's work is visible.

- **SSE/WebSocket streaming** for assistant turns.
- **Tool-call cards per tool kind:**
  - `Read` → file path + lines, click-to-expand the content.
  - `Edit` / `Write` → diff card (opencode already produces diffs), expand
    for full file, link to "open in artifact view."
  - `Bash` → command + collapsible stdout/stderr + exit code; long output
    paginated with copy/download.
  - `Grep` / `Glob` → query + result list, click any hit to jump in.
  - `WebFetch` / `WebSearch` → URL + response snippet + license/source
    metadata. Important for the data-acquisition flow.
  - `Skill` invocation → skill name + args + a sub-card for the skill's
    own output.
  - Custom MCP tools (user-built features) → tool name + typed args +
    structured result rendered through the appropriate view spec.
- **Diff previews** for file edits, with side-by-side or unified toggle.
- **Inline code highlighting** + markdown rendering for assistant text.
- **Slash commands and `@` autocomplete** popovers.
- **Reasoning blocks** (when the model exposes them) as collapsible
  segments separate from final text.
- **Permission prompts** rendered inline when the agent hits an `ask`
  permission, with click-to-allow / always-allow / deny.
- **Cost + latency badges** per turn — token use, wall time. Builds trust.

## 11.5. The workspace shell (the operating-system feel)

The app is a workspace, not a chat with side panels. Layout:

- **Left rail** (collapsible): user-pinnable navigation. Default sections:
  Chats, Sources, Networks, Datasets, Runs, Reports, Skills/Features,
  Glossary. **The agent can add new sections at runtime** (see "agentic
  view authoring" below) — those appear here too, with the agent's icon
  and the user's permission to keep/pin/remove.
- **Center pane**: the active surface — usually a chat, sometimes an
  artifact viewer, sometimes an agent-authored dashboard.
- **Right rail** (toggleable): contextual — Review/diff for the current
  chat, mini map of a referenced network, related artifacts, etc. Same
  rules: the agent can populate it with whatever's contextually useful.
- **Tabs across the top of the center pane.** Multiple chats, multiple
  artifacts open simultaneously. Close, reorder, split-view.
- **Universal command palette** (Cmd+K): search chats, artifacts,
  skills, commands. Includes agent-authored entries.
- **Drag-and-drop everywhere.** Drop a file into chat to attach. Drop an
  artifact card into a comparison. Drop a chat into a project folder.
- **Saved chats are first-class artifacts.** Searchable, renameable,
  taggable, forkable. The agent can reference past chats by name in a
  new turn.
- **Persistent workspace state per user.** Open tabs, pinned panels, rail
  collapse state — all saved.

## 11.6. Artifact taxonomy + universal renderer

Anything the harness produces is an artifact. Categories below are the
**default starter set** — descriptive, not prescriptive. The agent can
slot outputs into these *or* declare new categories.

| Default category | What lives here | Example artifacts |
|---|---|---|
| **Sources** | Uploaded + fetched raw documents | PDFs, decks, CSVs, MATPOWER files, photos |
| **Networks** | PyPSA-compatible grid models | WECC-240, IEEE-30, an uploaded utility model |
| **Datasets** | Time series, parameter sets, scenarios | Load profiles, fuel-cost series, emission factors |
| **Runs** | Outputs of dispatch / planning / sweeps | DispatchOutcome objects, planning trajectories, sensitivity studies |
| **Reports** | Generated prose / mixed-media analyses | Markdown reports, comparison memos, decision logs |
| **Skills / Features** | Code the agent (or user) wrote | Custom objectives, importers, analysis pipelines |
| **Glossary / Context** | Domain language and decision frameworks | Term mappings, company-context, regulatory notes |
| **Chats** | Saved conversations | Each session is an artifact, taggable + searchable |
| **Views / Dashboards** | Agent-authored layouts | Multi-panel analyses the agent composed for a task |
| **Custom** *(agent-created)* | Whatever the agent invents | E.g., "Capacity Buildouts" if the agent decides that's a useful bucket for this user |

**Universal renderer architecture:** every artifact row carries a
`view_spec` field. View specs are declarative documents that map to known
renderers. Starter renderers:

- `markdown` — prose with code blocks, math, images
- `table` — tabular data + column types + sort/filter
- `chart` — Vega-Lite spec (covers ~80% of charts: lines, bars,
  heatmaps, scatter, small multiples)
- `network-graph` — node-link spec; styling rules for buses/lines/
  generators
- `geo-map` — GeoJSON + style spec; for spatial network views
- `diff` — unified or split-pane code/text diff
- `code` — syntax-highlighted source with optional run/copy
- `file` / `file-list` — single file or browser
- `log` / `terminal` — fixed-width streamed output
- `dashboard` — composition of other view specs in a grid/flex layout

Each renderer is a small React component reading from `view_spec`. New
renderers can be added by the platform. **Custom view specs from the
agent** that don't match a known renderer can fall back to JSON
inspector with a "promote to renderer?" affordance.

## 11.7. Map + geographic view of networks

A specific, high-value view type because grid people think spatially.

- **Layer**: GeoJSON-driven network overlay on a base map (Mapbox or
  MapLibre + OpenStreetMap tiles).
- **Bus glyphs**: positioned by lat/lon if metadata has it; force-directed
  fallback if not.
- **Line styling**: colored by current flow (after a solve), thickness
  by capacity, dashed for DC.
- **Carrier filters**: toggle layers — solar farms only, gas peakers,
  storage, etc.
- **Time slider**: scrub through dispatch results hour-by-hour, watch
  flows and prices update.
- **LMP heatmap**: per-bus prices as a color overlay.
- **Click a bus** → side-panel with devices, attached load, prices,
  outage history. Right-click → "ask the agent about this bus."
- **Multi-network compare**: side-by-side maps with synced viewport.
- **Reusable view spec**: the agent can output a map spec inline in
  chat ("here's the post-build network with new lines highlighted") and
  it renders as a card; user can pin to the Networks panel.

## 11.8. Agentic view authoring (the radical version)

Down-the-line capability, but design for it from day one so we don't
back ourselves into a corner.

- The agent can emit a **view spec** for an artifact, choosing from the
  built-in renderer types **or describing a composition** (e.g.,
  "dashboard with three panels: this LMP chart, this dispatch table,
  this network map all sharing a time slider").
- The agent can **propose a new category** for the workspace rail:
  "I notice you've produced 4 'Capacity Buildouts' across sessions —
  pin a section for them?" User clicks accept; section appears.
- The agent can **author small interactive panels** beyond declarative
  specs — sandboxed JSX (constrained subset: built-in components from
  the platform's design system, no arbitrary JS, no DOM access). Stored
  as artifacts; reusable; reviewable.
- The agent can **save dashboards as artifacts** — composed views with
  controls (sliders, dropdowns) that re-run underlying queries. These
  are basically "agent-built mini-apps" inside the workspace.
- Promotion ladder: an ad-hoc dashboard the agent built in one chat →
  user pins it → it becomes a saved dashboard artifact → it becomes a
  skill (parameterized, callable by name) → eventually it becomes a
  workspace section.
- Permissions: every agent-authored UI element is reviewable. The user
  controls what gets pinned vs lives ephemerally in the chat history.

## 12. Operational concerns (cross-cutting)

- **Cost telemetry** — token usage per session/user, surfaced in-app. Caps
  per user/org.
- **Key management** — users bring their own provider keys, stored encrypted
  per user (not in env). Use Supabase Vault or KMS.
- **Backups** — Supabase handles DB; filesystem artifacts need a periodic
  sync to Storage if the filesystem dies.
- **Migrations** — when zap upgrades, run a compatibility check on existing
  features and flag breakages.
- **Multi-region / latency** — eventually. Not for v1.

## Suggested build order (highest leverage first)

Re-prioritized so the harness's expressivity is unlocked early. The shell
+ universal renderer + tool-call cards come before the "data layer," because
without them every later artifact is rendered in a generic blob and the
product never feels alive.

1. **Streaming + tool-call cards in the chat** (3–5 days). Single biggest
   perceived-intelligence upgrade. Lays the substrate for every later
   tool kind (custom MCP, web fetch, etc.) to surface naturally.
2. **Workspace shell** (3–5 days). Left rail + center tabs + right rail.
   Empty sections fine for now; the layout has to exist so artifacts have
   somewhere to land.
3. **Artifacts table + universal renderer with starter view specs**
   (1 week). The schema, the storage, and the markdown/table/chart/diff/
   code/file renderers. Everything downstream plugs into this.
4. **Per-user MCP server exposing `features/`** (1–2 days). Tools the
   agent built last week become typed callable tools today.
5. **Bundle 2–3 reference networks as canonical artifacts** (2–3 days).
   IEEE-30 + WECC-240 (or PyPSA-USA) + a PyPSA-Eur slice. First real
   networks visible the moment a user signs up.
6. **Network-graph renderer + drag-and-drop PyPSA folder ingestion +
   smoke-dispatch on upload** (3–5 days). Click a network → see it
   render through the same artifact system.
7. **Heterogeneous upload + custom-importer skill loop** (1 week). Agent
   inspects unknown formats, asks clarifying questions, writes a reusable
   importer feature.
8. **Agentic data acquisition (web-fetch a named network)** (3–5 days).
   "Pull WECC 240" end-to-end with license + checksum capture.
9. **Geo-map renderer + LMP heatmap + time slider** (1 week). The
   geographic view people think in.
10. **Runs panel as a filtered artifact view + chart view spec for time
    series** (3–5 days). Existing artifact renderer; just a saved query
    and presets.
11. **PDF source ingestion → glossary + context doc → auto-loaded as
    system context** (1 week). First taste of the company-context flywheel.
12. **Candidate feature drafting from sources + Features panel approval
    flow** (1 week).
13. **Multi-modal extraction (PPTX, images, vision captioning)** (1 week).
14. **Org scopes + shared glossary/skills/networks** (1 week).
15. **Reviewer agent validation pass + status workflow** (1 week).
16. **Agentic view authoring v1: dashboards as composed view specs**
    (1–2 weeks). The agent can save multi-panel layouts as artifacts.
17. **Agentic view authoring v2: sandboxed custom panels** (2–3 weeks).
    The agent can author small interactive components against a
    constrained design-system subset. Promotion ladder from ephemeral
    chat artifact → pinned workspace section → callable skill.

Items 1–6 give you the substrate — shell, renderer, tool-call magic,
artifact model, first real data. Items 7–10 give you a working data layer
with heterogeneous uploads + web acquisition + geographic views. Items
11–15 give you the company-context flywheel + safety. Items 16–17 are
where the harness starts shaping the UI itself. Total scope: roughly
10–16 weeks of focused work to get all the way through, but items 1–10
alone (~6 weeks) already produce a product that feels meaningfully ahead
of anything in this space.

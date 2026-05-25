# Tier 3 Expansion — parked, not planned

This file is a **placeholder**, not a roadmap. The active hardening plan is
`HARDENING_ROADMAP.md`, which targets a single-VM deployment with
per-user OS isolation as its endpoint. This file exists so we don't lose
context on what *further* isolation would look like if the single-VM
model ever stops being enough.

**Do not execute anything in this file.** Do not reference it from
`HARDENING_ROADMAP.md`, `ROADMAP.md`, `STATE.md`, or any agent prompt.
Treat it as a future-state design note.

## When this becomes worth opening

Single-VM hardening (everything in `HARDENING_ROADMAP.md` Phases 1–3)
is sufficient for:

- One operator, many users from one company
- Multiple friendly companies sharing infrastructure
- Users who tolerate a shared-kernel trust model

It stops being sufficient when *any* of the following becomes true:

- A customer's compliance / audit requirements explicitly forbid
  shared-kernel multi-tenancy (regulated industries, government,
  utilities under specific NERC/CIP regimes).
- Two onboarded organizations are direct competitors and either side
  raises the trust question.
- A single user's resource needs (large planning runs, long-horizon
  sensitivity sweeps) routinely starve the rest of the VM even after
  systemd slice limits.
- The single VM becomes the bottleneck for cost reasons in the *other*
  direction — i.e., one big VM is more expensive than several small
  per-tenant ones.

If none of these is true, do not escalate.

## Options if escalation is needed

### Option A — Per-tenant container on the same VM

- Docker / Podman container per org. Same VM, same kernel, but a real
  namespace boundary and a separate filesystem root per tenant.
- Cheapest escalation; preserves the single-VM ops story.
- Still vulnerable to kernel-level escapes; not actually a security
  boundary against a determined adversary.

### Option B — Per-tenant micro-VM via Firecracker / Fly Machines

- Hardware-virtualized boundary per tenant. zap + opencode + features
  all live inside the micro-VM.
- Real isolation against kernel exploits.
- Adds image-management + scheduling work; ops complexity goes up
  noticeably.

### Option C — Per-tenant full VM, orchestrated

- Each org gets its own VM (DigitalOcean droplet, Hetzner, Fly app,
  whatever). grid-app becomes a thin router that picks the right
  per-tenant backend.
- Strongest isolation, highest per-tenant cost (idle VM still costs).
- Worth it only when a customer's contract requires data residency
  or dedicated hardware.

### Option D — Kubernetes namespace per tenant

- Don't.
- If you're tempted by this, you almost certainly want Option A or B.
- Revisit only if you have a real reason to be running a cluster
  already.

## What carries over from single-VM hardening

Most of `HARDENING_ROADMAP.md` is reusable inside whatever Tier 3 shape
you pick. Specifically:

- Supabase RLS (database isolation) is unchanged.
- `may_I_proceed` (item 2.2) still gates application-layer
  concurrency / visibility regardless of where the MCP server runs.
- Per-user OpenRouter keys (1.4) still apply per-user, not per-VM.
- Org overlay fix (1.3) still applies.
- Permission tightening (1.1) and opencode token (1.2) still apply
  per-tenant.

What changes is **only** Phase 3 — instead of OS users on one VM,
each tenant gets its own container / micro-VM / VM. Phases 1 and 2
ship the same way.

## Decision record

If/when escalation happens, write the decision here:

- Date:
- Trigger (which customer / which limit hit):
- Option chosen (A / B / C / D):
- Why this and not the others:
- Cost delta:

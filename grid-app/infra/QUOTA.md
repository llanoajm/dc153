# Disk quotas — operator runbook (HARDENING §2.3)

This document is the host-side companion to `scripts/quota_check.sh` and the
in-app over-quota gate. Steinmetz's single-VM posture means one PPTX-heavy
user can fill `/` and brick the box for everyone; the application layer
refuses new uploads once `profiles.over_quota=true`, and the kernel layer
caps how much disk that user can ever consume in the first place.

The application gate ships in this repo and works today; the kernel gate
requires the operator to apply the steps below to the VM.

## Layers

1. **`profiles.over_quota` (app-level tripwire)** — flipped by
   `scripts/quota_check.sh` when a workspace crosses 80% of its soft cap.
   Upload routes (`app/api/upload/**/route.ts`) return HTTP 507 while the
   flag is true. This works without any kernel-level changes and is enough
   for honest-broker enforcement.

2. **`quotaon` (kernel-enforced cap)** — a filesystem-level hard limit so
   even a malicious feature can't write past the cap. This is the
   "before paying users" gate; honest-broker is fine until you can't trust
   every account.

3. **`/api/admin/health`** — JSON snapshot of process CPU, free disk on the
   workspace filesystem, in-flight tool_runs, and opencode RSS. Poll from
   any external watcher (Prometheus scrape, periodic `curl`, etc).

## Step 1 — split workspace filesystem from `/`

Workspaces and the shared zap venv should live on their own block device so
user usage can't take down the OS root. Mount it under
`/home/agent/grid-workspaces` and bind-mount the shared venv onto the same
filesystem if you want a single quota domain.

```bash
# Example: dedicate /dev/vdb to workspaces, ext4 with quotas enabled.
sudo mkfs.ext4 -L steinmetz-workspaces /dev/vdb

# Mount with usrquota + grpquota at boot.
echo 'LABEL=steinmetz-workspaces  /home/agent/grid-workspaces  ext4  defaults,usrquota,grpquota  0  2' \
  | sudo tee -a /etc/fstab

sudo mkdir -p /home/agent/grid-workspaces
sudo mount /home/agent/grid-workspaces
```

XFS users: the equivalent flag is `uquota,gquota` on the mount line, and
the rest of this doc is `xfs_quota` instead of `quotaon`/`edquota`.

## Step 2 — enable quotas

```bash
# Build the quota database.
sudo quotacheck -augvm

# Turn quotas on.
sudo quotaon -aug

# Confirm.
quotaon -p /home/agent/grid-workspaces
```

The defaults we want:

| limit | value | notes |
|---|---|---|
| soft block limit (per user) | 5 GB | 80% of this trips `profiles.over_quota` |
| hard block limit (per user) | 10 GB | filesystem refuses further writes here |
| grace period | 7 days | how long a user can stay between soft and hard |

To set the default for the `steinmetz` group so every per-user OS account
(HARDENING §3.1) inherits the cap automatically:

```bash
sudo setquota -g steinmetz 5242880 10485760 0 0 /home/agent/grid-workspaces
#                          ^^^^^^^^ ^^^^^^^^
#                          soft KB  hard KB  (block count; 1KB blocks)
```

Per-user overrides:

```bash
sudo setquota -u steinmetz-<short-uid> 10485760 20971520 0 0 /home/agent/grid-workspaces
```

(`<short-uid>` is the hash-derived Linux username from HARDENING §3.1; today
the grid-app process runs as `agent`, so on a pre-Phase-3 box you can set
the quota on the single `agent` user as a stopgap.)

## Step 3 — schedule `scripts/quota_check.sh`

Cron entry, every 5 minutes:

```cron
*/5 * * * * agent  cd /home/agent/grid-app && bash scripts/quota_check.sh >> /var/log/steinmetz-quota.log 2>&1
```

The script reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
from `grid-app/.env.local` (so it can flip `profiles.over_quota` via the
PostgREST endpoint). It is idempotent — flipping is bool-valued and the
script always emits the current state, not just transitions.

To test before wiring cron:

```bash
bash scripts/quota_check.sh --dry-run
```

## Step 4 — verify in the app

1. Trigger an upload that pushes a workspace past the 80% mark (or set
   `profiles.over_quota=true` manually in the SQL editor for a test user).
2. Attempt another upload via the Sources panel — the response is HTTP 507
   with `{ "error": "over_quota", "message": "Your workspace is over its
   disk quota..." }`.
3. Free space (delete a `sources/<slug>/` folder) and rerun
   `scripts/quota_check.sh`; the next upload should succeed.

## Step 5 — monitor

`/api/admin/health` exposes the live numbers. Set
`STEINMETZ_ADMIN_EMAILS=you@example.com` in `grid-app/.env.local` and:

```bash
# From a logged-in browser session, or via a curl with the supabase cookie.
curl -b "$COOKIES" http://localhost:3000/api/admin/health | jq .
```

Sample fields:

```json
{
  "process": { "load_average": { "one": 0.03, ... }, "rss_bytes": ... },
  "disk":    { "filesystem": "/dev/vdb", "free_bytes": ..., "use_percent": 13.0 },
  "opencode": { "pids": [64369], "rss_bytes": 312000000 },
  "sessions": { "active_users": 1, "active_runs": 1, ... },
  "tool_runs": { "running": 1, "recent_errors_24h": 0, "recent_orphaned_24h": 0 }
}
```

## When this isn't enough

If a single user routinely sits at 9.9 GB while you'd like to onboard ten
more, the answer is not "bump the cap" — the box is too small. The
TIER3_EXPANSION escalation paths (separate VMs, per-customer cloud
buckets, S3-backed workspaces) live outside this roadmap; surface to the
operator before raising the soft cap past 10 GB.

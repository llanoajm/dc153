# Per-user opencode units — operator runbook (HARDENING §3.2)

This document is the host-side companion to
`infra/systemd/steinmetz-opencode@.service` and `scripts/per-user-opencode.ts`.
The in-repo plumbing ships in this PR; the steps below are what the
operator runs on the VM the first time per-user opencode is enabled, and
periodically (sudoers / `daemon-reload`) when this unit changes.

Per-user opencode is **opt-in** via the `STEINMETZ_PER_USER_OPENCODE=1`
env var on grid-app. Until that flag is on, grid-app keeps routing every
request to the shared opencode behind the §1.2 bearer-auth proxy
(`http://127.0.0.1:4097`). The flag depends on HARDENING §3.1
(`STEINMETZ_ENABLE_LINUX_ACCOUNTS=1`) — without per-user Linux accounts
the per-user systemd units have nothing to drop privileges to.

## Layers

1. **systemd template unit** — `infra/systemd/steinmetz-opencode@.service`.
   One instance per Steinmetz user (`%i` = short-uid = first 16 hex chars
   of `sha256(supabase_uid)`). Runs as `User=steinmetz-%i:steinmetz`.

2. **Per-user supervisor** — `scripts/per-user-opencode.ts`. Spawns the
   opencode HTTP server on a deterministic loopback port and exposes
   `/run/steinmetz/<short-uid>.sock` (mode 0660, group `steinmetz`) that
   forwards to it. grid-app talks to that socket directly.

3. **grid-app transport** — `lib/opencode-transport.ts`. Routes every
   opencode call to either the §1.2 fronting proxy (default) or to the
   per-user socket (when the flag is on). On the first request of a
   session it issues `sudo systemctl start steinmetz-opencode@<short>`
   and waits up to 15 s for the socket file to appear.

## Step 1 — install the template unit

```bash
sudo cp /home/agent/grid-app/infra/systemd/steinmetz-opencode@.service \
        /etc/systemd/system/
sudo systemctl daemon-reload
```

Re-run after editing the template in-repo.

## Step 2 — grant grid-app permission to start units

Create `/etc/sudoers.d/steinmetz-opencode` (mode 0440 root:root):

```
agent ALL=(root) NOPASSWD: /usr/bin/systemctl start steinmetz-opencode@*.service
agent ALL=(root) NOPASSWD: /usr/bin/systemctl status steinmetz-opencode@*.service
```

Sudo refuses `NOPASSWD` lines that contain shell metacharacters in argv,
so the glob is OK but a trailing pipe / `&&` is not. Tighten further (e.g.
`steinmetz-opencode@[0-9a-f]*.service`) once the production deploy script
is in place; today we settle for the wildcard.

The `agent` Linux user must already be a supplementary member of the
`steinmetz` group (HARDENING §3.1 prereq) so it can connect to the 0660
socket once it appears:

```bash
sudo usermod -aG steinmetz agent
# new groups apply on the next login; for an already-running grid-app:
sudo systemctl restart steinmetz-grid-app    # or whichever unit hosts it
```

## Step 3 — shared environment for opencode (optional)

Per-user units load `/etc/steinmetz/opencode.env` if it exists
(`EnvironmentFile=-...`). Use it for the shared OpenRouter key (fallback
billing when a user has no per-user key, §1.4 territory) and any other
opencode env knobs:

```bash
sudo install -d -m 0750 -o root -g steinmetz /etc/steinmetz
sudo install -m 0640 -o root -g steinmetz /dev/null /etc/steinmetz/opencode.env
sudo $EDITOR /etc/steinmetz/opencode.env
# OPENROUTER_API_KEY=sk-or-...
# OPENCODE_AUTO_UPDATE=false
```

## Step 4 — flip grid-app into per-user mode

Add to `grid-app/.env.local`:

```
STEINMETZ_ENABLE_LINUX_ACCOUNTS=1
STEINMETZ_PER_USER_OPENCODE=1
```

Restart Next.js. The next time a user opens `/app`:

1. `ensureUserWorkspace` provisions `steinmetz-<short-uid>` and chowns
   the workspace dir 700 (§3.1).
2. `createSession` issues `sudo systemctl start
   steinmetz-opencode@<short-uid>.service`. The supervisor boots
   opencode on a deterministic loopback port and creates
   `/run/steinmetz/<short-uid>.sock` 0660.
3. grid-app's `opencodeFetch` dials that socket for every subsequent
   request from that user's session.

## Step 5 — idle eviction

The supervisor watches socket activity. When no connection arrives for
`STEINMETZ_OPENCODE_IDLE_TIMEOUT` seconds (default `1800` = 30 min) it
exits 0 cleanly; systemd (`Restart=on-failure`) leaves the unit stopped.
The next request from that user re-runs Step 4 and the unit boots back
up. To override per-deploy:

```ini
# /etc/systemd/system/steinmetz-opencode@.service.d/override.conf
[Service]
Environment=STEINMETZ_OPENCODE_IDLE_TIMEOUT=600
```

Then `sudo systemctl daemon-reload`.

## Step 6 — verify (best-effort)

```bash
# Two distinct test users in two browsers; both open /app.
systemctl list-units 'steinmetz-opencode@*.service'

# Kill user A's unit; user B's chat continues to work.
sudo systemctl stop steinmetz-opencode@<short-A>.service

# Wait > IDLE_TIMEOUT minutes with no activity; the unit auto-stops.
journalctl -u steinmetz-opencode@<short-A>.service --since '40 min ago'
```

The behavioural smoke (acceptance bullet) is documented as best-effort
because this VM is not a multi-user host today; the verifier confirms
the in-repo plumbing only.

## Step 7 — per-user cgroup slices (HARDENING §3.4)

Resource caps for each per-user opencode unit live in a sibling slice unit
`steinmetz-<short-uid>.slice` (referenced by `Slice=` on the opencode
template). Caps default to `MemoryMax=4G` / `CPUQuota=200%` / `IOWeight=100`
and are tunable per user via `profiles.compute_tier` (`low` / `default` /
`high`, resolved by `lib/compute-tier.ts:resolveComputeTier`).

systemd does not instantiate `.slice` template units the way it instantiates
`@.service` units, so the file `infra/systemd/steinmetz-%i.slice` is a
*source* template that grid-app rewrites per user (substituting `%i` and the
tier's limits) and installs at user-create time.

### Materialisation

`lib/user-workspace.ts:ensureUserWorkspace` calls
`lib/compute-tier.ts:ensureUserSlice(userId)` after the workspace dir is
provisioned. When `STEINMETZ_PER_USER_SLICES=1` that helper:

1. Reads `infra/systemd/steinmetz-%i.slice` from the grid-app checkout.
2. Substitutes `%i` for the short-uid (`sha256(supabase_uid)[:16]`) and
   rewrites the `MemoryMax=` / `CPUQuota=` / `IOWeight=` lines with the
   user's resolved tier parameters.
3. `sudo install -m 0644 -o root -g root <tmp> /etc/systemd/system/steinmetz-<short-uid>.slice`.
4. `sudo systemctl daemon-reload` so the new (or changed) limits become
   live before the next `systemctl start` of the opencode unit.

Manual materialisation (for an out-of-band tier change before the surface
to edit it exists) — substitute `<short>` with the user's short-uid and
edit the limits to taste:

```bash
sed 's/%i/<short>/g' infra/systemd/steinmetz-%i.slice \
  | sudo tee /etc/systemd/system/steinmetz-<short>.slice
sudo systemctl daemon-reload
# If the user's opencode is already running, restart it so it joins the
# updated slice; otherwise the next session-start picks it up automatically.
sudo systemctl restart steinmetz-opencode@<short>.service
```

Sudoers entry on the VM (`/etc/sudoers.d/steinmetz-hardening`, mode 0440):

```
agent ALL=(root) NOPASSWD: /usr/bin/install -m 0644 -o root -g root /tmp/* /etc/systemd/system/steinmetz-*.slice
agent ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload
```

### Verifying the cap

```bash
systemctl status steinmetz-<short>.slice
# expect: MemoryMax=4.0G  CPUQuota=200%  IOWeight=100

# Provoke an OOM inside the slice; the VM and other slices stay up.
sudo -u steinmetz-<short> systemd-run --slice=steinmetz-<short>.slice \
     /bin/sh -c 'python3 -c "x=bytearray(8*1024**3)"'
journalctl -u steinmetz-<short>.slice --since '5 min ago' | grep -i oom
```

If the slice file is absent (flag off, sudo missing, install failure)
systemd creates a transient slice for the opencode unit with no caps. The
unit still starts — observable in `systemctl status steinmetz-<short>.slice`
as "Loaded: not-found" — so the failure mode is "no isolation," not "no
chat."

## Anti-goals

- **No per-user TCP port exposure beyond loopback.** The supervisor binds
  opencode to `127.0.0.1:<port>`; the Unix socket is the only intended
  ingress.
- **No bearer token on per-user sockets.** Filesystem permissions
  (steinmetz group + 0660) are the auth layer. The §1.2 fronting proxy
  remains for the shared-opencode mode and can optionally route per-user
  (header-driven) for external debug clients.
- **No opencode fork edits.** Per-user binding is achieved by a sidecar,
  not by teaching opencode to listen on a Unix socket.

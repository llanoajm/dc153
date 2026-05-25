STATUS: done
SUMMARY: HARDENING §3.1 lands as opt-in scaffolding — lib/linux-account.ts exposes shortUidFor/linuxUserFor/linuxGroup + idempotent ensureLinuxAccount (useradd + chown -R + chmod 700 via NOPASSWD sudo); wired into ensureUserWorkspace with a stat-based hand-off guard so re-entry on a chmod-700 workspace is a no-op; gated on STEINMETZ_ENABLE_LINUX_ACCOUNTS=1 so dev keeps working until §3.2 takes over workspace writes; STATE.md documents the steinmetz group + sudoers prereqs.
NEXT_STEPS:
ACCEPTANCE:
- pass: lib/user-workspace.ts ensureUserWorkspace calls the new helper which derives a short-uid (sha256 → 16 hex chars, total username "steinmetz-<short>" = 26 chars ≤ 32 Linux cap) and runs the documented useradd argv; useradd exit 9 (exists) treated as success → idempotent.
- pass: chown -R steinmetz-<short>:steinmetz + chmod 700 applied to the workspace dir after all bootstrap writes finish.
- pass: shortUidFor (plus linuxUserFor, linuxGroup) exported from lib/user-workspace.ts (re-exported from lib/linux-account.ts) for items 3.2 and 3.3 to consume.
- pass: Host-side prereqs documented in STATE.md ("Hardening flags (opt-in)" section): groupadd steinmetz, usermod -aG steinmetz agent, /etc/sudoers.d/steinmetz-hardening granting NOPASSWD on /usr/sbin/useradd + /bin/chown + /bin/chmod, and the STEINMETZ_ENABLE_LINUX_ACCOUNTS=1 toggle.
- pass: `npm run build` exits 0.
- note: per the verifier banner on the queue item, the helper is shipped opt-in (STEINMETZ_ENABLE_LINUX_ACCOUNTS=1) and was NOT executed against this VM — no Linux accounts were created, no host-side mutations performed. The wiring is in place; production deploy flips the flag once 3.2's per-user opencode units ship.
VERIFIED: yes

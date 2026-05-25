#!/usr/bin/env bash
# install_backup_cron.sh — install the nightly workspace backup cron entry
# for the `agent` user (the one that owns /home/agent/grid-workspaces). Safe
# to re-run; replaces any prior @daily steinmetz-backup line.

set -euo pipefail

ENTRY="0 3 * * * cd /home/agent/grid-app && ./scripts/backup_workspaces.sh # steinmetz-backup"

CURRENT=$(crontab -l 2>/dev/null || true)
# Drop any prior steinmetz-backup line so we don't duplicate.
NEW=$(printf '%s\n' "$CURRENT" | grep -v 'steinmetz-backup' || true)
# Append the new entry.
NEW=$(printf '%s\n%s\n' "$NEW" "$ENTRY")
# Strip any blank/leading line introduced by the trim above.
printf '%s\n' "$NEW" | sed '/^$/d' | crontab -

echo "installed crontab line:"
crontab -l | grep steinmetz-backup

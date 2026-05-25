#!/usr/bin/env bash
# backup_workspaces.sh — mirror /home/agent/grid-workspaces to Cloudflare R2.
#
# Run nightly via cron (see scripts/install_backup_cron.sh). Uses rclone with
# the [r2] remote configured in ~/.config/rclone/rclone.conf.
#
# Strategy: one always-fresh mirror at r2:steinmetz-workspaces-backup/current/
# (transfer is incremental — only changed files cross the wire). For
# point-in-time recovery, enable object versioning on the R2 bucket
# (dashboard → bucket → Settings → Object versioning) — rclone's PUTs then
# auto-create new versions, no client-side snapshot logic needed.
#
# Why no per-day prefixed snapshots: keeps R2 usage proportional to the live
# workspace size (~58 MB today) rather than 30× it; relies on R2's built-in
# versioning if you actually need history.

set -euo pipefail

SRC=/home/agent/grid-workspaces
REMOTE=r2:steinmetz-workspaces-backup/current
LOG=/var/log/steinmetz-backup.log

# Ensure /var/log/steinmetz-backup.log exists and is writable (cron runs as
# agent, but /var/log is root). Create once via sudo; subsequent runs append.
if [ ! -f "$LOG" ]; then
  sudo touch "$LOG" 2>/dev/null || LOG=/tmp/steinmetz-backup.log
  sudo chown "$(whoami)" "$LOG" 2>/dev/null || true
fi

if [ ! -d "$SRC" ]; then
  echo "[$(date -Iseconds)] WARN: $SRC not found, nothing to back up" | tee -a "$LOG"
  exit 0
fi

START=$(date +%s)
echo "[$(date -Iseconds)] backup START: $SRC → $REMOTE" >> "$LOG"

# --transfers 4: a small droplet handles 4 parallel uploads fine
# --checksum: trust SHA1 over modtime (avoids spurious re-uploads on touch)
# --fast-list: cheaper listing on R2 (one bulk LIST vs many)
# --exclude '*.tmp' / '*.lock': drop ephemeral files that change every session
# Bytes that didn't change aren't re-uploaded because of --checksum.
rclone sync \
  --transfers 4 \
  --checksum \
  --fast-list \
  --exclude '*.tmp' \
  --exclude '*.lock' \
  --exclude '.python_libs/**' \
  --exclude '.venv/**' \
  --exclude '__pycache__/**' \
  --exclude '*.pyc' \
  --exclude '.opencode/node_modules/**' \
  --exclude '.opencode/.cache/**' \
  --exclude 'node_modules/**' \
  --exclude '.next/**' \
  --stats=0 \
  "$SRC" "$REMOTE" >> "$LOG" 2>&1

END=$(date +%s)
DUR=$((END - START))

# Capture the resulting size on R2 for the log line — single LIST call.
SIZE=$(rclone size "$REMOTE" --json 2>/dev/null | jq -r '"\(.bytes) bytes, \(.count) files"' 2>/dev/null || echo "(size unavailable)")
echo "[$(date -Iseconds)] backup DONE: ${DUR}s, mirror size: $SIZE" >> "$LOG"

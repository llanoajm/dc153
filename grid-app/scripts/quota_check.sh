#!/usr/bin/env bash
# scripts/quota_check.sh — HARDENING §2.3
#
# Walk every per-user workspace under STEINMETZ_WORKSPACE_ROOT (default
# /home/agent/grid-workspaces), measure on-disk usage with `du -sb`, and
# flip `profiles.over_quota` in Supabase per user:
#
#   usage >= 80% of soft cap          → profiles.over_quota = true
#   usage <  80% of soft cap          → profiles.over_quota = false
#
# The grid-app upload routes consult that column and refuse new uploads when
# it's true. Idempotent — safe to run from cron every N minutes.
#
# Env (all optional unless noted):
#   STEINMETZ_WORKSPACE_ROOT   default /home/agent/grid-workspaces
#   STEINMETZ_QUOTA_SOFT_GB    default 5    (per-user soft cap; 80% trips the flag)
#   STEINMETZ_QUOTA_HARD_GB    default 10   (per-user hard cap; reported only)
#   NEXT_PUBLIC_SUPABASE_URL   required
#   SUPABASE_SERVICE_ROLE_KEY  required
#
# Loads the env from grid-app/.env.local automatically if the two Supabase vars
# aren't already exported.
#
# Usage:
#   bash scripts/quota_check.sh                # walk + write
#   bash scripts/quota_check.sh --dry-run      # walk + print, no Supabase writes
#
# A workspace directory whose name does not parse as a UUID is skipped (avoids
# touching the optional `_seed` or backup folders that may live alongside).

set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

ROOT="${STEINMETZ_WORKSPACE_ROOT:-/home/agent/grid-workspaces}"
SOFT_GB="${STEINMETZ_QUOTA_SOFT_GB:-5}"
HARD_GB="${STEINMETZ_QUOTA_HARD_GB:-10}"

# Compute the 80% trip point in bytes. Use awk because bash arithmetic is int-
# only and we want soft_gb * 0.80 to be precise on fractional caps.
SOFT_BYTES=$(awk -v gb="$SOFT_GB" 'BEGIN { printf "%d", gb * 1024 * 1024 * 1024 }')
TRIP_BYTES=$(awk -v gb="$SOFT_GB" 'BEGIN { printf "%d", gb * 1024 * 1024 * 1024 * 0.80 }')
HARD_BYTES=$(awk -v gb="$HARD_GB" 'BEGIN { printf "%d", gb * 1024 * 1024 * 1024 }')

# Load .env.local for SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY if they aren't
# already in the environment. We accept either NEXT_PUBLIC_SUPABASE_URL or
# SUPABASE_URL on the command line; the .env.local file uses the former.
ENV_LOCAL="$(dirname "$0")/../.env.local"
if [[ -f "$ENV_LOCAL" ]]; then
  if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
    NEXT_PUBLIC_SUPABASE_URL=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_LOCAL" | cut -d= -f2- || true)
  fi
  if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    SUPABASE_SERVICE_ROLE_KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_LOCAL" | cut -d= -f2- || true)
  fi
fi

SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-${SUPABASE_URL:-}}"

if [[ $DRY_RUN -eq 0 ]]; then
  if [[ -z "$SUPABASE_URL" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    echo "error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set" >&2
    exit 2
  fi
fi

if [[ ! -d "$ROOT" ]]; then
  echo "no workspace root at $ROOT — nothing to do" >&2
  exit 0
fi

is_uuid() {
  [[ "$1" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]
}

patch_over_quota() {
  local user_id="$1"
  local value="$2"  # "true" or "false"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  [dry-run] would PATCH profiles.over_quota=$value for $user_id"
    return 0
  fi
  # PostgREST: filter on id=eq.<uuid>, send {"over_quota": <bool>}.
  curl -sS -X PATCH \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    --data "{\"over_quota\": $value}" \
    "${SUPABASE_URL%/}/rest/v1/profiles?id=eq.${user_id}" \
    > /dev/null
}

echo "quota_check: soft=${SOFT_GB}GB trip=$(awk -v b="$TRIP_BYTES" 'BEGIN{printf "%.2f", b/1024/1024/1024}')GB hard=${HARD_GB}GB"
echo "quota_check: scanning $ROOT"

flipped_on=0
flipped_off=0
scanned=0

while IFS= read -r dir; do
  user_id=$(basename "$dir")
  if ! is_uuid "$user_id"; then
    continue
  fi
  scanned=$((scanned + 1))
  # `du -sb` reports apparent size in bytes; -x stays on the same filesystem
  # so a mounted source (e.g. zap .venv) doesn't get counted toward the user.
  bytes=$(du -sbx "$dir" 2>/dev/null | awk '{print $1}')
  bytes=${bytes:-0}
  pct=$(awk -v b="$bytes" -v s="$SOFT_BYTES" 'BEGIN { if (s == 0) print 0; else printf "%.1f", (b * 100.0) / s }')
  if (( bytes >= TRIP_BYTES )); then
    state="OVER"
    flipped_on=$((flipped_on + 1))
    echo "  $user_id : $(awk -v b="$bytes" 'BEGIN{printf "%.2f", b/1024/1024/1024}')GB (${pct}% of soft) — $state"
    patch_over_quota "$user_id" "true"
  else
    state="ok"
    flipped_off=$((flipped_off + 1))
    echo "  $user_id : $(awk -v b="$bytes" 'BEGIN{printf "%.2f", b/1024/1024/1024}')GB (${pct}% of soft) — $state"
    patch_over_quota "$user_id" "false"
  fi
done < <(find "$ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)

echo "quota_check: scanned=$scanned, flipped_on=$flipped_on, cleared=$flipped_off (dry_run=$DRY_RUN)"

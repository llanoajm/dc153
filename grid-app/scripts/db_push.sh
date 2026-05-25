#!/usr/bin/env bash
# db_push.sh — apply supabase/schema.sql to the linked Supabase project via psql.
#
# Reads SUPABASE_DB_URL from .env.local (single-quoted Postgres URI from the
# Supabase dashboard → Settings → Database → Connection string → "Session
# pooler" or "Direct connection").
#
# Idempotent — supabase/schema.sql uses `create table if not exists` / `add
# column if not exists` everywhere, so re-applying is a no-op.
#
# Usage:
#   ./scripts/db_push.sh              # apply schema.sql
#   ./scripts/db_push.sh --dry-run    # show what psql would run, but don't
#   ./scripts/db_push.sh --diff       # list tables/columns that exist in the
#                                     # live DB vs. what's mentioned in schema.sql

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=.env.local
SCHEMA_FILE=supabase/schema.sql

if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found (run from grid-app root or its scripts/ dir)" >&2
  exit 2
fi
if [ ! -f "$SCHEMA_FILE" ]; then
  echo "error: $SCHEMA_FILE not found" >&2
  exit 2
fi

# Pull SUPABASE_DB_URL out of .env.local, stripping surrounding single quotes
# if the user wrapped the URI to escape password specials.
SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL=' "$ENV_FILE" | sed "s/^SUPABASE_DB_URL=//; s/^'//; s/'$//")
if [ -z "$SUPABASE_DB_URL" ]; then
  echo "error: SUPABASE_DB_URL not set in $ENV_FILE" >&2
  exit 2
fi

case "${1:-}" in
  --dry-run)
    echo "would run: psql <SUPABASE_DB_URL> -f $SCHEMA_FILE"
    echo "  schema size: $(wc -l < "$SCHEMA_FILE") lines"
    echo "  live public tables: $(psql "$SUPABASE_DB_URL" -At -c "select count(*) from information_schema.tables where table_schema='public'")"
    exit 0
    ;;
  --diff)
    echo "=== live tables ==="
    psql "$SUPABASE_DB_URL" -At -c "select table_name from information_schema.tables where table_schema='public' order by table_name"
    echo ""
    echo "=== schema.sql 'create table' targets ==="
    grep -iE 'create table( if not exists)? (public\.)?[a-z_]+' "$SCHEMA_FILE" | sed -E 's/.*create table( if not exists)? (public\.)?([a-z_]+).*/\3/i' | sort -u
    exit 0
    ;;
  "")
    ;;
  *)
    echo "usage: $0 [--dry-run|--diff]"
    exit 2
    ;;
esac

echo "applying $SCHEMA_FILE to Supabase..."
# -1 wraps in a single transaction so a mid-file failure rolls back cleanly.
# -v ON_ERROR_STOP=1 stops at the first error rather than chugging through.
psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -1 \
  -f "$SCHEMA_FILE"

echo ""
echo "verifying expected tables present..."
psql "$SUPABASE_DB_URL" -At -c "
  select table_name
  from information_schema.tables
  where table_schema='public'
    and table_name in (
      'profiles','features','artifacts','source_chunks',
      'orgs','org_members','provider_keys','tool_runs','audit_log'
    )
  order by table_name
"
echo ""
echo "done."

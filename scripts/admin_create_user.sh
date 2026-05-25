#!/usr/bin/env bash
# admin_create_user.sh — create a Supabase user via the Admin API.
#
# Since self-signup is disabled in the Supabase project's Auth settings,
# this is the only way to bring new users into the closed beta. It hits
# `POST <SUPABASE_URL>/auth/v1/admin/users` with the service-role key and
# `email_confirm=true`, so the invitee can sign in immediately without
# any email round-trip.
#
# Usage:
#   ./scripts/admin_create_user.sh user@example.com
#   ./scripts/admin_create_user.sh user@example.com "their-chosen-password"
#
# Without a password arg, generates a 20-char random one and prints it once
# at the end so you can share it with the user.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  echo "usage: $0 <email> [password]" >&2
  exit 2
fi

EMAIL=$1
PASSWORD=${2:-}
GENERATED=0
if [ -z "$PASSWORD" ]; then
  # 20-char alphanumeric. Plenty of entropy, no shell-special chars.
  PASSWORD=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 20)
  GENERATED=1
fi

SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-)
SERVICE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)

if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_KEY" ]; then
  echo "error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local" >&2
  exit 2
fi

# Drop trailing slash on URL just in case.
SUPABASE_URL=${SUPABASE_URL%/}

RESP=$(curl -sS -X POST \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  --data "$(jq -n --arg email "$EMAIL" --arg password "$PASSWORD" '{email: $email, password: $password, email_confirm: true}')" \
  "$SUPABASE_URL/auth/v1/admin/users")

# Detect failure via presence of either `code` (PostgREST-style) or `error`
# (gotrue-style). Successful responses include `id` and `email`.
if echo "$RESP" | jq -e '.id and .email' > /dev/null 2>&1; then
  USER_ID=$(echo "$RESP" | jq -r '.id')
  echo "created:"
  echo "  user id : $USER_ID"
  echo "  email   : $EMAIL"
  if [ "$GENERATED" = "1" ]; then
    echo "  password: $PASSWORD"
    echo ""
    echo "(generated — share this once with the invitee, they should change it after first login)"
  else
    echo "  password: (the one you supplied)"
  fi
  echo ""
  echo "Login URL: https://app.steinmetz.ai/login"
else
  echo "error creating user:" >&2
  echo "$RESP" | jq . >&2
  exit 1
fi

#!/usr/bin/env bash
# launch-stack.sh — bring up the Steinmetz dev stack idempotently.
#
# Usage:
#   ./scripts/launch-stack.sh                     # interactive prompt if opencode is down
#   ./scripts/launch-stack.sh -k sk-or-...        # OpenRouter key via flag
#   OPENROUTER_API_KEY=sk-or-... ./scripts/launch-stack.sh
#
# Services brought up (each skipped if its port is already bound):
#   :3000  Next.js dev               (reads .env.local on its own)
#   :4097  opencode-proxy (bearer)   (needs STEINMETZ_OPENCODE_TOKEN from .env.local)
#   :4096  opencode server           (needs OPENROUTER_API_KEY + STEINMETZ_INTERNAL_TOKEN)
#
# Logs land in /tmp/{oc-server,oc-proxy,nx-dev}.log.

set -uo pipefail

GRID_APP=/home/agent/grid-app
OPENCODE_DIR=/home/agent/opencode
ENV_FILE=$GRID_APP/.env.local

OR_KEY=""
while getopts "k:h" opt; do
  case $opt in
    k) OR_KEY=$OPTARG ;;
    h) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) ;;
  esac
done
if [ -z "$OR_KEY" ] && [ -n "${OPENROUTER_API_KEY:-}" ]; then
  OR_KEY=$OPENROUTER_API_KEY
fi

is_listening() { ss -tlnp 2>/dev/null | grep -q ":$1\b"; }

# --- Pre-flight: token sanity ---------------------------------------------
need=0
for v in STEINMETZ_OPENCODE_URL STEINMETZ_OPENCODE_TOKEN STEINMETZ_INTERNAL_TOKEN STEINMETZ_PROVIDER_KEYS_SECRET; do
  if ! grep -q "^$v=" "$ENV_FILE" 2>/dev/null; then
    echo "MISSING: $v in $ENV_FILE"
    need=1
  fi
done
if [ "$need" = 1 ]; then
  echo ""
  echo "Regenerate the missing token(s) with:"
  echo "  cd $GRID_APP && { echo; \\"
  echo "    echo \"STEINMETZ_OPENCODE_URL=http://127.0.0.1:4097\"; \\"
  echo "    echo \"STEINMETZ_OPENCODE_TOKEN=\$(openssl rand -hex 32)\"; \\"
  echo "    echo \"STEINMETZ_INTERNAL_TOKEN=\$(openssl rand -hex 32)\"; \\"
  echo "    echo \"STEINMETZ_PROVIDER_KEYS_SECRET=\$(openssl rand -hex 32)\"; \\"
  echo "  } >> .env.local"
  exit 1
fi

OPENCODE_TOKEN=$(grep '^STEINMETZ_OPENCODE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
INTERNAL_TOKEN=$(grep '^STEINMETZ_INTERNAL_TOKEN=' "$ENV_FILE" | cut -d= -f2-)

# --- opencode-proxy (:4097) -----------------------------------------------
if is_listening 4097; then
  echo "[skip] opencode-proxy already on :4097"
else
  cd "$GRID_APP"
  STEINMETZ_OPENCODE_TOKEN="$OPENCODE_TOKEN" \
    PATH="$HOME/.bun/bin:$PATH" \
    nohup bun run scripts/opencode-proxy.ts > /tmp/oc-proxy.log 2>&1 &
  disown 2>/dev/null || true
  echo "[launched] opencode-proxy → /tmp/oc-proxy.log"
fi

# --- Next.js dev (:3000) --------------------------------------------------
if is_listening 3000; then
  echo "[skip] Next.js already on :3000"
else
  cd "$GRID_APP"
  nohup npm run dev > /tmp/nx-dev.log 2>&1 &
  disown 2>/dev/null || true
  echo "[launched] Next.js dev → /tmp/nx-dev.log"
fi

# --- opencode (:4096) — needs OPENROUTER_API_KEY --------------------------
if is_listening 4096; then
  echo "[skip] opencode already on :4096"
else
  if [ -z "$OR_KEY" ]; then
    echo ""
    read -rsp "Paste OPENROUTER_API_KEY (input hidden, press Enter): " OR_KEY
    echo ""
  fi
  if [ -z "$OR_KEY" ]; then
    echo "ERROR: OPENROUTER_API_KEY is required (provide via -k, env, or prompt)"
    exit 1
  fi
  cd "$OPENCODE_DIR"
  OPENROUTER_API_KEY="$OR_KEY" \
    STEINMETZ_INTERNAL_TOKEN="$INTERNAL_TOKEN" \
    PATH="$HOME/.bun/bin:$PATH" \
    nohup bun dev serve > /tmp/oc-server.log 2>&1 &
  disown 2>/dev/null || true
  unset OR_KEY
  echo "[launched] opencode → /tmp/oc-server.log"
fi

# --- Wait + verify --------------------------------------------------------
echo ""
echo "Waiting for services to bind..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if is_listening 3000 && is_listening 4096 && is_listening 4097; then
    break
  fi
  sleep 1
done

echo ""
echo "=== listening ports ==="
ss -tlnp 2>/dev/null | grep -E ':3000|:4096|:4097' || echo "(nothing matched)"

# --- Smoke ----------------------------------------------------------------
echo ""
echo "=== smoke ==="
printf "  no bearer    (expect 401): "
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4097/session || echo "(curl error)"
printf "  with bearer  (expect 200): "
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $OPENCODE_TOKEN" \
  http://127.0.0.1:4097/session || echo "(curl error)"

echo ""
echo "Done. Open http://localhost:3000 via your SSH tunnel (-L 3000:localhost:3000)."

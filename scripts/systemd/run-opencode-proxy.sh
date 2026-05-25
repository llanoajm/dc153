#!/usr/bin/env bash
# Wrapper that systemd's steinmetz-opencode-proxy.service invokes.
# Sources .env.local (for STEINMETZ_OPENCODE_TOKEN) and execs the Bun proxy.
set -euo pipefail
cd /home/agent/grid-app
set -a; . ./.env.local; set +a
export PATH="/home/agent/.bun/bin:$PATH"
exec /home/agent/.bun/bin/bun run scripts/opencode-proxy.ts

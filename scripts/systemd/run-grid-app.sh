#!/usr/bin/env bash
# Wrapper that systemd's steinmetz-grid-app.service invokes.
# Sources .env.local with bash semantics (handles single-quoted values
# correctly — systemd's own EnvironmentFile parser doesn't) and execs
# the production Next.js server.
set -euo pipefail
cd /home/agent/grid-app
set -a; . ./.env.local; set +a
exec /usr/bin/npm run start

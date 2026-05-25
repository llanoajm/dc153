#!/usr/bin/env bash
# Wrapper that systemd's steinmetz-opencode.service invokes.
# systemd passes OPENROUTER_API_KEY via EnvironmentFile=/etc/steinmetz/opencode.env.
# We additionally source grid-app/.env.local so opencode (and its MCP
# subprocess) inherit STEINMETZ_INTERNAL_TOKEN — needed for may_I_proceed
# admission calls back to grid-app.
set -euo pipefail
cd /home/agent/opencode
set -a; . /home/agent/grid-app/.env.local; set +a
export PATH="/home/agent/.bun/bin:$PATH"
exec /home/agent/.bun/bin/bun dev serve

#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  exec node scripts/deploy.mjs "$@"
fi
command -v docker >/dev/null 2>&1 || { echo 'Please install Docker first.'; exit 1; }
docker compose version >/dev/null
# Run only the secret-generation helper in a disposable official Node container.
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" -w /workspace node:22-alpine node scripts/setup.mjs
if [ "${1:-}" = '--public' ]; then
  docker compose -f compose.public.yaml up -d --build --wait --wait-timeout 120
else
  docker compose up -d --build --wait --wait-timeout 120
fi

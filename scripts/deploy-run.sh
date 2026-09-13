#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3100}"
mkdir -p logs
nohup npm start >logs/platform.log 2>&1 &
echo "$!" > logs/platform.pid
echo "$!"

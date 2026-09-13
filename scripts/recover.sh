#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
export HOST=${HOST:-0.0.0.0}
export PORT=${PORT:-3100}
LOG_DIR=logs
mkdir -p "$LOG_DIR"
PID_FILE="$LOG_DIR/platform-loop.pid"
LOG_FILE="$LOG_DIR/platform-loop.log"
: > "$LOG_FILE"
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" || true
    sleep 1
  fi
fi
pkill -f "node --env-file-if-exists=.env platform.mjs" || true
nohup sh -c "while true; do node --env-file-if-exists=.env platform.mjs >> '$LOG_FILE' 2>&1; echo "\"node exit code:\$? at $(date)\"" >> '$LOG_FILE'; sleep 1; done" >/dev/null 2>&1 &
echo $! > "$PID_FILE"
echo "loop:$!"

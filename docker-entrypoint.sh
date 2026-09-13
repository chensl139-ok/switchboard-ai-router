#!/bin/sh
set -eu
if [ "$(id -u)" = '0' ]; then
  mkdir -p "${DATA_DIR:-/app/data}"
  chown node:node "${DATA_DIR:-/app/data}"
  exec su-exec node "$@"
fi
exec "$@"

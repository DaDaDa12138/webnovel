#!/bin/sh
# The container starts as root only long enough to make a bind-mounted DATA_DIR writable
# for uid 1000, then drops privileges to the "node" user before running the server.
set -e
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
fi
if [ ! -f "$DATA_DIR/legado.db" ] && [ "${SEED_CORPUS:-1}" = "1" ]; then
  echo "[entrypoint] seeding corpus into $DATA_DIR"
  if [ "$(id -u)" = "0" ]; then
    setpriv --reuid=node --regid=node --clear-groups node apps/server/dist/scripts/seed.js || echo "[entrypoint] seed skipped"
  else
    node apps/server/dist/scripts/seed.js || echo "[entrypoint] seed skipped"
  fi
fi
if [ "$(id -u)" = "0" ]; then
  exec setpriv --reuid=node --regid=node --clear-groups "$@"
fi
exec "$@"

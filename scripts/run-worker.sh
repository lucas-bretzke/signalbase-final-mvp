#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [ ! -d "$ROOT_DIR/services/linkedin-worker/node_modules" ]; then
  echo "Dependencias do worker nao encontradas. Rode: npm run install:all"
  exit 1
fi
exec node "$ROOT_DIR/services/linkedin-worker/src/server.mjs"

#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/services/linkedin-worker"
if [ ! -d "$ROOT_DIR/.venv" ]; then
  echo "Ambiente Python .venv não encontrado. Rode: npm run install:all"
  exit 1
fi
exec "$ROOT_DIR/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port 8010 --reload

#!/usr/bin/env bash
set -euo pipefail
echo "[pre-commit] lint + typecheck"

echo "-> lint"
npm run lint

echo "-> typecheck"
npm run typecheck

echo "[pre-commit] OK"

#!/usr/bin/env bash
set -euo pipefail
echo "[pre-push] lint + typecheck + unit tests"

echo "-> lint"
npm run lint

echo "-> typecheck"
npm run typecheck

echo "-> unit tests"
npm run test:unit

echo "[pre-push] OK"

#!/usr/bin/env bash
set -euo pipefail
echo "[pre-push] lint + typecheck + unit tests"

echo "-> lint"
npm run lint

echo "-> typecheck"
npm run typecheck

echo "-> unit tests"
# Same SKIP_SLOW_TESTS gate as the pre-merge script — smoke tests that
# load real model weights or hit live Ollama gate themselves on this
# env var. Maintainers run smoke tests manually via `npm run test:unit`
# (without the env var) when validating engine/embedder changes.
SKIP_SLOW_TESTS=1 npm run test:unit

echo "[pre-push] OK"

#!/usr/bin/env bash
set -euo pipefail
echo "[pre-merge] full gate — lint + typecheck + unit tests"

echo "-> lint"
npm run lint

echo "-> typecheck"
npm run typecheck

echo "-> unit tests"
npm run test:unit

# Integration and e2e tests are intentionally excluded from the pre-merge gate.
# Both require live external processes (Ollama, llamacpp with GGUF models
# loaded) and belong in the sprint's evaluation story, not a synchronous
# merge gate. Run manually via `npm run test:integration` or `npm run test:e2e`
# when validating changes that touch engine/embedder/retrieval paths.

echo "[pre-merge] OK"

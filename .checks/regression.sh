#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: .checks/regression.sh --tier=quick|standard|deep|full|routine [--format=text]

Runs Pristine's tiered local regression checks.
USAGE
}

TIER=""
FORMAT="text"

for arg in "$@"; do
  case "$arg" in
    --tier=*) TIER="${arg#--tier=}" ;;
    --format=*) FORMAT="${arg#--format=}" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Invalid argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$FORMAT" != "text" ]]; then
  echo "Invalid format: $FORMAT (only text is supported)" >&2
  exit 2
fi

case "$TIER" in
  quick|standard|deep|full|routine) ;;
  "")
    echo "Missing required --tier" >&2
    usage >&2
    exit 2
    ;;
  *)
    echo "Invalid tier: $TIER" >&2
    usage >&2
    exit 2
    ;;
esac

START_SECONDS=$SECONDS
FAILED=0
RUN=0
PASSED=0
FAILED_COUNT=0
SKIPPED=0
BLOCKED=0
MANUAL_PENDING=0
CHECK_RESULTS=()
SKIP_RESULTS=()

run_check() {
  local id="$1"
  local category="$2"
  local command="$3"

  RUN=$((RUN + 1))
  echo ""
  echo "==> [$category] $id"
  echo "    $command"

  local check_start=$SECONDS
  set +e
  bash -c "$command"
  local status=$?
  set -e
  local duration=$((SECONDS - check_start))

  if [[ $status -eq 0 ]]; then
    PASSED=$((PASSED + 1))
    CHECK_RESULTS+=("PASS | $category | $id | ${duration}s | $command")
  else
    FAILED=1
    FAILED_COUNT=$((FAILED_COUNT + 1))
    CHECK_RESULTS+=("FAIL | $category | $id | ${duration}s | exit=$status | $command")
  fi
}

skip_check() {
  local id="$1"
  local category="$2"
  local reason="$3"
  SKIPPED=$((SKIPPED + 1))
  SKIP_RESULTS+=("SKIP | $category | $id | $reason")
}

run_quick() {
  run_check "lint" "Static / local checks" "npm run lint"
  run_check "typecheck" "Static / local checks" "npm run typecheck"
}

run_standard() {
  run_quick
  run_check "unit" "Unit" "npm run test:unit"
}

run_deep() {
  run_standard
  run_check "build" "Static / local checks" "npm run build"
  run_check "integration-deterministic" "Integration / contract" "SKIP_SLOW_TESTS=1 npm run test:integration"
  run_check "e2e" "E2E / smoke" "npm run test:e2e"
}

run_full() {
  run_deep
  run_check "integration-full-real-model" "Integration / contract" "npm run test:integration"
  run_check "indexer-real-model-smoke" "E2E / smoke" "npx tsx scripts/smoke-indexer.ts"
}

ROUTINE_EMPTY=0

case "$TIER" in
  quick)
    run_quick
    skip_check "unit" "Unit" "skipped: not included in quick tier"
    skip_check "integration" "Integration / contract" "skipped: not included in quick tier"
    skip_check "e2e-smoke" "E2E / smoke" "skipped: not included in quick tier"
    ;;
  standard)
    run_standard
    skip_check "integration" "Integration / contract" "skipped: not included in standard tier"
    skip_check "e2e-smoke" "E2E / smoke" "skipped: not included in standard tier"
    ;;
  deep)
    run_deep
    skip_check "integration-full-real-model" "Integration / contract" "skipped: real-model checks run in full tier"
    skip_check "indexer-real-model-smoke" "E2E / smoke" "skipped: real-model smoke runs in full tier"
    ;;
  full)
    run_full
    ;;
  routine)
    ROUTINE_EMPTY=1
    echo "Routine checks: none configured"
    skip_check "maintenance" "Other verification" "not configured"
    ;;
esac

DURATION=$((SECONDS - START_SECONDS))

if [[ $FAILED -eq 0 && $ROUTINE_EMPTY -eq 1 ]]; then
  STATUS="yellow"
  SCORE="3/5"
  NEXT_ACTION="No routine checks configured"
  EXIT_CODE=0
elif [[ $FAILED -eq 0 ]]; then
  STATUS="green"
  SCORE="5/5"
  NEXT_ACTION="Ready for next gate"
  EXIT_CODE=0
else
  STATUS="red"
  SCORE="2/5"
  NEXT_ACTION="Fix required failures"
  EXIT_CODE=1
fi

cat <<REPORT

Regression status: $STATUS
Regression score: $SCORE
Tier: $TIER
Duration: ${DURATION}s
Cost flags: paid=no, prod-adjacent=no, manual-pending=$MANUAL_PENDING, blocked=$BLOCKED
Protection changes: added=0, edited=0, removed=0, skipped=$SKIPPED
Baseline: current working tree

Verification dashboard:
- Run: $RUN
- Passed: $PASSED
- Failed: $FAILED_COUNT
- Skipped/not configured: $SKIPPED

Evidence:
REPORT

if [[ ${#CHECK_RESULTS[@]} -gt 0 ]]; then
  for result in "${CHECK_RESULTS[@]}"; do
    echo "- $result"
  done
else
  echo "- No commands run for this tier."
fi

if [[ ${#SKIP_RESULTS[@]} -gt 0 ]]; then
  echo ""
  echo "Skipped / not configured:"
  for result in "${SKIP_RESULTS[@]}"; do
    echo "- $result"
  done
fi

cat <<REPORT

Verdict / next action: $NEXT_ACTION
REPORT

exit "$EXIT_CODE"

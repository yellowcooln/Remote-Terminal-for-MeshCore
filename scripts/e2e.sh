#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting E2E tests (kicks off a build; this may take a few minutes..."
cd "$SCRIPT_DIR/tests/e2e"
npx playwright test "$@"

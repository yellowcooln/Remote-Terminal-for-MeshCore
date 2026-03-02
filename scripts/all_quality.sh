#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo -e "${YELLOW}=== RemoteTerm Quality Checks ===${NC}"
echo

# --- Phase 1: Lint + Format (backend ∥ frontend) ---

echo -e "${YELLOW}=== Phase 1: Lint & Format ===${NC}"

(
    echo -e "${BLUE}[backend lint]${NC} Running ruff check + format..."
    cd "$SCRIPT_DIR"
    uv run ruff check app/ tests/ --fix
    uv run ruff format app/ tests/
    echo -e "${GREEN}[backend lint]${NC} Passed!"
) &
PID_BACKEND_LINT=$!

(
    echo -e "${BLUE}[frontend lint]${NC} Running eslint + prettier..."
    cd "$SCRIPT_DIR/frontend"
    npm run lint:fix
    npm run format
    echo -e "${GREEN}[frontend lint]${NC} Passed!"
) &
PID_FRONTEND_LINT=$!

FAIL=0
wait $PID_BACKEND_LINT || FAIL=1
wait $PID_FRONTEND_LINT || FAIL=1
if [ $FAIL -ne 0 ]; then
    echo -e "${RED}Phase 1 failed — aborting.${NC}"
    exit 1
fi
echo -e "${GREEN}=== Phase 1 complete ===${NC}"
echo

# --- Phase 2: Typecheck + Tests + Build (all parallel) ---

echo -e "${YELLOW}=== Phase 2: Typecheck, Tests & Build ===${NC}"

(
    echo -e "${BLUE}[pyright]${NC} Running type check..."
    cd "$SCRIPT_DIR"
    uv run pyright app/
    echo -e "${GREEN}[pyright]${NC} Passed!"
) &
PID_PYRIGHT=$!

(
    echo -e "${BLUE}[pytest]${NC} Running backend tests..."
    cd "$SCRIPT_DIR"
    PYTHONPATH=. uv run pytest tests/ -v
    echo -e "${GREEN}[pytest]${NC} Passed!"
) &
PID_PYTEST=$!

(
    echo -e "${BLUE}[frontend]${NC} Running tests + build..."
    cd "$SCRIPT_DIR/frontend"
    npm run test:run
    npm run build
    echo -e "${GREEN}[frontend]${NC} Passed!"
) &
PID_FRONTEND=$!

FAIL=0
wait $PID_PYRIGHT || FAIL=1
wait $PID_PYTEST || FAIL=1
wait $PID_FRONTEND || FAIL=1
if [ $FAIL -ne 0 ]; then
    echo -e "${RED}Phase 2 failed — aborting.${NC}"
    exit 1
fi
echo -e "${GREEN}=== Phase 2 complete ===${NC}"
echo

echo -e "${GREEN}=== All quality checks passed! ===${NC}"

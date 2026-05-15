#!/usr/bin/env bash
set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[taxon]${NC} $*"; }
success() { echo -e "${GREEN}[taxon]${NC} $*"; }
warn()    { echo -e "${YELLOW}[taxon]${NC} $*"; }
error()   { echo -e "${RED}[taxon]${NC} $*" >&2; exit 1; }

# ─── Usage ────────────────────────────────────────────────────────────────────
usage() {
  echo -e "${BOLD}Usage:${NC} $0 [mode]"
  echo ""
  echo "Modes:"
  echo "  internal   Connect to LAN database (default)"
  echo "  external   Connect to remote cloud database"
  echo ""
  echo "Examples:"
  echo "  $0              # internal mode"
  echo "  $0 external"
  exit 0
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage

MODE="${1:-internal}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_DIR="$REPO_ROOT/packages/service"

# ─── Prerequisites ─────────────────────────────────────────────────────────────
info "Checking prerequisites..."

command -v node  >/dev/null 2>&1 || error "node is not installed (required: 20+)"
command -v pnpm  >/dev/null 2>&1 || error "pnpm is not installed"

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[[ "$NODE_MAJOR" -lt 20 ]] && error "Node.js 20+ required (found: $(node -v))"

# ─── Env setup ────────────────────────────────────────────────────────────────
info "Mode: ${BOLD}$MODE${NC}"

case "$MODE" in
  internal)
    [[ -f "$SERVICE_DIR/.env.internal" ]] || error ".env.internal not found in packages/service/"
    cp "$SERVICE_DIR/.env.internal" "$SERVICE_DIR/.env"
    success "Copied .env.internal → packages/service/.env"
    ;;

  external)
    [[ -f "$SERVICE_DIR/.env.external" ]] || error ".env.external not found in packages/service/"
    cp "$SERVICE_DIR/.env.external" "$SERVICE_DIR/.env"
    success "Copied .env.external → packages/service/.env"
    ;;

  *)
    error "Unknown mode '$MODE'. Run $0 --help for usage."
    ;;
esac

# ─── Dependencies ─────────────────────────────────────────────────────────────
info "Installing dependencies..."
pnpm install --frozen-lockfile

# ─── Database migrations ───────────────────────────────────────────────────────
info "Running database migrations..."
cd "$SERVICE_DIR"

npx prisma migrate deploy

cd "$REPO_ROOT"

# ─── Start dev servers ─────────────────────────────────────────────────────────
echo ""
success "Starting development servers..."
info "  Service  → http://localhost:3300  (API + Docs)"
info "  Console  → http://localhost:3400  (Management UI)"
echo ""

pnpm dev

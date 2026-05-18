#!/usr/bin/env bash
set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[taxon]${NC} $*"; }
success() { echo -e "${GREEN}[taxon]${NC} $*"; }
error()   { echo -e "${RED}[taxon]${NC} $*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_DIR="$REPO_ROOT/packages/service"

# ─── Prerequisites ─────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || error "node is not installed (required: 20+)"
command -v pnpm >/dev/null 2>&1 || error "pnpm is not installed"

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[[ "$NODE_MAJOR" -lt 20 ]] && error "Node.js 20+ required (found: $(node -v))"

# ─── Auto-detect environment ───────────────────────────────────────────────────
[[ -f "$SERVICE_DIR/.env.internal" ]] || error ".env.internal not found in packages/service/"
[[ -f "$SERVICE_DIR/.env.external" ]] || error ".env.external not found in packages/service/"

# Extract host from DATABASE_URL in .env.internal
INTERNAL_HOST=$(grep -oE '@[^:/]+' "$SERVICE_DIR/.env.internal" | head -1 | tr -d '@')

echo ""
info "Detecting network environment..."
echo -e "   ${BOLD}Target:${NC} $INTERNAL_HOST"

if ping -c 1 -W 2 "$INTERNAL_HOST" >/dev/null 2>&1; then
  cp "$SERVICE_DIR/.env.internal" "$SERVICE_DIR/.env"
  echo -e "   ${BOLD}Status:${NC} ${GREEN}● LAN reachable${NC}"
  echo -e "   ${BOLD}Config:${NC}  .env.internal"
else
  cp "$SERVICE_DIR/.env.external" "$SERVICE_DIR/.env"
  echo -e "   ${BOLD}Status:${NC} ${RED}○ LAN unreachable${NC}"
  echo -e "   ${BOLD}Config:${NC}  .env.external"
fi
echo ""

# ─── Dependencies ─────────────────────────────────────────────────────────────
info "Installing dependencies..."
pnpm install

# ─── Database migrations ───────────────────────────────────────────────────────
info "Running database migrations..."
cd "$SERVICE_DIR"
npx prisma migrate deploy
cd "$REPO_ROOT"

# ─── Start dev servers ─────────────────────────────────────────────────────────
echo ""
success "Starting development servers..."
echo -e "   ${BOLD}Service${NC}  → http://localhost:3300  (API + Docs)"
echo -e "   ${BOLD}Console${NC}  → http://localhost:3400  (Management UI)"
echo ""

pnpm dev

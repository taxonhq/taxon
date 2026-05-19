#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()    { echo -e "${CYAN}[taxon]${NC} $*"; }
ok()      { echo -e "${GREEN}[taxon]${NC} $*"; }
warn()    { echo -e "${YELLOW}[taxon]${NC} $*"; }
error()   { echo -e "${RED}[taxon]${NC} $*" >&2; exit 1; }
step()    { echo -e "   ${DIM}$*${NC}"; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_DIR="$REPO_ROOT/packages/service"

# ─── Prerequisites ────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || error "node is not installed (required: 20+)"
command -v pnpm >/dev/null 2>&1 || error "pnpm is not installed"
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[[ "$NODE_MAJOR" -lt 20 ]] && error "Node.js 20+ required (found: $(node -v))"

# ─── Free ports ───────────────────────────────────────────────────────────────
free_port() {
  local port=$1
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null | tr '\n' ' ' | xargs || true)
  if [[ -n "$pids" ]]; then
    warn "Port $port in use — killing pid $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.3
  fi
}

# ─── Environment detection ────────────────────────────────────────────────────
[[ -f "$SERVICE_DIR/.env.internal" ]] || error ".env.internal not found in packages/service/"
[[ -f "$SERVICE_DIR/.env.external" ]] || error ".env.external not found in packages/service/"

INTERNAL_HOST=$(grep -oE '@[^:/]+' "$SERVICE_DIR/.env.internal" | head -1 | tr -d '@')

if ping -c 1 -W 2 "$INTERNAL_HOST" >/dev/null 2>&1; then
  cp "$SERVICE_DIR/.env.internal" "$SERVICE_DIR/.env"
  ENV_LABEL="${GREEN}● LAN${NC}  (.env.internal)"
else
  cp "$SERVICE_DIR/.env.external" "$SERVICE_DIR/.env"
  ENV_LABEL="${RED}○ WAN${NC}  (.env.external)"
fi

# ─── Dependencies ─────────────────────────────────────────────────────────────
info "Installing dependencies..."
# Capture output; only print on failure
INSTALL_OUT=$(pnpm install --reporter=silent 2>&1) || {
  echo "$INSTALL_OUT"
  error "pnpm install failed"
}
# Show a one-line summary if packages changed
CHANGED=$(echo "$INSTALL_OUT" | grep -E '^\+' | head -1 || true)
[[ -n "$CHANGED" ]] && step "packages: $CHANGED"

# ─── Database migrations ──────────────────────────────────────────────────────
info "Running database migrations..."
cd "$SERVICE_DIR"
MIGRATE_OUT=$(npx prisma migrate deploy 2>&1) || {
  echo "$MIGRATE_OUT"
  error "prisma migrate deploy failed"
}
PENDING=$(echo "$MIGRATE_OUT" | grep -E 'migration|Applied' | tail -1 || true)
[[ -n "$PENDING" ]] && step "$PENDING"
cd "$REPO_ROOT"

# ─── Launch ───────────────────────────────────────────────────────────────────
echo ""
ok "Ready"
echo -e "   ${BOLD}DB${NC}       $ENV_LABEL"
echo -e "   ${BOLD}Service${NC}  → http://localhost:3300"
echo -e "   ${BOLD}Console${NC}  → http://localhost:3400"
echo ""

# Kill after install (postinstall: prisma generate may retrigger tsx watch)
free_port 3300
free_port 3400

exec pnpm --silent dev

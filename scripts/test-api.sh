#!/usr/bin/env bash
# Full API smoke test — run after dev servers are up
set -euo pipefail

BASE="http://localhost:3300"
PASS=0
FAIL=0

# ─── Helpers ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

section() { echo -e "\n${BOLD}${CYAN}━━ $* ━━${NC}"; }

ok() {
  echo -e "  ${GREEN}✓${NC} $*"
  ((PASS++))
}

fail() {
  echo -e "  ${RED}✗${NC} $*"
  ((FAIL++))
}

# assert_eq <label> <actual> <expected>
assert_eq() {
  if [[ "$2" == "$3" ]]; then ok "$1"; else fail "$1 (got: $2, want: $3)"; fi
}

# req <method> <path> [body] → prints response JSON
req() {
  local method=$1 path=$2 body=${3:-}
  if [[ -n "$body" ]]; then
    curl -sf -X "$method" "$BASE$path" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sf -X "$method" "$BASE$path"
  fi
}

# code <response_json>
code() { echo "$1" | jq -r '.code'; }

# data_field <response_json> <jq_expr>
field() { echo "$1" | jq -r "$2"; }

# ─── Health / Docs ─────────────────────────────────────────────────────────────
section "Health & Docs"

r=$(curl -sf "$BASE/openapi.json")
assert_eq "GET /openapi.json returns 200" "$(field "$r" '.info.title')" "Taxon"

r=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/docs")
assert_eq "GET /docs returns 200" "$r" "200"

# ─── Tag Groups ────────────────────────────────────────────────────────────────
section "Tag Groups"

# Create
r=$(req POST /tag-groups '{"name":"Cuisine","allowMultiple":false,"entityScopes":["dish"]}')
assert_eq "POST /tag-groups code=0" "$(code "$r")" "0"
GROUP_ID=$(field "$r" '.data.id')
GROUP_SLUG=$(field "$r" '.data.slug')
assert_eq "slug auto-generated" "$GROUP_SLUG" "cuisine"

# Duplicate name → 409
r=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BASE/tag-groups" \
  -H "Content-Type: application/json" \
  -d '{"name":"Cuisine","allowMultiple":false}')
assert_eq "POST /tag-groups duplicate → 409" "$r" "409"

# Get one
r=$(req GET "/tag-groups/$GROUP_ID")
assert_eq "GET /tag-groups/:id code=0" "$(code "$r")" "0"
assert_eq "GET /tag-groups/:id name" "$(field "$r" '.data.name')" "Cuisine"

# List
r=$(req GET "/tag-groups")
assert_eq "GET /tag-groups code=0" "$(code "$r")" "0"
assert_eq "GET /tag-groups has items" "$(field "$r" '.data.items | length > 0')" "true"

# Patch
r=$(req PATCH "/tag-groups/$GROUP_ID" '{"allowMultiple":true}')
assert_eq "PATCH /tag-groups/:id code=0" "$(code "$r")" "0"
assert_eq "PATCH allowMultiple updated" "$(field "$r" '.data.allowMultiple')" "true"

# Entity rules — full replace
r=$(req PUT "/tag-groups/$GROUP_ID/entity-rules" \
  '[{"entityType":"dish","allowMultiple":false}]')
assert_eq "PUT /tag-groups/:id/entity-rules code=0" "$(code "$r")" "0"

# ─── Tags ──────────────────────────────────────────────────────────────────────
section "Tags"

# Create
r=$(req POST /tags "{\"groupId\":\"$GROUP_ID\",\"name\":\"Sichuan\"}")
assert_eq "POST /tags code=0" "$(code "$r")" "0"
TAG_ID=$(field "$r" '.data.id')
assert_eq "tag slug auto-generated" "$(field "$r" '.data.slug')" "sichuan"

# Duplicate in same group → 409
r=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BASE/tags" \
  -H "Content-Type: application/json" \
  -d "{\"groupId\":\"$GROUP_ID\",\"name\":\"Sichuan\"}")
assert_eq "POST /tags duplicate in group → 409" "$r" "409"

# Create second tag
r=$(req POST /tags "{\"groupId\":\"$GROUP_ID\",\"name\":\"Cantonese\"}")
TAG2_ID=$(field "$r" '.data.id')
assert_eq "POST second tag code=0" "$(code "$r")" "0"

# List tags in group
r=$(req GET "/tag-groups/$GROUP_ID/tags")
assert_eq "GET /tag-groups/:id/tags code=0" "$(code "$r")" "0"
assert_eq "tag list has 2 items" "$(field "$r" '.data.total')" "2"

# Patch tag
r=$(req PATCH "/tags/$TAG_ID" '{"description":"Spicy cuisine from Sichuan province"}')
assert_eq "PATCH /tags/:id code=0" "$(code "$r")" "0"

# ─── Entities ──────────────────────────────────────────────────────────────────
section "Entity Registration"

# Register
r=$(req POST "/entities/dish/dish-001")
assert_eq "POST /entities/dish/dish-001 code=0" "$(code "$r")" "0"

# Re-register (idempotent) → still 0
r=$(req POST "/entities/dish/dish-001")
assert_eq "POST /entities re-register idempotent" "$(code "$r")" "0"

# Check exists
r=$(req GET "/entities/dish/dish-001")
assert_eq "GET /entities/dish/dish-001 code=0" "$(code "$r")" "0"

# Check non-existent → 404
r=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE/entities/dish/no-such")
assert_eq "GET /entities non-existent → 404" "$r" "404"

# ─── Entity Tagging ────────────────────────────────────────────────────────────
section "Entity Tagging"

# Add tag (manual)
r=$(req POST "/entities/dish/dish-001/tags/$TAG_ID")
assert_eq "POST tag to entity code=0" "$(code "$r")" "0"
assert_eq "tag status active" "$(field "$r" '.data.status')" "active"

# Add second tag — entity-type rule says allowMultiple=false → 409
r=$(curl -sf -o /dev/null -w "%{http_code}" -X POST \
  "$BASE/entities/dish/dish-001/tags/$TAG2_ID")
assert_eq "POST second tag blocked by allowMultiple=false → 409" "$r" "409"

# Get entity tags
r=$(req GET "/entities/dish/dish-001/tags")
assert_eq "GET entity tags code=0" "$(code "$r")" "0"
assert_eq "entity has 1 tag" "$(field "$r" '.data | length')" "1"

# Add AI tag to second entity
r=$(req POST "/entities/dish/dish-002")
r=$(req POST "/entities/dish/dish-002/tags/$TAG_ID" \
  '{"source":"ai","confidence":0.92}')
assert_eq "POST AI tag code=0" "$(code "$r")" "0"
assert_eq "AI tag status pending" "$(field "$r" '.data.status')" "pending"
assert_eq "AI tag confidence set" "$(field "$r" '.data.confidence')" "0.92"

# ─── Audit Queue ───────────────────────────────────────────────────────────────
section "Audit Queue"

r=$(req GET "/entities/audit")
assert_eq "GET /entities/audit code=0" "$(code "$r")" "0"
PENDING=$(field "$r" '.data.total')
[[ "$PENDING" -ge 1 ]] && ok "audit queue has pending items ($PENDING)" \
                         || fail "audit queue empty (expected ≥1)"

# Filter by status
r=$(req GET "/entities/audit?status=pending")
assert_eq "GET /entities/audit?status=pending code=0" "$(code "$r")" "0"

# Approve AI tag
r=$(req PATCH "/entities/dish/dish-002/tags/$TAG_ID" '{"status":"active"}')
assert_eq "PATCH tag → active code=0" "$(code "$r")" "0"

# Reject tag
r=$(req PATCH "/entities/dish/dish-002/tags/$TAG_ID" '{"status":"rejected"}')
assert_eq "PATCH tag → rejected code=0" "$(code "$r")" "0"

# ─── Entity Types ──────────────────────────────────────────────────────────────
section "Entity Types"

r=$(req GET "/entity-types")
assert_eq "GET /entity-types code=0" "$(code "$r")" "0"
assert_eq "entity type dish present" \
  "$(field "$r" '.data[] | select(.entityType=="dish") | .entityType')" "dish"

# ─── Soft Delete ───────────────────────────────────────────────────────────────
section "Soft Delete"

# Delete tag in use without force → 409
r=$(curl -sf -o /dev/null -w "%{http_code}" -X DELETE "$BASE/tags/$TAG_ID")
assert_eq "DELETE tag in use → 409" "$r" "409"

# Force delete tag
r=$(req DELETE "/tags/$TAG_ID?force=true")
assert_eq "DELETE tag ?force=true code=0" "$(code "$r")" "0"

# Recreate same name → should succeed (unique constraint freed)
r=$(req POST /tags "{\"groupId\":\"$GROUP_ID\",\"name\":\"Sichuan\"}")
assert_eq "Recreate soft-deleted tag name code=0" "$(code "$r")" "0"
NEW_TAG_ID=$(field "$r" '.data.id')

# Force delete group (cascades)
r=$(req DELETE "/tag-groups/$GROUP_ID?force=true")
assert_eq "DELETE group ?force=true code=0" "$(code "$r")" "0"

# Recreate same group name → should succeed
r=$(req POST /tag-groups '{"name":"Cuisine","allowMultiple":false}')
assert_eq "Recreate soft-deleted group name code=0" "$(code "$r")" "0"
CLEANUP_GROUP_ID=$(field "$r" '.data.id')

# Cleanup
req DELETE "/tag-groups/$CLEANUP_GROUP_ID?force=true" >/dev/null
req DELETE "/entities/dish/dish-001" >/dev/null
req DELETE "/entities/dish/dish-002" >/dev/null

# ─── Summary ───────────────────────────────────────────────────────────────────
echo ""
TOTAL=$((PASS + FAIL))
if [[ "$FAIL" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All $TOTAL tests passed.${NC}"
else
  echo -e "${RED}${BOLD}$FAIL/$TOTAL tests failed.${NC}"
  exit 1
fi

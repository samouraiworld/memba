#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# pre-push hook — Memba repository guardrails
#
# Enforces:
#   1. BLOCKS direct pushes to main (must use PR)
#   2. BLOCKS force-pushes to main
#   3. REMINDS to run full CI (including E2E) before pushing
#
# Install: cp scripts/pre-push.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push
# ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color
BOLD='\033[1m'

remote="$1"

while read local_ref local_sha remote_ref remote_sha; do
    # Extract remote branch name
    remote_branch=$(echo "$remote_ref" | sed 's|refs/heads/||')

    # ── RULE 1: Block direct pushes to main ──
    if [ "$remote_branch" = "main" ]; then
        echo ""
        echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║  🚫  BLOCKED: Direct push to main is FORBIDDEN             ║${NC}"
        echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
        echo -e "${RED}║                                                              ║${NC}"
        echo -e "${RED}║  ALL changes MUST go through Pull Requests.                  ║${NC}"
        echo -e "${RED}║                                                              ║${NC}"
        echo -e "${RED}║  Correct workflow:                                           ║${NC}"
        echo -e "${RED}║    1. git checkout -b fix/<scope>                            ║${NC}"
        echo -e "${RED}║    2. git push origin fix/<scope>                            ║${NC}"
        echo -e "${RED}║    3. Open PR on GitHub                                      ║${NC}"
        echo -e "${RED}║    4. Wait for CI, then squash merge                         ║${NC}"
        echo -e "${RED}║                                                              ║${NC}"
        echo -e "${RED}║  See: .agents/workflows/git-policy.md                        ║${NC}"
        echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        exit 1
    fi
done

# ── RULE 2: Remind about full CI ──
echo ""
echo -e "${YELLOW}┌──────────────────────────────────────────────────────────────┐${NC}"
echo -e "${YELLOW}│  ⚠  PRE-PUSH REMINDER: Did you run the FULL CI checklist?   │${NC}"
echo -e "${YELLOW}├──────────────────────────────────────────────────────────────┤${NC}"
echo -e "${YELLOW}│                                                              │${NC}"
echo -e "${YELLOW}│  ${BOLD}Required before EVERY push:${NC}${YELLOW}                                 │${NC}"
echo -e "${YELLOW}│    ✓ npm run build          (TypeScript + Vite)              │${NC}"
echo -e "${YELLOW}│    ✓ npm run lint           (ESLint, 0 errors)              │${NC}"
echo -e "${YELLOW}│    ✓ npm test -- --run      (unit tests)                    │${NC}"
echo -e "${YELLOW}│    ✓ npx playwright test    (E2E — DO NOT SKIP!)            │${NC}"
echo -e "${YELLOW}│    ✓ go test -race ./...    (backend)                       │${NC}"
echo -e "${YELLOW}│                                                              │${NC}"
echo -e "${YELLOW}└──────────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "${GREEN}✓ Push allowed (not targeting main directly)${NC}"
echo ""

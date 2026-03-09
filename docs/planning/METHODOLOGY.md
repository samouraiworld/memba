# Memba — Development Methodology

> **Version**: 1.0 | **Effective**: v2.1+ milestones
> **Read**: [SESSION_CONVENTIONS.md](SESSION_CONVENTIONS.md) first, then this file.

---

## Milestone Lifecycle

Each milestone MUST produce these 5 documents in order:

| # | Document | When | Purpose |
|---|----------|------|---------|
| 1 | **BRIEF.md** | Before coding starts | Scope, acceptance criteria, non-goals, dependencies |
| 2 | **IMPLEMENTATION.md** | Before coding starts | File-by-file changes, new files, interfaces, data flow |
| 3 | **AUDIT.md** | After implementation | 11+ perspective review, findings, mitigations |
| 4 | **HANDOFF.md** | At each session end | What was done, what remains, gotchas, test results |
| 5 | **SUMMARY.md** | At milestone close | Final status, metrics, lessons learned |

## Directory Structure

```
docs/planning/
├── MASTER_ROADMAP.md           ← milestone index
├── SESSION_CONVENTIONS.md      ← session rules
├── METHODOLOGY.md              ← this file
├── archive/                    ← shipped milestones (v2.0-α→θ)
└── milestones/                 ← ACTIVE milestones only
    └── v2.1a-community/
        ├── BRIEF.md
        ├── IMPLEMENTATION.md
        ├── AUDIT.md
        ├── HANDOFF.md
        └── SUMMARY.md
```

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| AI Hallucination | `tsc --noEmit` + `go vet` + E2E tests catch all errors |
| Git Accidents | Pre-push hook blocks `main`, branch protection enforced |
| CI Failures | Full 6-step CI checklist before every push |
| Outdated Docs | Documentation Gate checklist, HANDOFF at session end |
| Scope Creep | BRIEF.md defines hard scope + non-goals |
| Upstream Breakage | Tracking table in MASTER_ROADMAP.md, monthly pulls |
| Security Regression | 11-perspective audit per feature |
| Knowledge Loss | HANDOFF.md at session end, Knowledge Items updated |

## Quality Gates (Per Feature)

All checks must pass before any PR merge:

```bash
# Frontend
cd frontend && npm run build          # 0 errors
cd frontend && npm run lint           # 0 errors
cd frontend && npm test -- --run      # 360+ tests pass
cd frontend && npx playwright test    # E2E all pass
cd frontend && npx tsc --noEmit      # 0 type errors

# Backend
cd backend && go test -race -count=1 ./...
cd backend && go build ./...
cd backend && govulncheck ./...
```

## Documentation Gate

| File | Update when |
|------|------------|
| `CHANGELOG.md` | Every feature merge |
| `ROADMAP.md` | Milestone status changes |
| `README.md` | User-facing feature changes |
| `MASTER_ROADMAP.md` | Milestone starts/completes |
| `docs/ARCHITECTURE.md` | Data flow changes |
| Milestone `HANDOFF.md` | Every session end |

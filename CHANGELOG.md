# Changelog

All notable changes to Memba are documented here.

Full changelogs are split by version range for easier navigation:

## Unreleased

## v6.0.0 (2026-04-16) — Security Hardening, AVL Migration & Accessibility

### Security (10 fixes)
- **AUTH-01**: Pubkey-bound challenges prevent zero-click account takeover
- **SEC-01**: Removed unauthenticated `/api/eval` endpoint
- **SEC-02/03**: Auth required on IPFS upload and AI analyst endpoints
- **SEC-04**: Removed CORS wildcard for Netlify deploy previews
- **SEC-06**: Rate limiting now uses `Fly-Client-IP` (spoofing-proof)
- **SEC-NEW-01**: Fixed JSON injection in ABCI query construction
- **SEC-NEW-03**: Added 1MB body size limit to ConnectRPC handler
- **SEC-NEW-04**: Removed user-controllable LLM prompts (prompt injection)
- **SEC-05**: NFTGallery XSS fix (DOMPurify after markdown conversion)

### Gno Templates
- **GNO-NEW-01**: Unified AVL import paths (`p/demo/avl` → `p/nt/avl/v0`) across all templates
- **GNO-01**: Migrated daoTemplate from slices to AVL trees (O(n) → O(log n) lookups)
- **GNO-02**: Added `Render("page:N")` pagination to agent_registry, escrow, and daoTemplate
- **DEFI-01**: Fixed escrow dispute timeout — now refunds CLIENT (was releasing to freelancer)

### UX & Accessibility
- **UX-01**: Global `:focus-visible` styles for keyboard navigation (WCAG 2.1 AA)
- **UX-02**: Added 320px breakpoint with overflow guards
- **UX-04**: Vote confirmation dialog before irreversible on-chain votes
- **ARCH-07**: Replaced hardcoded hex colors with theme tokens in 3 files

### Infrastructure
- `min_machines_running = 1` (prevents cold start DoS)
- Memory: 256MB → 512MB
- ED25519_SEED startup guard (fails if unset in production)
- `npm test` added to deploy-frontend CI gate
- Coverage reporting (backend + frontend) with artifact upload
- Bundle size budget enforcement (main chunk < 600KB)
- Gno lint now fails CI (removed `|| true`)

### Docs
- `docs/planning/MEMBA_V6_IMPLEMENTATION_PLAN.md` — 32-expert audit, 108 issues catalogued
- `docs/SECRETS_ROTATION.md` — rotation procedures for all credentials
- `docs/PROGRESSIVE_DECENTRALIZATION.md` — roadmap for reducing centralization

## Version History

| Version Range | File | Period |
|---------------|------|--------|
| **v4.0** | [changelogs/v4.0.md](changelogs/v4.0.md) | 2026-04-08 |
| **v3.x** (v3.1–v3.2) | [changelogs/v3.x.md](changelogs/v3.x.md) | 2026-04-04 — 2026-04-06 |
| **v2.14–v2.29** | [changelogs/v2.14-v2.29.md](changelogs/v2.14-v2.29.md) | 2026-03-17 — 2026-04-02 |
| **v1.0–v2.13** | [changelogs/v1.0-v2.13.md](changelogs/v1.0-v2.13.md) | Pre-2026-03-17 |

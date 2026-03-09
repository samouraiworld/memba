# v2.2a BRIEF — Organization Directory

> **Milestone**: v2.2a Intelligence & Directory — Phase 1
> **Branch**: `feat/v2.2a-directory`
> **Target**: Enhanced Directory with on-chain DAO/token/user discovery

## Objective

Transform the existing Directory page from a basic list into a **premium Organization Hub** — the central discovery interface for all Gno ecosystem entities. This is the first feature of the v2.2 "Intelligence & Growth" phase, designed as a **multiplier** for notifications and validators (v2.1b) by making DAOs easier to find and save.

## Scope

### Feature 1: DAO Discovery Engine
- **On-chain DAO registry scan** via ABCI (enumerate known DAO factories)
- **DAO detail cards** — member count, proposal count, creation date (parsed from Render)
- **Category tags** — governance, community, treasury, custom
- **Featured DAOs carousel** — curated top DAOs with rich metadata
- **"Add to Memba" one-click save** — wires directly into notification polling

### Feature 2: Enhanced Member Directory
- **IPFS avatar display** in user cards (using existing `ipfs.ts` infrastructure)
- **DAO membership badges** — shows which DAOs a user belongs to
- **Contribution score** — basic metric from proposal activity

### Feature 3: Directory CSS Extraction
- **Extract inline styles → `directory.css`** — 469-line component currently uses all inline styles
- **Premium card design** — glassmorphism consistency with Validators + FaucetCard
- **Responsive grid** — proper mobile layout (currently `auto-fit` only)

### Feature 4: Directory Data Layer
- **`lib/directory.ts`** — centralized data fetching for DAOs/tokens/users
- **Proper caching** — move from module-level `cache` object to `sessionStorage`
- **Error boundaries** — per-tab error handling with retry

## Quality Target
- Unit tests for data layer + parsing logic
- E2E test for Directory page
- tsc 0, lint 0, build clean

## Not In Scope (v2.2b+)
- AI Facilitator (proposal summarization)
- Full-text search across proposals
- On-chain DAO ranking/scoring algorithm

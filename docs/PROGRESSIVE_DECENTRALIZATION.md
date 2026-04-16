# Progressive Decentralization Plan

> How Memba will reduce its reliance on centralized infrastructure over time.

---

## Current Centralization Points

| Component | Centralized? | Why | Risk |
|-----------|-------------|-----|------|
| **Go Backend** (Fly.io) | Yes | Multisig signature coordination, auth tokens, quest/team data | Backend down = no multisig, no profiles |
| **Admin Key** | Yes (2-of-2 multisig) | All realm operations, dispute resolution | Key compromise = total system control |
| **AI Analyst** | Yes | API keys for LLM providers must stay server-side | Backend down = no AI analysis |
| **IPFS Upload** | Yes | Lighthouse API key proxied through backend | Backend down = no avatar uploads |
| **Clerk Auth** | Yes | /alerts section authentication | Clerk outage = no alert config |

### What's Already Decentralized

| Component | Status | How |
|-----------|--------|-----|
| **DAO Governance** | Fully on-chain | Direct ABCI queries, no backend involvement |
| **Token Operations** | Fully on-chain | GRC20 factory via Adena MsgCall |
| **Validator Monitoring** | Fully on-chain | Tendermint RPC queries, no backend |
| **Wallet Signing** | Client-side | Adena extension, backend never holds keys |
| **Directory/Search** | Fully on-chain | ABCI queries to realm Render() |

---

## Decentralization Roadmap

### Phase 1: On-Chain Profiles (v7.x)

**Goal:** Move user profile data from SQLite to a Gno realm.

**Current state:** Profiles stored in backend SQLite (`profiles` table) — bio, company, title, avatar, social links.

**Target:** Deploy a `memba_profiles` realm that stores profile data on-chain. The backend becomes a read-through cache, not the source of truth.

**Steps:**
1. Design `memba_profiles` realm with `SetProfile(bio, avatar, ...)` and `Render("address")` 
2. Deploy to test12
3. Migrate frontend to read profiles from chain first, fall back to backend
4. Deprecate backend `GetProfile`/`UpdateProfile` RPCs (keep as cache layer)

**Prerequisite:** Stable test12 chain, gas sponsorship for profile updates.

### Phase 2: On-Chain Quest Completion (v7.x)

**Goal:** Use GRC721 badge NFTs as the canonical source of truth for quest completion.

**Current state:** Quest completions stored in backend SQLite (`quest_completions` table) + localStorage dual-write.

**Target:** Quest verification mints a GRC721 badge on-chain. The backend + localStorage become read caches.

**Steps:**
1. Integrate `gnobuilders_badges` realm (already deployed) as the verification target
2. On quest completion, mint a badge NFT via Adena MsgCall
3. Read quest state from chain (`OwnerOf` checks) with localStorage cache
4. Deprecate backend `CompleteQuest`/`SyncQuests` RPCs

**Prerequisite:** Gas sponsorship or faucet for badge minting.

### Phase 3: Multi-Backend Resilience (v8.x)

**Goal:** Frontend can discover and fail over between multiple Memba backends.

**Current state:** Single Fly.io instance (`memba-backend.fly.dev`).

**Target:** Anyone can run a Memba backend (Docker Compose already exists). The frontend discovers available backends and fails over automatically.

**Steps:**
1. Add backend discovery endpoint (or use DNS SRV records)
2. Frontend maintains a list of known backend URLs
3. On backend failure, rotate to next available
4. Health check integration: only use backends with healthy `/health` responses
5. Document "Run Your Own Memba Backend" guide

**Prerequisite:** SQLite replication (Litestream/Turso) for data consistency across backends.

### Phase 4: Admin Governance Migration (v9.x)

**Goal:** Replace the single admin key with DAO governance for realm operations.

**Current state:** All 9 realms use `AdminAddress = "g1x7k4..."` (2-of-2 multisig).

**Target:** Admin operations (dispute resolution, agent removal, realm pause) require a DAO governance proposal + vote.

**Steps:**
1. Deploy a `memba_admin_dao` realm with the current admin multisig as the initial member
2. Add timelock on admin actions (24h delay before execution)
3. Migrate realm admin references from hardcoded address to DAO cross-realm calls
4. Add community members to the admin DAO over time
5. Remove the hardcoded admin address entirely

**Prerequisite:** Stable cross-realm call patterns in GnoVM, tested on testnet.

---

## Decision Framework

When evaluating whether to decentralize a component, consider:

1. **User impact of centralization** — Does the backend being down block core functionality?
2. **Data sovereignty** — Does the user own their data, or does Samourai Coop?
3. **Gas cost** — Is the on-chain operation affordable for users?
4. **Complexity** — Does decentralization add UX friction?
5. **Security** — Is on-chain storage safer than backend storage for this data?

The guiding principle: **decentralize when the benefit to users exceeds the cost in UX complexity.**

---

*Last updated: 2026-04-16 (v6)*

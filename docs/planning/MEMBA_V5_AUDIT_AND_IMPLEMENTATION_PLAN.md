# Memba V5 — Full-Stack Expert Audit & Implementation Plan

> **Date:** 2026-04-09
> **Revision:** v2 (post dual-CTO review)
> **Methodology:** 200+ expert perspectives across 10 feature panels + 2 CTO expert reviews
> **Scope:** Every feature, page, component, realm, RPC endpoint, and plugin
> **Chain:** test12 (9 realms deployed, block ~239,734 — chain halted ~10h for maintenance)

---

## PART 1 — GRAND AUDIT SUMMARY

### Issue Totals (330 issues across 10 features)

| Priority | Count | Definition |
|----------|-------|------------|
| **P0 — Critical** | **14** | Broken functionality, security vulnerabilities, will-not-work bugs |
| **P1 — High** | **75** | Significant functional gaps, data integrity, UX failures |
| **P2 — Medium** | **155** | Performance, consistency, test coverage, mobile |
| **P3 — Low** | **86** | Polish, future architecture, nice-to-have |
| **Total** | **330** | |

### Per-Feature Breakdown

| # | Feature | P0 | P1 | P2 | P3 | Total |
|---|---------|----|----|----|----|-------|
| 1 | Multisig Wallets | 2 | 7 | 18 | 7 | 34 |
| 2 | Token Launchpad | 1 | 10 | 19 | 10 | 40 |
| 3 | NFT & Marketplace | 2 | 11 | 17 | 8 | 38 |
| 4 | Quest System | 0 | 5 | 14 | 7 | 26 |
| 5 | DAO Governance | 1 | 7 | 11 | 6 | 25 |
| 6 | Validators Dashboard | 0 | 4 | 14 | 10 | 28 |
| 7 | AI Analyst + Alerts | 0 | 6 | 11 | 8 | 25 |
| 8 | Profiles, Auth, Infra | 2 | 8 | 18 | 12 | 40 |
| 9 | Gnolove & Directory | 0 | 9 | 17 | 8 | 34 |
| 10 | Channels & Plugins | 6 | 8 | 16 | 10 | 40 |

---

## PART 2 — ALL P0 CRITICAL ISSUES (14)

These are ship-blockers. Nothing else should start until these are resolved.

### P0-01: Channels Realm — Zero On-Chain ACL
- **File:** `contracts/memba_channels_stub/channels.gno:152,179,214,290,323`
- **Impact:** ANY wallet can post, create channels, remove threads, flag content
- **Fix:** Add `assertCallerIsDAO()` or membership guard to ALL write functions
- **Realm:** Must deploy `memba_dao_channels_v3` after fix

### P0-02: Channels Template — assertIsMember is No-Op
- **File:** `frontend/src/lib/channelTemplate.ts:562-567`
- **Impact:** Generated realm code has TODO stub for membership check
- **Fix:** Implement cross-realm `IsMember()` call to parent DAO

### P0-03: Channels Template — Broken Rate Limiter
- **File:** `frontend/src/lib/channelTemplate.ts:575-582`
- **Impact:** Rate limiter reads `int64(0)` instead of `runtime.ChainHeight()`
- **Fix:** Replace `current := int64(0)` with `current := runtime.ChainHeight()`

### P0-04: Channels — Sybil Flag Attack
- **File:** `contracts/memba_channels_stub/channels.gno:290-320`
- **Impact:** 3 fresh wallets can auto-hide any thread (no membership check on FlagThread)
- **Fix:** Require DAO membership for flagging

### P0-05: Channels — XSS via Markdown Links
- **File:** `frontend/src/plugins/board/boardHelpers.tsx:31-34`
- **Impact:** `[text](javascript:alert(1))` rendered as clickable link
- **Fix:** Add protocol whitelist (http/https only) to renderMarkdown link handling

### P0-06: Channels — Realm Code Injection via Channel Names
- **File:** `frontend/src/lib/channelTemplate.ts:131`
- **Impact:** Channel name with `"` or `\` injects arbitrary Go code during generation
- **Fix:** Sanitize channel names through `isValidChannelName` before template interpolation

### P0-07: Candidature Realm — Zero ACL on MarkApproved/MarkRejected
- **File:** `contracts/memba_candidature_stub/candidature.gno:148,162`
- **Impact:** Any caller can approve/reject applications bypassing governance
- **Fix:** Check `runtime.PreviousRealm().Address() == daoRealmAddress`
- **Note:** v2 deployed on test12 — verify if v2 has this fix

### P0-08: Multisig — Incorrect Broadcast TX Format
- **File:** `frontend/src/pages/TransactionView.tsx:382-415`
- **Impact:** `buildBroadcastTx` joins signatures with commas; Gno requires `CompactBitArray` + ordered sigs
- **Fix:** Implement proper `MultiSignature` construction with pubkey-indexed ordering

### P0-09: Multisig — No Signature-to-Pubkey-Index Mapping
- **File:** `frontend/src/pages/TransactionView.tsx:394-397` + `backend/tx_rpc.go:305`
- **Impact:** Signatures stored by address, not pubkey index; broadcast ordering is wrong
- **Fix:** Store signer's pubkey index alongside signature in DB; map before broadcast

### P0-10: NFT Marketplace — NFT Never Transferred in BuyNFT
- **File:** `frontend/src/lib/nftMarketplaceTemplate.ts:202-205`
- **Impact:** Buyer pays, seller gets funds, but NFT stays with seller
- **Fix:** Add cross-realm `TransferFrom(seller, buyer, tokenId)` after fund distribution

### P0-11: NFT Marketplace — ListForSaleModal is Dead Code
- **File:** `frontend/src/components/nft/ListForSaleModal.tsx`
- **Impact:** Component exists but is never mounted — users cannot list NFTs for sale
- **Fix:** Add "List for Sale" button to NFTCollectionView for owned tokens

### P0-12: Token Launchpad — BigInt Crash at Render Time
- **File:** `frontend/src/pages/CreateToken.tsx:59`
- **Impact:** `BigInt(initialMint.trim())` crashes on malformed paste input
- **Fix:** Wrap in try/catch at component level

### P0-13: Agent Registry — UseCredit Has No Access Control
- **File:** `frontend/src/lib/agentTemplate.ts:302`
- **Impact:** Any address can drain another user's agent credits
- **Fix:** Restrict to agent creator or designated operator address

### P0-14: Auth — Address-Only Path Has No Signature Verification
- **File:** `backend/internal/service/crypto.go:220-233`
- **Impact:** Anyone can claim any wallet address without proof of key ownership
- **Fix:** Remove or gate the address-only auth path; require signature verification

---

## PART 3 — GNO ECOSYSTEM BREAKING CHANGES

From the ecosystem audit (gno core, multisigs, gnomonitoring):

| # | Change | Impact | Action Required |
|---|--------|--------|-----------------|
| 1 | **Simulate() now uses immutable snapshots** (PR #5431) | HIGH — ConnectRPC users won't see mempool-pending state | Verify Memba doesn't depend on pending state in simulations |
| 2 | **Go 1.24 → 1.25.0** (PR #5441) | MEDIUM — Backend must update | Update Go backend + golangci-lint v2.11 |
| 3 | **WebSocket CORS validation** (PR #5258) | MEDIUM — May block WS connections | Ensure frontend origin in allowed list |
| 4 | **Storage deposit refund logic** (PR #5198) | HIGH — Deposit calculations may differ | Review client-side deposit calculators |
| 5 | **GnoVM stack overflow prevention** (PR #5439) | MEDIUM — Error handling behavior changes | Test realm interactions post-merge |
| 6 | **Transaction sponsorship (PayGas/PayStorage)** (PR #5382) | HIGH — Major UX opportunity | Monitor for stable implementation |

---

## PART 3.5 — DUAL CTO REVIEW FINDINGS (v2 additions)

### CTO #1 (Security/Blockchain — ConsenSys/Cosmos background)
- Verified all 14 P0s against source code — **all confirmed real**
- **Day 0 Spike required:** Multisig broadcast format + cross-realm NFT TransferFrom are research unknowns
- **Template security is systemic:** Create shared `sanitizeForGoTemplate()` for ALL 8 template generators
- **Batch realm deployments** into single window (not 3-4 separate deploys)
- **Already-deployed user channel realms remain vulnerable** — need migration communication
- **Missing:** `EditThread`/`DeleteThread` ACL, NFT Approve() two-TX flow, realm versioning strategy
- **Timeline adjustment:** 28 → 28-33 days if review gates not timeboxed

### CTO #2 (Shipping/DevOps — Uniswap/Safe background)
- **Parallelize into 2-3 tracks** (saves 8-10 days): Track A security, Track B functional, Track C quality
- **Cut review gates from 14 to 3** (batch at phase boundaries, 24h SLA)
- **Reorder P0s by exposure risk:** ungated live features first, gated features last
- **Create error module in Phase 0** (30min, prevents rework in all P1 fixes)
- **Add Gno realm tests to CI immediately** — biggest testing gap
- **CI gaps:** No coverage enforcement, no bundle size budget, no Gno tests in pipeline
- **14-day minimum viable V5:** All P0s + 15-20 top security/correctness P1s

### Consensus Changes Applied to Plan (v2)
1. Added Day 0 Spike before Phase 0
2. Restructured into parallel tracks
3. Reduced review gates to 3 (Phase 0 end, Phase 1 end, Release)
4. Reordered P0s by exposure risk
5. Moved error module creation to Day 0
6. Added systemic template sanitizer requirement
7. Replaced Phase 3 P3 polish with observability + accessibility
8. Added Gno realm CI testing requirement
9. Batch all realm deployments into single window

---

## PART 4 — IMPLEMENTATION PLAN (v2 — post CTO review)

### Day 0: Research Spike + Foundation (while chain is halted)
**Goal:** Resolve unknowns, establish patterns. Chain not needed.

- [ ] **Spike A:** Research Gno's multisig broadcast format (CompactBitArray, MultiSignature proto). Document the exact bytes expected. Test against a local gno node if possible.
- [ ] **Spike B:** Research cross-realm `TransferFrom` mechanics for NFT marketplace. Document the Approve() → TransferFrom() two-TX flow and UX implications.
- [ ] **Foundation:** Create `frontend/src/lib/errors.ts` — unified error module replacing `errorMessages.ts` + `errorMap.ts`. Define pattern: Result types for chain queries, ErrorToast for user-facing, structured logging for backend.
- [ ] **Foundation:** Create `frontend/src/lib/templates/sanitizer.ts` — shared `sanitizeForGoTemplate(input)` utility. Escapes `"`, `\`, backticks, `${}`, newlines, Go keywords. Add lint test that greps all template files for raw `${` interpolation of user input.
- [ ] **Foundation:** Create `realm-versions.json` — mapping of which realm version is deployed per network (test12, gnoland1, etc.)
- [ ] **CI:** Add `gno test ./contracts/...` to CI pipeline
- [ ] **CI:** Add coverage thresholds (Go: 70%, Vitest: 70%)

### Phase 0: Critical Security Fixes (Days 1-3)
**Goal:** Fix all P0 issues. Nothing ships until these are resolved.
**Structure:** Two parallel tracks.

#### Track A: On-Chain Security (Realms) — P0-01 through P0-07

**Priority order by exposure risk:**

**Step A.1: Channels Realm ACL (P0-01 through P0-06) — HIGHEST PRIORITY (live, ungated)**
- [ ] Fix `channels.gno`: Add `assertIsMember()` to PostThread, PostReply, FlagThread
- [ ] Fix `channels.gno`: Add `assertCallerIsDAO()` to CreateChannel, RemoveThread, EditThread, DeleteThread
- [ ] Fix `channels.gno`: Add `assertIsMember()` to PostThread, PostReply, FlagThread
- [ ] Fix `channels.gno`: Add `assertCallerIsDAO()` to CreateChannel, RemoveThread
- [ ] Fix `channelTemplate.ts`: Implement `assertIsMember` with cross-realm call (use Day 0 sanitizer)
- [ ] Fix `channelTemplate.ts`: Replace `int64(0)` with `runtime.ChainHeight()` in rate limiter
- [ ] Fix `channelTemplate.ts`: Use `sanitizeForGoTemplate()` for channel name interpolation
- [ ] Write Gno tests for ALL write functions (PostThread, PostReply, CreateChannel, RemoveThread, EditThread, DeleteThread, FlagThread)
- [ ] Draft migration notice for DAOs with already-deployed v1/v2 channel realms (data on old realm will be orphaned)

**Step A.2: Candidature Realm ACL (P0-07) — HIGH PRIORITY (live, ungated)**
- [ ] Verify if `memba_dao_candidature_v2` already has the fix (check deployed code on test12)
- [ ] If not: Fix `candidature.gno` MarkApproved/MarkRejected with `runtime.PreviousRealm()` check
- [ ] Write Gno tests for authorization (positive + negative cases)

**Step A.3: XSS Fixes (P0-05 + related)**
- [ ] Fix `boardHelpers.tsx:31-34`: Add protocol whitelist to renderMarkdown (http/https only)
- [ ] Add DOMPurify to ALL `dangerouslySetInnerHTML` usages: `NFTGallery.tsx`, `SourceCodeView.tsx`, `RealmDetailDrawer.tsx`

**Step A.4: Batch Realm Deployment (after chain comes back)**
- [ ] Deploy ALL fixed realms in a single session (channels_v3, candidature_v3 if needed)
- [ ] Update `realm-versions.json`
- [ ] Update ALL frontend realm path references
- [ ] Run smoke test: verify ACL rejects unauthorized callers on-chain

#### Track B: Frontend & Backend Security (parallel with Track A)

**Step B.1: Auth Bypass (P0-14) — CRITICAL (affects everything)**
- [ ] Remove or gate address-only auth path in `crypto.go:220-233`
- [ ] Add structured logging for any remaining fallback auth usage
- [ ] Add negative test in `crypto_test.go`: assert address-only path is rejected

**Step B.2: Multisig Broadcast (P0-08, P0-09) — using Day 0 spike research**
- [ ] Implement proper `MultiSignature` construction with `CompactBitArray` in `buildBroadcastTx`
- [ ] Add pubkey index storage in `tx_rpc.go` database schema (migration)
- [ ] Map signatures to pubkey indices before broadcast
- [ ] Add backend signature verification in `SignTransaction`
- [ ] Write unit tests for broadcast format
- [ ] Write E2E test for full sign+broadcast flow

**Step B.3: Template Security (P0-06, P0-12, P0-13)**
- [ ] Apply `sanitizeForGoTemplate()` to ALL 8 template generators
- [ ] Wrap `BigInt()` in try/catch in `CreateToken.tsx:59` and `:78`
- [ ] Add ACL to `UseCredit` in `agentTemplate.ts` (restrict to agent creator/operator)
- [ ] Fix `RefundCredits` state-before-send violation in `agentTemplate.ts:357-377`
- [ ] Add adversarial input tests for all template generators (quotes, backslashes, newlines, Go keywords)

**Step B.4: NFT Marketplace (P0-10, P0-11) — LOWER PRIORITY (feature-gated)**
- [ ] Add `TransferFrom(seller, buyer, tokenId)` to BuyNFT in `nftMarketplaceTemplate.ts`
- [ ] Document the Approve() → TransferFrom() two-TX flow for UX
- [ ] Mount ListForSaleModal in NFTCollectionView with "List for Sale" button
- [ ] Add `AcceptOffer` function to marketplace template
- [ ] Write unit tests for BuyNFT flow

#### Phase 0 Completion Gate (24h review window, auto-proceed if no P0 regressions)
- [ ] All P0 tests passing (including new Gno realm tests)
- [ ] All realm deployments verified on test12
- [ ] Frontend pointed to v3 realm paths
- [ ] Template sanitizer applied to all generators
- [ ] Full regression test suite green
- [ ] **REVIEW:** CTO + CSO signoff (24h SLA)

---

### Phase 1: High-Priority Fixes (Sprint 2 — Days 4-10)
**Goal:** Fix P1 issues grouped by feature area.

#### Step 1.1: Multisig P1s (7 issues)
- [ ] Fix fragile paste-input logic (`CreateMultisig.tsx:247`) — use dedicated `showManualInput` boolean
- [ ] Refactor pubkey fetch to use `resilientFetch` POST (`CreateMultisig.tsx:63`)
- [ ] Wrap `BigInt()` in try/catch (`ProposeTransaction.tsx:135`)
- [ ] Add server-side signature verification in `SignTransaction` (`tx_rpc.go`)
- [ ] Add on-chain hash verification in `CompleteTransaction` (`tx_rpc.go`)
- [ ] Hide "Sign" button for already-signed users (`TransactionView.tsx`)
- [ ] Switch broadcast from GET to POST (`TransactionView.tsx:257`)
- [ ] **REVIEW GATE:** Crypto + Wallet UX review
- [ ] **CHANGELOG + DOCS UPDATE**

#### Step 1.2: Token Launchpad P1s (10 issues)
- [ ] Use `formatTokenAmount()` for all balance/supply displays
- [ ] Add human-readable amount preview next to inputs
- [ ] Unify address validation with centralized `sanitizer.ts`
- [ ] Surface balance fetch errors (not silent "0")
- [ ] Add version detection for fragile Render() regex parsing
- [ ] Add faucet rate-limit feedback in UI
- [ ] Verify on-chain fee enforcement (vendor tokenfactory realm code)
- [ ] Add minimum amount validation (> 0) for mint/transfer/burn
- [ ] Add duplicate symbol pre-check before submission
- [ ] **REVIEW GATE:** DeFi + Token Standard review
- [ ] **CHANGELOG + DOCS UPDATE**

#### Step 1.3: NFT Marketplace P1s (11 issues)
- [ ] Fix XSS via `dangerouslySetInnerHTML` — use DOMPurify
- [ ] Fix realm path construction (use registered namespace, not raw address)
- [ ] Add two-step flow rollback tracking in ListForSaleModal
- [ ] Implement royalty enforcement or remove dead code
- [ ] Build "My NFTs" portfolio view
- [ ] Remove duplicate/stale msg builders from `grc721.ts`
- [ ] Fix `isOwnListing` to use exact address comparison
- [ ] Sync escrow template with deployed contract's hardened logic
- [ ] Standardize import paths across templates
- [ ] Add wallet connect prompt for unauthenticated actions
- [ ] **REVIEW GATE:** NFT Expert panel review
- [ ] **CHANGELOG + DOCS UPDATE**

#### Step 1.4: Quest System P1s (5 issues)
- [ ] Fix `verifyDeployment` to check deployer ownership (not just realm existence)
- [ ] Fix `getCompletionPercent()` denominator (85 unique quests, not 95)
- [ ] Fix QuestProgress widget to use total visible quests (not v1 QUESTS.length)
- [ ] Fix leaderboard query: use `p.username` not `p.bio`
- [ ] Fix candidature realm `MarkApproved`/`MarkRejected` caller auth (if not already in P0)
- [ ] **REVIEW GATE:** Gamification + Community review
- [ ] **CHANGELOG + DOCS UPDATE**

#### Step 1.5: DAO Governance P1s (7 issues)
- [ ] Add proposal expiration/TTL mechanism (configurable, default 7 days in blocks)
- [ ] Add configurable voting period to generated DAOs
- [ ] Pass DAO name to `addSavedDAO()` after creation
- [ ] Fix candidature success copy ("66% governance vote" not "two members")
- [ ] Connect candidature approval to DAO membership (cross-realm hook)
- [ ] Replace `setTimeout` redirect with "Go to DAO" button
- [ ] Add "Join this DAO" CTA when `isMember === false`
- [ ] **REVIEW GATE:** DAO Governance Expert panel
- [ ] **CHANGELOG + DOCS UPDATE**

#### Step 1.6: Validators P1s (4 issues)
- [ ] Fix ValidatorDetail race condition — pass `allValidators` to `getNetworkStats()`
- [ ] Add fallback for numeric vote types in consensus state parsing
- [ ] Fix bitmask count to parse only bit portion after colon
- [ ] Fix false clipboard copy success indicator
- [ ] **REVIEW GATE:** Blockchain Infra + SRE review
- [ ] **CHANGELOG + DOCS UPDATE**

#### Step 1.7: AI Analyst + Alerts P1s (6 issues)
- [ ] Add copy/download report buttons (stated spec, not implemented)
- [ ] Document and mitigate OpenRouter merged-prompt injection weakness
- [ ] Fix WebhookSection infinite loading on fetch failure
- [ ] Fix ReportScheduleForm stale state (useEffect sync)
- [ ] Fix AlertContactForm webhook ID default
- [ ] Create shared HTTP client with connection pool tuning
- [ ] **REVIEW GATE:** LLM Security + DevOps review
- [ ] **CHANGELOG + DOCS UPDATE**

#### Step 1.8: Channels & Plugins P1s (8 issues)
- [ ] Enable admin posting in announcement channels
- [ ] Build Edit/Delete thread UI using existing realm functions
- [ ] Fix FlagButton message type (`vm/MsgCall`)
- [ ] Update DeployPluginModal to use `channelTemplate` (v2)
- [ ] Fix PiP drag direction inversion
- [ ] Add length check before `string(t.Author)[:10]` in generated code
- [ ] Add `UnhideThread` admin function to realm
- [ ] Implement WriteRoles enforcement in `assertChannelWritable`
- [ ] **REVIEW GATE:** Real-time Comms + T&S review
- [ ] **CHANGELOG + DOCS UPDATE**

#### Step 1.9: Gnolove & Directory P1s (9 issues)
- [ ] Add 300ms debounce to `handleGlobalSearch` for RPC queries
- [ ] Scope directory cache keys by network
- [ ] Fix hardcoded "gnoland1" in RealmDetailDrawer and TokenDetailDrawer
- [ ] Deduplicate `useGnoloveRepoActivity`/`useGnoloveMonthlyActivity` API calls
- [ ] Extend `VALID_PATH_RE` to allow hyphens in realm paths
- [ ] Add error+retry state to GnoloveHome
- [ ] Sync Gno tokenizer keyword lists between the two implementations
- [ ] Add unit tests for `parseSourceHtml` and related parsers
- [ ] Validate realm path format before RPC calls in search handler
- [ ] **REVIEW GATE:** Search/Discovery + DevX review
- [ ] **CHANGELOG + DOCS UPDATE**

#### Step 1.10: Profiles, Auth & Infra P1s (8 issues)
- [ ] Add OffscreenCanvas fallback for Safari < 16.4
- [ ] Fix `UpdateServiceListing` Active field overwrite (use field mask)
- [ ] Fix escrow `CancelContract` refund logic (track funded status separately)
- [ ] Fix `RefundCredits` state-before-send violation
- [ ] Proxy IPFS uploads through backend (don't expose Lighthouse key)
- [ ] Remove GitHub access token from OAuth exchange response
- [ ] Fix no-API-key avatar fallback (warn user, don't silently fail)
- [ ] Add monitoring for address-only auth usage
- [ ] **REVIEW GATE:** Identity/Auth + IPFS Expert review
- [ ] **CHANGELOG + DOCS UPDATE**

#### Step 1.11: Phase 1 Completion Gate
- [ ] All P1 tests passing
- [ ] Full regression suite green (target: 1,800+ tests after additions)
- [ ] E2E test suite expanded for critical flows
- [ ] **CROSS-PERSPECTIVE REVIEW:** Full CTO + PO + CSO signoff
- [ ] Version bump to v5.0.0-alpha
- [ ] **FULL CHANGELOG UPDATE**

---

### Phase 2: Quality & Performance (Sprint 3 — Days 11-18)
**Goal:** Address P2 issues by category.

#### Step 2.1: Security Hardening (P2 security items across all features)
- [ ] Add DOMPurify defense-in-depth to all `dangerouslySetInnerHTML` usages
- [ ] Add server-side webhook URL pattern validation (Discord/Slack only)
- [ ] Require auth for `force=1` cache bypass on AI analyst
- [ ] Add rate limiting on Sign/Complete Transaction endpoints
- [ ] Remove plain HTTP RPC fallback in gnoland1 config
- [ ] URL-encode `excludeLogins` in gnolove API query params
- [ ] Validate `qeval` expression inputs against Gno address format
- [ ] **REVIEW GATE:** CSO review

#### Step 2.2: Performance Optimization
- [ ] Memoize incidents chart data in Validators page
- [ ] Add chunking to `fetchLastBlockSignatures` (match heatmap pattern)
- [ ] Batch DAO proposal enrichment with `Promise.allSettled`
- [ ] Add pagination for token dashboard (lazy load metadata)
- [ ] Add abort controllers to all async fetches
- [ ] Fix moniker merge priority (valopers > monitoring)
- [ ] **REVIEW GATE:** FSE performance review

#### Step 2.3: Mobile Responsiveness Pass
- [ ] Extract inline styles to CSS across: CreateMultisig, ProposeTransaction, CreateToken, ProposalView, ProposeDAO
- [ ] Add responsive breakpoints for vote buttons, filter bars, chart margins
- [ ] Fix PiP sizing on mobile (160x90)
- [ ] Fix RegisterUsernameForm fixed width overflow
- [ ] Increase touch targets to 44px minimum on all interactive elements
- [ ] **REVIEW GATE:** Mobile UX + Product Tester review

#### Step 2.4: Error Handling & Resilience
- [ ] Consolidate `errorMessages.ts` and `errorMap.ts` into single module
- [ ] Route Treasury/Notification polling through `resilientAbciQuery`
- [ ] Add error states to Directory tab components
- [ ] Add retry buttons to Hacker/Detail page failures
- [ ] Add "connection lost" indicator for channel polling
- [ ] Fix silent balance fetch errors (show "stale" indicator)
- [ ] **REVIEW GATE:** FSE resilience review

#### Step 2.5: Test Coverage Expansion
- [ ] Add realm tests: candidature Apply/Withdraw/MarkApproved lifecycle
- [ ] Add realm tests: channels ACL, flag sybil scenario
- [ ] Add frontend tests: `parseSourceHtml`, `computeRange`, `aggregateConsensus`
- [ ] Add E2E tests: multisig sign+broadcast, DAO create->propose->vote->execute
- [ ] Consolidate two Gno tokenizers into single shared module
- [ ] Target: 2,000+ total tests
- [ ] **REVIEW GATE:** QA review

#### Step 2.6: Ecosystem Compatibility
- [ ] Update Go backend to 1.25.0
- [ ] Test Simulate() behavior with immutable snapshots
- [ ] Configure WebSocket CORS for frontend origins
- [ ] Review storage deposit calculations against new refund logic
- [ ] **REVIEW GATE:** Gno Core Engineer review

#### Step 2.7: Phase 2 Completion Gate
- [ ] All P2 items addressed
- [ ] Full regression suite green (target: 2,000+ tests)
- [ ] Mobile testing on 320px, 375px, 768px, 1024px viewports
- [ ] Performance benchmarks: < 3s initial load, < 500ms navigation
- [ ] **CROSS-PERSPECTIVE REVIEW:** Full team signoff
- [ ] Version bump to v5.0.0-beta
- [ ] **FULL CHANGELOG + DOCS UPDATE**

---

### Phase 3: Observability, Accessibility & High-Value P3s (Sprint 4 — Days 19-25)
**Goal:** Add missing production-readiness layers (per CTO review). Cherry-pick highest-value P3s.

#### Step 3.1: Observability (CTO recommendation — replaces P3 polish)
- [ ] Add structured JSON logging to all Go RPC handlers (request ID, wallet hash, latency, error codes)
- [ ] Add `/healthz` endpoint: DB connectivity, RPC node reachability, last block height
- [ ] Add Web Vitals reporting to Sentry (LCP, FID, CLS per page)
- [ ] Add `npm audit` and `govulncheck` to CI pipeline
- [ ] Add bundle size budget enforcement (< 200KB gzip main chunk)
- [ ] Add realm deployment smoke test script (automated post-deploy verification)
- [ ] Add alert on auth anomalies (address-only fallback, if any path remains)

#### Step 3.2: Accessibility (WCAG 2.1 AA — top 10 pages)
- [ ] Add `aria-label` and `role` attributes to: DAOHome, ProposalView, QuestHub, Directory, Validators, MultisigView, TokenDashboard, ProfilePage, ChannelsPage, Landing
- [ ] Add keyboard navigation (tab ordering, Enter to activate) across all interactive elements
- [ ] Ensure 44px minimum touch targets on all buttons
- [ ] Add skip-to-content link verification
- [ ] Run axe-core audit on top 10 pages, fix all critical/serious violations

#### Step 3.3: High-Value P3s (if time permits)
- [ ] Add proposal templates (Problem/Solution/Budget for treasury)
- [ ] Add confirm dialog before destructive actions (burn, delist, remove)
- [ ] Add campaign/partner quest support framework
- [ ] Add E2E tests for Firefox + WebKit browsers

#### Phase 3 Completion Gate (24h review)
- [ ] Observability + accessibility shipped
- [ ] axe-core audit passing on top 10 pages
- [ ] Version bump to v5.0.0-rc1
- [ ] **FULL CHANGELOG + DOCS UPDATE**

---

### Phase 4: Release (Sprint 5 — Days 26-28)
- [ ] Final regression pass
- [ ] Security audit summary document
- [ ] Deployment report update
- [ ] Version bump to v5.0.0
- [ ] PR to main
- [ ] **FINAL CTO REVIEW** (below)

---

## PART 5 — CTO EXPERT REVIEW

### Architecture Assessment

**Overall Grade: B+** (Strong foundation, critical security gaps, excellent feature breadth)

**Strengths:**
1. **Clean separation of concerns** — Frontend (React/Vite) <-> Backend (Go/ConnectRPC) <-> Chain (Gno realms) boundaries are well-defined
2. **Defensive coding patterns** — Zod validation at boundaries, SSRF guards, formula injection protection, RPC domain allowlisting
3. **Feature comprehensiveness** — 54 pages, 120+ components, 5 plugins covering governance, tokens, NFTs, analytics, communication
4. **Test culture** — 1,693+ tests across unit, integration, and E2E layers
5. **Progressive enhancement** — Feature flags, graceful degradation, offline resilience

**Critical Gaps (AAA SWE Standard Violations):**

1. **On-chain ACL enforcement is fundamentally broken** — Channels realm has ZERO access control. This violates the principle of defense-in-depth. Frontend-only ACL is never acceptable for a multi-user system. **Must fix before any production deployment.**

2. **Multisig broadcast format is incorrect** — The core value proposition of a multisig wallet is... signing and broadcasting. If `buildBroadcastTx` produces invalid output, the feature is non-functional. **This should have been caught by integration tests.**

3. **Address-only auth bypass** — Allowing wallet impersonation without signature verification defeats the purpose of challenge-response auth. **Immediate removal required.**

4. **Template code generation lacks security review** — Channel names, token names, and realm paths are interpolated into Go source code templates without adequate sanitization. This is a code injection vector. **All template generators need a security audit pass.**

5. **Inconsistent error handling** — Some functions throw, some return null, some silently swallow errors. The lack of a unified error strategy means users see "0 balance" when the RPC is down instead of "error loading balance." **Standardize error propagation patterns.**

### AAA SWE Compliance Checklist

| Criterion | Status | Notes |
|-----------|--------|-------|
| Security: No critical vulnerabilities | **FAIL** | 14 P0s, including zero-ACL realms and auth bypass |
| Security: Defense-in-depth | **FAIL** | Frontend-only ACL on channels, client-side fee enforcement |
| Testing: Critical paths covered | **PARTIAL** | Good unit tests, weak E2E and realm tests |
| Testing: > 80% code coverage | **UNKNOWN** | No coverage metrics configured |
| Performance: < 3s initial load | **PASS** | 496KB main bundle (143KB gzip) |
| Performance: No N+1 queries | **FAIL** | Token dashboard, DAO enrichment, treasury tokens |
| Accessibility: WCAG 2.1 AA | **FAIL** | No aria-labels, keyboard navigation incomplete |
| Mobile: Responsive on 320px+ | **PARTIAL** | Many pages use inline styles without breakpoints |
| Error handling: Graceful degradation | **PARTIAL** | Some features silently swallow errors |
| Documentation: API documented | **PARTIAL** | No OpenAPI/protobuf docs generated |
| Observability: Structured logging | **PARTIAL** | Sentry integration exists but no metrics |
| CI/CD: Automated quality gates | **PARTIAL** | Tests run but no coverage enforcement |

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Channel spam attack | HIGH | HIGH | P0 ACL fix (Phase 0) |
| Multisig funds loss via bad broadcast | HIGH | CRITICAL | P0 broadcast fix (Phase 0) |
| Wallet impersonation | MEDIUM | HIGH | P0 auth fix (Phase 0) |
| NFT marketplace fund loss | LOW (feature-gated) | HIGH | P0 TransferFrom fix (Phase 0) |
| Gno ecosystem breaking changes | MEDIUM | MEDIUM | Go 1.25 + Simulate() testing (Phase 2) |
| test12 chain reset | MEDIUM | MEDIUM | Realm redeployment playbook exists |

### Final CTO Recommendation

**Ship Phase 0 (P0 fixes) immediately.** The 14 critical issues represent real security vulnerabilities that would be exploitable on testnet. The channels realm ACL gap is the highest priority — it's deployed and unprotected right now.

**Phase 1 (P1 fixes) should be completed before any public beta.** The 75 high-priority issues include broken core functionality (multisig broadcast) and significant UX gaps (no proposal expiration, silent errors).

**Phases 2-3 (P2/P3) are quality investments** that bring the product to AAA standards. The mobile responsiveness pass and test coverage expansion are the highest-ROI items.

**Estimated timeline (v2 — parallelized per CTO #2 recommendation):**
- Day 0: 1 day (research spike + foundation)
- Phase 0: 3-4 days (critical security, 2 parallel tracks)
- Phase 1: 7-8 days (functional completeness, 2 parallel tracks)
- Phase 2: 6-7 days (quality & performance, parallelized)
- Phase 3: 5-6 days (observability + accessibility, replaces P3 polish)
- Phase 4: 2-3 days (release)
- **Total: ~25-29 days to v5.0.0**
- **Minimum Viable V5 (14-day path):** All P0s + 15-20 top security/correctness P1s, skip mobile/performance/polish

The architecture is sound. The feature set is ambitious and well-executed. The issues found are fixable — most are missing guards, incomplete implementations, or consistency gaps. With the P0s resolved, Memba is one of the most comprehensive DAO governance platforms in the Gno ecosystem.

---

## APPENDIX A — Expert Panel Roster

Each feature was reviewed by 18-21 experts:

**Core Team (present on all panels):**
- CTO, UI Expert, UX Expert, Product Owner
- Gno Core Engineers (x3), Smart Contract Experts (x2)
- QA Tester, CSO, Full-Stack Engineers (x3), Product Testers (x3)

**Domain Experts (per feature):**
- Multisig: Cryptography, Wallet UX, Security Auditor
- DAO: DAO Governance, Token Governance, Community Manager
- Token: DeFi, Token Standard, Regulatory
- NFT: NFT Marketplace, Creator, Collector, Trader
- Validators: DevOps/SRE, Blockchain Infra, Data Visualization
- Quests: Gamification, Community Growth, Web3 Quest Platform
- AI/Alerts: AI/ML, LLM Security, DevOps Monitoring
- Channels: Real-time Comms, Trust & Safety, Plugin Architecture
- Gnolove/Directory: Data Analytics, Search/Discovery, Developer Experience
- Profiles/Auth/Infra: Identity/Auth, IPFS/Storage, Marketplace

**Total: 200+ unique expert perspectives**

---

## APPENDIX B — Gno Ecosystem Changes Reference

| Repo | Recent Changes | Impact on Memba |
|------|---------------|-----------------|
| `gno` (core) | halt_height, gnobr, version cmd, Simulate() change, Go 1.25 | Backend update required |
| `multisigs` | verify-documents CI, pr-comment CI, blog moderators | Low — external tooling |
| `gnomonitoring` | chain-id info branch, Memba admin panel | Low — monitoring API |
| `gno-skills` | weekly report skill, HackenProof workflow | Low — docs/process |

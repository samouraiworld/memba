# Memba test13 Go-Live Audit — Single Source of Truth

_Multi-expert panel (Gno.land realm security · CTO/auth-crypto · fullstack · tests · docs/UX · deploy/infra), each high/critical finding adversarially verified. 18 agents. Run 2026-06-16._

**Verdict: GO-WITH-FIXES** (2 must-fix items, both env/config changes on the cutover checklist)

**Rationale:** The frozen-scope realm code (memba_dao, candidature_v2, channels_v2, agent_registry) is genuinely deploy-ready — ACL guards, refund CEI ordering, and DoS caps are real and verified; the only "high" realm finding (ChangeDAOImplementation) was adversarially confirmed as intended single-founder governance with no exploitable condition at launch. The backend crypto primitives are exemplary (real-signature golden-vector tests). The blockers are **operational, not structural**: (1) the auth layer ships with proof-of-ownership **disabled by default** (`MEMBA_ALLOW_UNSIGNED_AUTH`) — any address, incl. the quest-admin, can be impersonated with an empty signature; and (2) backend `GNO_CHAIN_ID` is still `test12`, so flipping the frontend default without updating it in lockstep breaks every authenticated RPC. Both are env-var fixes applied in the same deploy that flips the default.

## MUST-FIX BEFORE GO-LIVE (cutover gates)

| Sev | Area | Title | File:line | Fix |
|-----|------|-------|-----------|-----|
| **CRITICAL** | auth / token issuance | Default config mints auth tokens with no proof of key ownership — full member + quest-admin impersonation | `backend/internal/auth/crypto.go:220-227,372-410`; `quest_rpc.go:606-608` | Set `MEMBA_ALLOW_UNSIGNED_AUTH=0`. **PRECONDITION: confirm a transacted wallet gets `result=signed` on the target chain FIRST**, else legit users lock out. Fresh test13 → enforce from day one. |
| **HIGH** | chain binding (cutover) | Backend `GNO_CHAIN_ID` still `test12` — authed RPCs break at cutover | `backend/fly.toml:25`; `crypto.go:485-490`; `service.go:69` | In the **same deploy** that flips the frontend default: backend `GNO_CHAIN_ID='test-13'` (hyphen, on-wire value, NOT `test13`) + `GNO_RPC_URL` → test13 node. |

## STRONGLY RECOMMENDED AT GO-LIVE (low-effort, high-leverage)

| Sev | Area | Title | File:line | Fix |
|-----|------|-------|-----------|-----|
| MED | auth / multisig | Multisig sig verification log-only by default (chain re-verifies on broadcast → off-chain confusion only) | `multisig_verify.go:24-34`; `tx_rpc.go:321-340,388-402` | `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` (golden-vector tested). |
| MED | docs / runbook | Go-live note deploy commands had args reversed | `docs/planning/TEST13_GO_LIVE_NOTE.md` | **FIXED** → `samcrew-deploy.sh test13 gnodaokit` / `... test13 memba`. |
| LOW* | deploy / gnodaokit | Local gnodaokit on `main` (unsuffixed) — guard blocks deploy until switched | `projects/gnodaokit/deploy.sh:67-75` | `git -C gnodaokit checkout test12-deploy`; confirm green `/v0` guard line. (Fail-safe; checklist step.) |
| MED | frontend / broadcast | `doContractBroadcast` doesn't check wallet chainId == app network | `grc20.ts:124-194` | Blocking chainId-equality guard before `adena.DoContract`. |
| MED | frontend / UX | ChainMismatchBanner looks up wallet chainId as a NETWORKS **key** — breaks for test13 (key `test13` vs chainId `test-13`) | `TopBar.tsx:279,301` | Resolve chainId→key via `Object.keys(networks).find(k => networks[k].chainId === walletChainId)`. |
| MED | network config | Explorer host mismatch + unverified faucet/gas for test-13 | `networks.toml:42-44`; `config.ts:242` | `VITE_TEST13_EXPLORER_URL=https://test13.testnets.gno.land`; confirm faucet; dry-run one addpkg for gas. |
| MED | a11y | Auth-error + "transactions blocked" banners lack `role=alert`/`aria-live` | `TopBar.tsx:160-169,184-226` | Add `role="alert"`. |
| MED | docs | TEST13_V09_MIGRATION_PLAN contradicts go-live note (RPC + namespace) | `TEST13_V09_MIGRATION_PLAN.md` | Add "SUPERSEDED — see TEST13_GO_LIVE_NOTE" banner. |

\* Adversarially downgraded high→low (working guard); keep on checklist.

## POST-GO-LIVE FOLLOW-UPS

- **tests/CI:** memba_dao ACL tests non-gating/unrunnable in standard CI — run once with staged gnodaokit test12-deploy workspace; wire a GATED job medium-term. (`test.yml:67`)
- **tests:** candidature_v2 funded-deposit refund path never executed (`Deposit` seeded 0); channels_v2 SyncMembers/PurgeNonMembers/TransferOwnership lack negative-auth tests.
- **tests/deploy:** add invariant test "DEFAULT_NETWORK's network has realmsDeployed !== false"; keep `config.test.ts` flip lockstep.
- **frontend:** `realmsDeployed` gates only the banner, not create-DAO/candidature/marketplace submit buttons (testnet-only, deposits revert atomically — no fund loss); test13 selector label lacks a "not deployed" hint; gnoweb/explorer links fall back to mainnet for test13.
- **auth:** nonce dedup is in-memory only (restart reopens 5-min replay window) — subsumed by enforcing auth; persist post-cutover.
- **deploy:** gnodaokit vs memba default DEPLOY_KEY differ — set explicitly both phases; `gno lint` gate silently skipped when `gno` absent — verify on PATH.
- **gnodaokit #13 (proposal description spoofing):** LOW at 1-member bootstrap — operationally verify the `## Resource` line; upstream sanitize Description.
- **gnodaokit dead path:** infinite recursion in `crossingDAO.Render` — not on any Memba call path; fix upstream.

## DROPPED (adversarially refuted — not go-live risks)

- **ChangeDAOImplementation arbitrary migration code** (orig HIGH) → info. Intended self-upgradeable governance, 66% members; no exploit at single-founder bootstrap. _Op note: raise the upgrade threshold/timelock before adding any non-founder member._
- **gnolove #124 (MsgRun govdao votes missed)** (orig HIGH) → low. Refuted: scanners read render/`votes` ABCI queries, not tx history; MsgRun can't cast votes on these realms. Name-only conflation.

## CLEAN SURFACES (no action)

Realm security (agent_registry/candidature_v2/channels_v2 ACLs/refunds/caps) · backend injection/authz/SSRF (parameterized SQL, all mutating RPCs authed, OAuth CSRF-protected) · backend auth/crypto test suite (real secp256k1 golden vectors) · network resolution + CSP + RPC trust (all 3 test13 endpoints covered, reads degrade to empty) · frozen-scope consistency (plan/deploy/manifest) · no secret/key leakage · wrong-chain/wrong-artifact safeguards (`--chainid` on every tx, hyphen `test-13` handled).

## Cutover one-liner (operator)
In the single go-live deploy: (1) `MEMBA_ALLOW_UNSIGNED_AUTH=0` _(after confirming `result=signed`)_, (2) `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1`, (3) backend `GNO_CHAIN_ID='test-13'` + test13 `GNO_RPC_URL`, (4) `git -C gnodaokit checkout test12-deploy`, (5) `samcrew-deploy.sh test13 gnodaokit && samcrew-deploy.sh test13 memba`, (6) smoke-verify all 4 realms render, (7) flip `realmsDeployed:true` + `config.test.ts` + Netlify `VITE_GNO_CHAIN_ID=test13` in one PR. Steps 1–3 are the gates.

# ADR — On-chain Quest/XP Attestation (Track A)

**Status:** ACCEPTED (prototype, test13) · **Date:** 2026-06-26 · **Owner:** CTO + Gno-core + security
**Context doc:** `docs/planning/QUESTS_AUDIT_AND_DELIVERY_PLAN_2026-06-26.md` (§14 decision #3, §17 validation)
**Issue:** Q-05 (quest XP is a centralized backend ledger; the chain holds no verifiable record)

## 1. Context

Memba quest XP lives only in the backend SQLite ledger. The chain is read to *prove an action happened* (namespace ownership, package existence, candidature render) but never *holds the score*. A compromised/malicious operator could insert completions, inflate XP, or unlock candidature with no on-chain trace. Strategic intent (CTO): **be on-chain as much as possible** — make XP/quest completion a durable, independently verifiable on-chain record while keeping the backend as the fast UX path.

## 2. Decision

Adopt an **offline-signed voucher** attestation model (Model B), prototyped on test13 in a new immutable realm `gno.land/r/samcrew/memba_quest_attestation_v1`.

- The backend holds an **offline** ed25519 signing key (the *attestation signer*). It signs vouchers; it is **never** a hot key that can broadcast arbitrary on-chain writes.
- A voucher = `(address, questId, xp, nonce)` + the signer's ed25519 signature over a canonical encoding.
- The **user broadcasts** their own attestation tx, calling `RecordCompletion(voucher)`. The realm verifies the signature with `crypto/ed25519.Verify`, rejects reused nonces (replay protection), then records the completion and updates the user's attested XP.
- Reads are public: `GetAttestedXP(address)`, `GetRecordedCompletions(address)`, plus `Render` for UI/debug.

### Why Model B over the alternatives

| Model | On-chain write authority | Custody blast radius | Feasible on Gno? | Verdict |
|---|---|---|---|---|
| **A. Relayer hot-key** | Backend key broadcasts writes | **High** — stolen key attests/forges anything | Yes | ❌ rejected for prototype (custody risk) |
| **B. Offline voucher** *(chosen)* | Backend key only *signs*; user broadcasts; realm verifies sig + nonce | **Low** — offline key, no broadcast power; forgery needs the private key | **Yes** — `crypto/ed25519.Verify` is whitelisted for realms | ✅ **chosen** |
| **C. Merkle-root anchor** | One key submits a periodic root | Low-Med; delayed attestation | Yes — `crypto/merkle.VerifySimpleProof` whitelisted | ⏭ **Phase 4** cost-optimization at mainnet scale |

**Feasibility evidence (resolved the validation conflict):** `crypto/ed25519.Verify(pub, msg, sig) bool` is exposed to realms — `gno/gnovm/stdlibs/generated.go:1266` (whitelist) and `gno/gnovm/stdlibs/native_gas.go:88` (gas-priced). `crypto/merkle.VerifySimpleProof` likewise (`gno/gnovm/stdlibs/crypto/merkle/merkle.gno:21`). The earlier assumption that "Gno can't verify signatures in-realm" was wrong.

## 3. Realm sketch (`memba_quest_attestation_v1`)

```
// ACL: owner (samcrew multisig at deploy) can rotate the signer pubkey.
func SetSigner(cur realm, pubkey []byte)              // owner-only
// User-broadcast, signature-verified writes:
func RecordCompletion(cur realm, address string, questId string, xp int, nonce string, sig []byte)
//   - assert !usedNonce[nonce]; msg = canonical(address,questId,xp,nonce)
//   - assert ed25519.Verify(signerPubkey, msg, sig); else panic
//   - record completion; attestedXP[address] += xp (idempotent on (address,questId))
// Public reads:
func GetAttestedXP(address string) int
func GetRecordedCompletions(address string) string    // csv questIds
func Render(path string) string                       // "" + "user/<addr>"
```

**Storage:** `avl.Tree` for `completions` (key `address:questId`), `attestedXP` (key `address`), `usedNonce` (key `nonce`). **Idempotent** on `(address, questId)` — re-recording is a no-op (no double XP). **ACL** via `std.PreviousRealm().Address()` for owner ops; interrealm-v2 `cur realm` crossing convention; immutable path (new `_vN` for any logic change).

## 4. Backend integration

- New migration `0NN_quest_attestation.sql`: `attestation_vouchers(address, quest_id, xp, nonce, sig, issued_at, status)`.
- On a **verified** grant in `CompleteQuest`/`SyncQuests`, also **issue a voucher** (offline-signer; best-effort, queued like badges) and expose it to the client (`GetUserQuests` returns claimable vouchers).
- The backend **never broadcasts**; it only signs + serves vouchers. Reconcile chain vs DB read-side for display.
- Metric `attestation_vouchers_issued_total`, `attestation_onchain_recorded_total` (read-derived).

## 5. Frontend integration

- `lib/questAttester.ts`: read `GetAttestedXP`/`GetRecordedCompletions` via ABCI render; build + submit the `RecordCompletion` tx via Adena (user signs/pays).
- QuestDetail/Leaderboard/Profile: show **"✓ on-chain"** state when a completion is attested; "Attest on-chain" CTA when a voucher is claimable.
- Candidature gate may read **attested XP OR** fall back to backend XP (degrade, never block).

## 6. Security conditions (binding — from §17 validation)

- Offline signer key in a **secrets manager** (Fly secrets / KMS), never plaintext in repo or app env; documented **rotation + emergency revocation** (`SetSigner`).
- Realm ships with **ported tests from day one** (signer-auth, nonce-replay reject, idempotence, render parity) — closes Q-20 for this realm.
- Nonce dedup with a documented policy (monotonic or random-with-store); voucher carries `xp` but the realm **clamps/validates** against a server-pinned quest→XP table if later hardened.
- **Merge gate (§16 Condition 4):** this realm + backend signer code require `/security-review` **and explicit user approval** — not autonomous merge.
- **Test13-only**; mainnet (Phase 4) re-evaluates Model C batching + external audit.

## 7. Consequences

**Positive:** verifiable on-chain XP record; minimal custody risk (offline key, user broadcasts); reuses proven badge-realm ACL patterns; clean Phase-4 path to Merkle batching. **Negative / trade-offs:** users pay gas to attest (acceptable on test13; UX nicety: optional auto-attest); attestation is eventually-consistent with the backend (display reconciles); a second write path to maintain.

## 8. Status / next

ADR accepted. Implementation lands after the safe Phase-1 polish batch: realm + tests → security review → **user-approved** merge → backend signer + frontend → test13 on-chain read verified → G1 gate.

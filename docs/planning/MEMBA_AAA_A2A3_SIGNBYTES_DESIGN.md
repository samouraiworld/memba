# Memba AAA — tm2 Canonical Sign-Bytes Helper (A2/A3 keystone) — Design

> **Status:** Approved design (2026-06-11). Implementation proceeds TDD, one PR per task.
> Branch: `feat/aaa-signbytes`. Supersedes nothing; consumed by A2 (auth) and A3 (multisig verify) in `MEMBA_AAA_IMPLEMENTATION_PLAN.md`.

## 1. Problem

Adena has **no ADR-036** — it signs only **tx-shaped** documents (`/vm.m_call`, `/bank.MsgSend`,
`/vm.m_addpkg`, `/vm.m_run`). Because of this, Memba's frontend currently sends `signature: ""`
on login (`Layout.tsx:101-103`) and the backend mints session tokens from empty signatures, gated
behind `MEMBA_ALLOW_UNSIGNED_AUTH` (default = allow, from PR #393). To enforce real signed auth
(A2) **and** verify multisig member signatures server-side at submission (A3), the backend needs a
Go helper that reproduces gno's **canonical transaction sign-bytes** and is proven **byte-equal**
against real `gnokey sign` output.

Without it, A2/A3 would either reject legitimate Adena signatures or verify attacker-controlled
bytes (a self-consistent `{doc, sig}` pair over a divergent doc would pass verification yet die at
broadcast — the exact failure class A3 exists to kill).

## 2. Decision (expert-audited)

An 8-lens expert audit (Manfred Touron, Jae Kwon, a Gno-core engineer, two senior fullstack
engineers, a CTO/supply-chain lens, an app-sec lens; + adversarial pass + CTO synthesis) selected
**Option A — a self-contained pure-Go reimplementation**, overturning a unanimous 7/7 panel vote
for "Hybrid" on a verified-from-source fact:

- `gnokey sign` (`sign.go:213`) → `Tx.GetSignBytes` (`tx.go:110`) → `std.GetSignaturePayload`
  (`doc.go:28`). A standalone gno program calling `GetSignaturePayload` invokes the **same
  function** — so a "second oracle" adds **zero** verification value while forcing a 125-package
  gno build dependency. `gnokey` **is** gno's canonical encoder, exercised end-to-end.
- **Importing gno** (`gno.land/pkg/sdk/vm`) pulls 125 gno-internal packages incl. the full 29-pkg
  GnoVM interpreter and gno's **own amino fork** (≠ `tendermint/go-amino v0.16.0` already indirect
  in the backend) plus a second secp256k1 lineage into the token-minting path — worsening the
  audited supply-chain/bus-factor risk for no correctness gain.
- **The format is frozen** for the target chain: `std/doc.go`, `std/utils.go`, `std/coin.go`,
  `vm/msgs.go` are **byte-identical across v1.0.0 / v1.1.0 / test12**; interrealm-v2 is master-only
  and not on the target chain.

## 3. Canonical algorithm (source of truth)

```
signBytes = sortJSON( aminoJSON( SignDoc ) )
SignDoc   = { chain_id, account_number, sequence, fee{gas_fee, gas_wanted}, msgs[], memo }
```

Evidence (gno repo @ `chain/test12`, identical on v1.0.0/v1.1.0):

| Rule | Source |
|---|---|
| `GetSignaturePayload = sortJSON(amino.MarshalJSON(SignDoc))` | `tm2/pkg/std/doc.go:24-42` |
| `Tx.GetSignBytes(chainID, accountNumber, sequence)` | `tm2/pkg/std/tx.go:110-118` |
| `sortJSON = json.Unmarshal→json.Marshal` (sorts keys, strips whitespace, **HTML-escapes `< > &`**) | `tm2/pkg/std/utils.go:10-22` |
| `int64`/`uint64` → **quoted JSON strings** (`"%d"`) | `tm2/pkg/amino/json_encode.go:86-92` |
| registered struct in interface position → `{"@type":"/vm.m_call",<fields inlined>}` | `tm2/pkg/amino/json_encode.go:186-204` |
| `Coin.String()`: zero amount → `""`, else `"<amount><denom>"` | `tm2/pkg/std/coin.go:55-62` |
| `Coins.String()`: empty → `""`, else comma-joined | `tm2/pkg/std/coin.go:212-222` |
| `MsgCall` registered as `m_call` (TypeURL `/vm.m_call`) | `gno.land/pkg/sdk/vm/package.go:8-30` |
| `MsgCall{caller, send, max_deposit, pkg_path, func, args(omitempty)}` | `gno.land/pkg/sdk/vm/msgs.go:92-99` |

**`max_deposit` is mandatory** in the canonical `MsgCall` (added by the storage-deposit feature,
present v1.0.0+). A marshaler that drops it self-verifies but dies at broadcast — the single most
likely reimplementation bug.

## 4. Design — msg-agnostic envelope + passthrough

Memba's tx flow constructs **MsgSend, `/vm.m_call`, and `/vm.m_addpkg`** (`parseMsgs.ts`,
`txExport.ts`, templates). Rather than type every msg, the helper types **only the SignDoc
envelope** and treats each msg as **already-canonical amino-JSON** that rides through the final
`sortJSON` pass. This handles all three msg types (and any future one) with zero per-msg code, and
is sound for A3 because the backend reconstructs the SignDoc from the **same stored structured
msgs that it will broadcast** (verified bytes == broadcast bytes).

**Package:** `backend/internal/auth` (new `signbytes.go`, `signbytes_test.go`, `testdata/`).

```go
// SignDocInput is the canonical-sign-bytes envelope. Msgs are already-canonical
// amino-JSON objects (e.g. {"@type":"/vm.m_call",...}) as produced by the client
// / Adena and stored by the backend.
type SignDocInput struct {
    ChainID       string
    AccountNumber uint64
    Sequence      uint64
    GasWanted     int64
    GasFeeAmount  int64  // 0 => gas_fee serializes to "" (zero-Coin trap)
    GasFeeDenom   string
    Msgs          []json.RawMessage
    Memo          string
}

// CanonicalSignBytes returns sortJSON(aminoJSON(SignDoc)), byte-equal to
// gno std.GetSignBytes / `gnokey sign`. See MEMBA_AAA_A2A3_SIGNBYTES_DESIGN.md §3.
func CanonicalSignBytes(in SignDocInput) ([]byte, error)
```

**Implementation shape (~60 LOC):**
1. Build a typed struct with the exact gno json tags, ints pre-stringified, `fee.gas_fee` as the
   Coin-string (`coinString(amount, denom)` → `""` when amount==0), `msgs` as `[]json.RawMessage`.
   Marshal with stdlib `encoding/json` (**not** string templates — avoids the `MakeADR36SignDoc`
   footgun and inherits canonical escaping).
2. **Final pass = sortJSON**: `json.Unmarshal` the amino-JSON into `any`, then `json.Marshal`.
   This literally mirrors `utils.go` and inherits Go's `< > &` HTML-escaping, alphabetical
   key-sort, and whitespace-strip for free. **Never hand-emit the sorted bytes.**

```go
func coinString(amount int64, denom string) string {
    if amount == 0 { return "" }      // gno coin.go:55-62 IsZero branch
    return fmt.Sprintf("%d%s", amount, denom)
}
```

## 5. Verification wiring (consumers — separate PRs)

The helper adds **no new crypto dependency**. Signature verification reuses the existing
cosmos-sdk `secp256k1.PubKey.VerifySignature` (sha256-then-verify), already proven byte/hash
compatible with gno/Adena by the passing AUTH-CHAINID-01 tests.

- **A2 (auth) — BACKEND IMPLEMENTED (`feat/aaa-a2-txsig-verify`).** `MakeToken`'s
  signature-present path now verifies a **tx-shaped login proof** instead of the (Adena-impossible)
  ADR-036 scheme. New `internal/auth/login_challenge.go`: `LoginChallengeSignBytes(chainID,
  userAddress, nonce)` reconstructs a deterministic, **non-broadcast** sign-doc —
  `account_number=0`, `sequence=0`, zero fee, one sentinel `/vm.m_call`
  (`gno.land/r/memba/login`.`ProveKeyOwnership`, never deployed → un-broadcastable; `args` omitted
  to match gno's `omitempty` canonical form), memo = `"Login to Memba Multisig Service | nonce:
  <base64(challenge.Nonce)>"` — and verifies the user's secp256k1 signature over it via
  `CanonicalSignBytes`. The challenge nonce (already validated for server-sig/expiry/replay and
  bound to the pubkey) is the anti-replay binding; chain binding comes from the doc `chain_id`.
  Confirmed prerequisite: cosmos-sdk `secp256k1.Address()` is byte-equal to the gno chain address,
  so the backend can reconstruct the `caller`. **Rollout stays two-phase / lockout-safe:** the
  `MEMBA_ALLOW_UNSIGNED_AUTH` gate and empty-sig path are unchanged (no flip; default-allow). The
  legacy `MakeADR36SignDoc` helper + its unit tests remain (dead in the live path) for phase-2
  removal. The app-sec "flip + remove now" recommendation is **declined** (would lock out current
  users on independent frontend/backend deploy pipelines).
  **Frontend (A2.phase1) — IMPLEMENTED (`feat/aaa-a2-frontend-signed-login`, PR #400):**
  `Layout.tsx` stops sending `signature:""` and builds a byte-identical login doc via
  `frontend/src/lib/loginChallenge.ts` (`buildLoginChallengeDoc`), signed by a dedicated
  `useAdena.signLoginChallenge` (Adena `SignMultisigTransaction`, not `signArbitrary` whose
  fee-defaulting would break byte-equality); also sends `info.chainId`. Lockout-safe fallback to
  `""` on wallet reject. Before flipping enforcement, capture a **real Adena** signature vector and
  assert it verifies (the only unproven link — gnokey/in-Go vectors prove the backend, not Adena's
  exact JSON for this doc).
- **A3 (multisig) — IMPLEMENTED (`feat/aaa-a3-multisig-verify`).** `SignTransaction`
  reconstructs sign-bytes from the tx row's **stored** fields (`msgs_json`, `fee_json`,
  `account_number`, `sequence`, `memo`) via `CanonicalSignBytes` (never from client `body_bytes`),
  extracts the member pubkey from the multisig's stored `pubkey_json`
  (`multisig.LegacyAminoPubKey`, matched by the authenticated signer's address), and
  secp256k1-verifies. New `internal/auth/multisig_verify.go`: `VerifyMultisigMemberSignature` +
  `StoredTxFields`. **Two-phase / lockout-safe** like A2: gated by
  `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` (default **log-only** — a failure is recorded on the
  `multisig_sig_verify` gate signal but the signature is still accepted, so a reconstruction edge
  case cannot lock out legitimate signers before real Adena member signatures are observed
  verifying; set `=1` to enforce/reject once `multisig_sig_verify{result=ok}` ≈ 100%). `body_bytes`
  is still stored for client-side broadcast assembly but is no longer trusted for verification.

## 6. Test strategy (TDD, byte-equality proof)

Golden vectors generated by **`gnokey` pinned to the target toolchain** (`scripts/gen-signbytes-vectors.sh`,
gnokey version recorded in each fixture header), checked into `testdata/`:

1. **Empirical binary check first** — generate one vector; assert it contains `max_deposit` and
   **quoted** `account_number`/`sequence`/`gas_wanted`. Aborts on a mismatched binary (false-
   confidence guard). Local binary verified: `chain/test12.2937+037183d81`.
2. **Golden-vector matrix** (each: assert `CanonicalSignBytes(input) == golden`):
   - `/vm.m_call`: empty `send`+`max_deposit`; single-coin `send`; `max_deposit` set; nil `args`
     (key absent) vs single vs multi `args`.
   - `/bank.MsgSend`; `/vm.m_addpkg`.
   - zero vs non-zero `gas_fee`; large `uint64` sequence/account_number; `account_number=0`.
   - an `arg` **and** a `memo` containing `< > &` and a unicode char (locks HTML-escaping).
   - multi-msg tx; a 2-of-3 multisig with multiple `Signatures` (the A3 case).
3. **Real end-to-end secp256k1 proof:** for ≥1 vector, verify the **actual `gnokey` signature**
   against `CanonicalSignBytes(input)` + pubkey via cosmos-sdk secp256k1 — proves byte-equality
   through the real signer/verify path. Capture ≥1 vector from a **real Adena** signature for the
   login/member-sig case where feasible.
4. **CI drift guard:** a test that fails if any checked-in golden vector stops matching helper
   output (catches a future on-chain format change, e.g. interrealm-v2 landing). A `Makefile`/CI
   note: any target-chain toolchain bump requires re-running the vector script and reviewing diffs.
   Optional: a differential fuzz feeding randomized SignDocs through the helper.

## 7. Acceptance criteria

- `CanonicalSignBytes` is byte-equal to `gnokey sign` across the full §6 matrix (MsgSend + m_call +
  m_addpkg, all edge cases) — `go test ./internal/auth/...` green with race detector.
- A real `gnokey` (and where feasible Adena) signature verifies against the helper output.
- No new module dependency added to `backend/go.mod`; no gno import.
- CI drift guard present; vector-generation script committed and documented.

## 8. Out of scope (this keystone)

Frontend tx-shaped signing (A2.phase1-frontend), the enforce-flip (A2.phase2), and the A3 RPC
wiring land in their own branches/PRs after the helper is proven. Optional upstreaming of the
helper to gno as a tiny dependency-free `signbytes` reference package (Touron's suggestion) is
tracked but non-blocking.

## 9. A2 — untransacted-wallet login (pubkey-from-sign) + `args:null` (2026-06-12)

> **STATUS (2026-06-13): IMPLEMENTED THEN REVERTED — A2 signed-login is BLOCKED, do not re-attempt as-is.**
> The approach below shipped (PRs #399/#400/#403/#404) but the frontend signing was **reverted** (#405)
> because Adena's `SignMultisigTransaction` is a **multisig-collaboration** primitive (signs to a file to
> collect N-of-M signatures) that **hangs** for a single-account dApp login — it never returns a signature
> to the page. **Current production = unsigned login** (`signature:""`, gated by `MEMBA_ALLOW_UNSIGNED_AUTH`),
> CONFIRMED working for wallets with an on-chain pubkey. The backend A2 capability (tx-shaped verify,
> unbound-challenge, `args:null`) remains merged but unused/harmless.
>
> **To make signed-login work, redesign on the correct single-account primitive (`signTx`/`signAmino`):**
> those sign with Adena's OWN chain `account_number`/`sequence`, so the backend must reconstruct
> `LoginChallengeSignBytes` from chain-queried OR client-supplied account_number/sequence (the nonce gives
> anti-replay). Treat as a designed project (deep audit → design → review → build), NOT a live patch.
> Funded-but-never-transacted wallets (e.g. `public_key:null`, `sequence:0`) also can't log in until they
> send 1 on-chain tx (registers the pubkey) — pre-existing v5 policy (#292). The rest of §9 documents the
> reverted approach for reference.


**Problem (two distinct, both surfaced by live test).** On gno, an account's public key is only
on-chain after its first outgoing tx. A **funded-but-never-transacted** wallet has
`public_key:null` on-chain, so Adena's `GetAccount` returns no pubkey, the frontend falls back to
**address-only** auth, and the v5 anti-impersonation policy rejects it → `GetToken` 403 (proven via
`auth/accounts` query: `sequence:0`, `public_key:null`). Separately, even with a pubkey, the login
signature verifies as `signed_invalid` because **Adena emits `"args":null`** for an empty-args
m_call (proto round-trip; `adena-module .../messages.ts:120-124`) while the template **omits**
`args`.

**Approach (A — unbound challenge + signature-as-proof).** A valid signature *is* the ownership
proof, so it can replace `boundPubkeyHash` (AUTH-01) on the signed path, and the pubkey can come
from **Adena's sign response** (`Signature.pub_key.value`, `multisig.ts:13-17`) instead of the
chain. This lets untransacted wallets authenticate by proving key ownership — strictly stronger than
the address-only path we reject today.

**Security model.** `boundPubkeyHash` exists only to stop empty-sig impersonation (attacker replays
a challenge with a victim's public pubkey). A real signature makes that impossible. Therefore:
- **Signed path:** signature must verify over `LoginChallengeSignBytes` (nonce + chain_id +
  caller-derived-from-pubkey); `boundPubkeyHash` is **optional** (verified if present). Unbound
  challenges are accepted *only when signed*.
- **Empty-sig path:** unchanged — `boundPubkeyHash` **required** + `MEMBA_ALLOW_UNSIGNED_AUTH` gate.
- Replay prevented by the server-signed, single-use nonce; impersonation prevented by the signature.
- Phase-1 `signed_invalid` (invalid sig still minted) is no *new* risk — it already mints for
  empty sigs in phase 1; phase-2 enforcement rejects it.

**Changes.**
- Backend `LoginChallengeSignBytes`: emit `"args":null` (match Adena).
- Backend `MakeToken`: binding check becomes signature-aware — verify `boundPubkeyHash` when
  present; reject unbound **only when the signature is empty**; unbound+signed is allowed (the
  signature path is the proof).
- Frontend `buildLoginChallengeDoc`: add `args: null`.
- Frontend `signLoginChallenge`: return `{ signature, pubKey }` (read `res.data.signature.pub_key`,
  convert `{"@type":"/tm.PubKeySecp256k1",value}` → `{"type":"tendermint/PubKeySecp256k1",value}`).
- Frontend `Layout`: sign the challenge; use the **sign-response pubkey** as authoritative (falls
  back to GetAccount pubkey); `getChallenge` binds when a pubkey is already known, else unbound;
  submit the authoritative pubkey + signature; honest error when no pubkey **and** signing
  declined.

**Testing / proof.** TDD both sides. Backend: unbound+valid-sig mints `signed`; unbound+empty-sig
rejected; bound-mismatch rejected; `args:null` in the doc. Frontend: `buildLoginChallengeDoc`
includes `args:null`; pubkey extracted from sign response. Add a **golden vector from a real Adena
signature** (captured post-deploy when the wallet signs in → `result=signed`) to lock byte-equality.
A focused **security review** of the unbound-challenge change before merge. Gates stay permissive
until `result=signed` is observed; then flip `MEMBA_ALLOW_UNSIGNED_AUTH=0`.

**Note (gnokey vs Adena):** `gnokey` omits empty `args`; Adena emits `args:null`. The login doc is
never broadcast, so A2 matches **Adena**. A3 enforcement must account for Adena's proto-roundtrip
form before flipping `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` (tracked; A3 is log-only today).

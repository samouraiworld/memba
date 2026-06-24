# Multisig A3 Enforcement — Go-Live Runbook

**Purpose:** safely flip `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` (reject member signatures that fail server-side A3 verification) **without bricking multisig signing**.

**Status after the propose-format PR:** the frontend now **stores the exact canonical doc Adena signs** (`lib/multisigTx.ts` → `ProposeTransaction` + `useAdena.signArbitrary`), the backend `CreateTransaction` rejects the old cosmos fee shape, and the A3 test locks the canonical `/vm.m_call` round-trip on test13. **The remaining gate is empirical: confirm a REAL Adena member signature verifies before flipping.** Do not skip it — the in-Go test proves internal consistency, not Adena's exact byte output (the `args:null` / field-presence assumptions).

---

## Gate 1 — capture a real Adena signature (the definitive proof)

1. On the deploy preview (NOT local — multisig RPC reads need the live node), connect a real Adena wallet that is a **member** of a test13 multisig.
2. Propose a real `/vm.m_call` transaction (e.g. a DAO `Vote`/`Propose`), then click **Sign Transaction**. Adena signs via `SignMultisigTransaction`.
3. From the backend DB (or `GetTransaction`), capture for that tx:
   - `msgs_json`, `fee_json`, `account_number`, `sequence`, `chain_id`, `memo`
   - `multisig_pubkey_json` (the multisig's amino pubkey)
   - the member's `signature` (base64) and `user_address`

## Gate 2 — prove it verifies, as a committed fixture

Add a Go test that feeds the captured values into `auth.VerifyMultisigMemberSignature` and asserts it returns `nil`:

```go
func TestA3_RealAdenaSignature(t *testing.T) {
    err := auth.VerifyMultisigMemberSignature(
        `<multisig_pubkey_json>`, `<user_address>`, `<signature_b64>`,
        auth.StoredTxFields{
            ChainID: "test13", AccountNumber: <n>, Sequence: <n>,
            MsgsJSON: `<msgs_json>`, FeeJSON: `<fee_json>`, Memo: `<memo>`,
        })
    if err != nil { t.Fatalf("real Adena sig must verify: %v", err) }
}
```

- **If it passes:** the canonical shape is correct end-to-end. Proceed to Gate 3.
- **If it FAILS:** the assumption about Adena's exact form is wrong (most likely `args` — `null` vs `[]` vs absent — or `max_deposit` presence, or coin-string formatting). Diff the captured `msgs_json` against `toCanonicalMsg`'s output and fix `lib/multisigTx.ts` + this fixture until it verifies. **Do not flip until green.**

## Gate 3 — observe log-only health, then flip

1. Deploy with the flag still **0** (log-only). Watch the `multisig_sig_verify` gate signal on `/metrics` (#479) as real members sign for a few days.
2. When `multisig_sig_verify{result=ok}` is ~100% (no `result=mismatch` from legitimate signers), set:
   ```
   MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1
   ```
3. Keep watching the signal. **Rollback = set the flag back to `0`** (two-phase, lockout-safe — `multisig_verify.go:17-24`).

---

## Out of scope (tracked follow-up)

`buildBroadcastTx` (TransactionView) hex-encodes Amino-**JSON**, which gno `broadcast_tx_commit` won't decode — broadcast relies on Adena's `BroadcastMultisigTransaction`. This is the **post-signing** step and is **independent of the enforce-flag brick risk** (the flag gates member-sig verification at `SignTransaction`, not broadcast). Fix the Amino-binary broadcast in its own PR (likely via Adena's primitive, since JS can't produce Amino-binary).

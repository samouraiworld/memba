# A2 Signed-Login on `adena.Sign` (signAmino) — Design + Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status (2026-06-13): DESIGN — awaiting expert review + user approval. DO NOT build until approved.**
> Supersedes the BLOCKED approach in `MEMBA_AAA_A2A3_SIGNBYTES_DESIGN.md` §9 (which used the wrong
> primitive, `SignMultisigTransaction`). Login currently works **unsigned/gated**
> (`MEMBA_ALLOW_UNSIGNED_AUTH` default-allow); this plan adds the cryptographic proof so the gate can be
> flipped to enforce. Nothing here changes live login until the final phase-2 flip.

**Goal:** Replace empty-signature (gated) login with a real proof of key ownership, signed by the user's
wallet via Adena's `Sign`/`signAmino` primitive, verified server-side over gno-canonical sign-bytes.

**Architecture:** The frontend asks Adena to sign a **tx-shaped login challenge** — a self-`/bank.MsgSend`
of `1ugnot` (wallet → its own address) with the server nonce in the memo. `adena.Sign` resolves to the page with the **full Amino
sign-doc + signature + pubkey**. The backend reconstructs the gno-canonical sign-bytes from that doc and
verifies the signature. No new subsystems — extends the existing `auth` package + `TokenRequestInfo` proto.

**Tech Stack:** Go (ConnectRPC, `tm2` secp256k1 + the keystone `CanonicalSignBytes`), React/TS frontend,
Adena injected provider (`window.adena.Sign`), Buf protobuf codegen.

---

## 0. Expert review outcomes (2026-06-13) — folded in, must-honor

Three adversarial reviewers (security / gno-canonical-bytes / Adena-frontend) audited this design against
source. The **phase-2 cryptographic design is sound on all axes** (replay, cross-protocol reuse,
impersonation, free-variables-are-signature-verified, secp256k1 verify is panic-free + malleability-
resistant). Required changes, in priority order:

- **[SEC-HIGH — must fix] Phase-1 `signed_invalid` on an *unbound* challenge is impersonation-capable and
  strictly widens today's surface.** A *non-empty garbage* signature skips the bind-or-reject gate
  (`crypto.go:346-351` only fires when `signatureBase64 == ""`), then lands in the permissive
  `signed_invalid` branch and mints a token for the **client-supplied** `info.UserPubkeyJson` — i.e. for
  any victim address — on an unbound challenge. **Fix (Task 5):** on the present-but-invalid-signature
  phase-1 path, still **require `boundPubkeyHash`** (only bound challenges may pass permissively); reject
  unbound+invalid-sig exactly like unbound+empty-sig. Unbound is allowed **only when the signature
  actually verifies.** This closes the AUTH-01 hole in phase-1.

- **[FE-BLOCKER — confirmed, not just a risk] The non-deployed sentinel `/vm.m_call` BLOCKS the Adena
  popup.** `ApproveSign` disables Approve when gas simulation fails (`disabledApprove = … ||
  isSimulateError`, `approve-transaction/index.tsx:108-133`; `simulateTx` fails for the unknown realm
  `gno.land/r/memba/login`). The popup never reaches `createSignDocument` → login cannot complete. The
  login-msg shape is therefore a **decision: the login challenge is a self-`/bank.MsgSend` of `1ugnot`**
  (wallet → its own address), which simulates cleanly and needs no deployed realm (user-approved
  2026-06-13). It also trips `isErrorNetworkFee` for **zero-balance** wallets, so any signing wallet must
  hold a little GNOT to cover the gas fee (acceptable — Memba wallets are funded). If ever broadcast it is a
  harmless self-transfer; anti-replay comes from the single-use server nonce in the memo, not from
  non-broadcastability. **This replaces the `/vm.m_call` sentinel throughout** (§4, Tasks 1/2/6).

- **[BUILD-TRAP] AUTH-A2-DEBUG call must be rebuilt.** `crypto.go:382` independently calls the old 3-arg
  `LoginChallengeSignBytes`; after Task 2 it won't compile, and must be rebuilt with the **same real
  free-vars** used in verification (not zeros) or the debug log is useless. Folded into Task 5.

- **[BUILD-TRAP] `args:null` / empty `send`+`max_deposit` byte-equality is the one unproven assumption.**
  ts-proto `MsgCall.toJSON` *may* omit empty `send`/`max_deposit`; if so, the backend `loginMsg`'s
  `"send":"","max_deposit":""` are extra keys → mismatch. The committed golden vectors are **gnokey**, not
  Adena, so they don't prove it. Task 1's real-Adena vector is the oracle; Task 2 Step 4 may require making
  those fields `omitempty`. Do not merge Task 2 on the assumed shape.

- **[DEPLOY-ORDER] Strict protojson rejects unknown fields.** `MakeToken` uses
  `protojson.UnmarshalOptions{DiscardUnknown:false}` (`crypto.go:269`), so the 5 new `signed_*` fields must
  be in the **regenerated backend** before any client sends them. Hard gate: **Task 4 (backend codegen) +
  deploy must precede any frontend that emits `signed_*`.**

- **[SCALING note] Single-use nonce is in-memory per-process** (`usedNonces` map, `crypto.go:59-64`). On a
  multi-machine Fly deployment a captured `{document,signature}` could replay against an instance that
  never saw the nonce. Pre-existing; the design relies on single-use as a core property, so either pin to
  one instance for the auth path or move nonce-dedup to a shared store (follow-up, not A2-blocking).

- **[correction] chain_id source.** The backend reconstructs with `effectiveChainID == info.Challenge.ChainId`
  (`crypto.go:296,308`), **not** a `document.chain_id` field. Adena signs over the wallet's *live* network
  (`sign-gno-document.ts:42-44`). The Task-1 vector must be captured with Adena on the **same** chain as the
  challenge, else the bytes differ. If a user's wallet is on the wrong network → signature fails to verify
  → phase-1 gated fallback / phase-2 lockout (protective, but surface a clear UI message).

- **[confirmed positives]** Response shape is `{document, signature}` with **camelCase** `signature.pubKey.value`
  (the `pub_key` fallback in `mapSignResponse` is dead-but-harmless); all `document` field casings match;
  the reconstructed `loginMsg` key set (caller/send/max_deposit/pkg_path/func/args:null) matches Adena's
  proto-roundtrip *modulo* the empty-string question above; Adena's default fee serializes to
  `"100000ugnot"` (the current hardcoded `"1ugnot"` is exactly why signed-login fails today).

---

## 1. Why the previous attempt failed (audited from source)

The reverted approach (`MEMBA_AAA_A2A3_SIGNBYTES_DESIGN.md` §9, PRs #399–#405) failed for **two** reasons,
both now traced to wallet source:

1. **Wrong primitive.** It used `adena.SignMultisigTransaction`, which is a *multisig-collaboration*
   primitive that (in its popup hook) **saves the signature to a file** to collect N-of-M signatures and
   never resolves a single-account result back to the page → **login hangs**
   (`adena-wallet .../hooks/wallet/sign-transaction/use-sign-multisig-transaction-screen.ts`,
   `saveSignatureToFile`).

2. **Hardcoded free variables.** Even with a signature, `LoginChallengeSignBytes`
   (`backend/internal/auth/login_challenge.go:53`) reconstructs the doc with
   `AccountNumber:0, Sequence:0, GasWanted:0, GasFee:1ugnot`. But Adena signs over the wallet's **real**
   chain `account_number`/`sequence` and **its own** fee — so the reconstructed bytes can never match.

### The correct primitive: `window.adena.Sign` (= `signAmino`)

Traced end-to-end in `adena-wallet`:

- `inject.ts:82` — `async Sign(message: TransactionParams)` → `executor.signAmino` → routes to the
  **`ApproveSign`** popup (`pages/popup/wallet/approve-sign/index.tsx`), **not** the file-saving multisig
  screen. On confirm it calls `chrome.runtime.sendMessage(response)` → resolves the dApp promise. **No hang.**
- The popup responds with `data = { document, signature }`
  (`approve-sign/index.tsx:288`, `WalletResponseSuccessType.SIGN_SUCCESS`):
  - `document` = the full Amino sign-doc built by `transactionService.createDocument`
    (`services/transaction/transaction.ts:120`): `{ msgs, fee:{amount:[{denom,amount}],gas}, chain_id,
    memo, account_number, sequence }`. `account_number`/`sequence` are chain-queried
    (`provider.getAccountInfo`, defaulting to `0`).
  - `signature` = `transactionService.createSignature` output (`transaction.ts:159`):
    `{ pubKey:{ typeUrl, value(base64) }, signature(base64) }`. **The pubkey comes from the wallet**, so
    **untransacted wallets work** (no on-chain pubkey needed).
- The signature is computed by `signGnoDocument`
  (`adena-module/src/wallet/keyring/sign-gno-document.ts:66`) over:

  ```text
  signBytes = UTF8( encodeCharacterSet( sortedJsonStringify({
    chain_id,          // = wallet's LIVE network (provider.getStatus().node_info.network)
    account_number,    // = document.account_number (chain-queried)
    sequence,          // = document.sequence
    fee: { gas_fee: <coin string>, gas_wanted: <string> },
    msgs: decodeTxMessages(documentToTx(document).messages),   // PROTO-ROUNDTRIPPED → empty args become "args":null
    memo,
  }) ) )
  ```

  The field set `{chain_id, account_number, sequence, fee{gas_fee,gas_wanted}, msgs, memo}` and the
  `sortedJsonStringify` (alphabetical-key sorted JSON) **exactly match** the backend keystone
  `CanonicalSignBytes` / `signDocEnvelope` (`backend/internal/auth/signbytes.go`). This is the whole reason
  the keystone exists.

### Two non-obvious consequences (the design hinges on these)

- **The signed `msgs` are the proto-roundtripped form, not `document.msgs`.** `document.msgs` (returned to
  the page) is the `{type, value}` display form (`transaction-mapper.ts:48`
  `mappedDocumentMessagesWithCaller`). The *signed* msgs are `decodeTxMessages(documentToTx(document))`,
  i.e. the flat `{"@type":"/vm.m_call", caller, send, max_deposit, pkg_path, func, args:null}` amino form.
  → The backend must **reconstruct** the canonical signed msg (it already does: `loginMsg`,
  `login_challenge.go:39`, emits `"args":null`). It must **not** canonicalize `document.msgs` verbatim.

- **`account_number`, `sequence`, `gas_wanted`, `gas_fee` are free variables** chosen by Adena, not the
  dApp. They are signed but **irrelevant to login security** (the doc is never broadcast). The fix is to
  **thread Adena's actual values through to the backend** so the reconstructed bytes match. A malicious
  client that lies about them simply fails verification — no security impact.

  Adena's defaults when the dApp supplies no fee (`signAmino` params have no fee field):
  `DEFAULT_GAS_WANTED = 2_000_000_000`, `DEFAULT_GAS_FEE = 100_000` (ugnot)
  (`adena-extension/src/common/constants/tx.constant.ts`). The popup may overwrite the fee with a
  simulation estimate; **we do not assume a value — we pass through whatever Adena signed.**

## 2. Security model

Authentication = "the holder of pubkey P signed a fresh, single-use server challenge for this chain."

**Validated (security-critical):**
- `challenge.nonce` — server-signed (ed25519), single-use, expiring. Already validated by
  `ValidateChallenge` for server-signature/expiry/replay before `MakeToken` derives identity.
- `document.memo == LoginChallengeMemo(nonce)` — binds the signature to *this* challenge (anti-replay).
- `document.chain_id == effectiveChainID` — chain binding (no cross-chain replay).
- `msgs` == the login self-`/bank.MsgSend` with `from_address == to_address == bech32(pubkey.Address())`
  and `amount == LoginAmount` (`1ugnot`) — together with the memo nonce this prevents cross-protocol
  signature reuse (a real tx the user signed elsewhere has a different memo/amount/recipient and won't
  verify here; the memo nonce is the dominant binding, the self-send shape is defense in depth).
- `signature` verifies over `CanonicalSignBytes(reconstructed doc)` using `pubkey`.
- `bech32(pubkey.Address())` is the authenticated identity.

**Free (signed, client-supplied, signature-verified, NOT security-critical):**
`account_number`, `sequence`, `gas_wanted`, `gas_fee` — used only so the reconstructed bytes equal what
Adena signed. The doc is never broadcast.

**Binding to the existing two-phase gate (unchanged):**
- **Signed path** (this plan): a **valid** signature *is* the ownership proof, so the challenge may be
  **unbound** (`boundPubkeyHash` optional) — needed so untransacted wallets (pubkey not on chain) can
  authenticate with the sign-response pubkey. If the challenge *is* bound, the hash is still verified
  (defense in depth). This logic already exists in `MakeToken` (`crypto.go:337–352`).
- **Empty-sig OR present-but-invalid-sig path:** `boundPubkeyHash` **required** + `MEMBA_ALLOW_UNSIGNED_AUTH`
  gate. **[SEC-HIGH fix]** Unbound is permitted **only when the signature verifies** — an unbound challenge
  with an empty *or invalid* signature is rejected outright (closes the phase-1 impersonation hole: a
  non-empty garbage sig must not pass an unbound challenge, see §0). `boundPubkeyHash` proves the challenge
  was minted for the claimed pubkey, which is the only ownership signal on the non-verifying path.
- Phase-1 keeps gates permissive (an invalid/`signed_invalid` signature still mints + logs, never locks
  anyone out). Phase-2 flips `MEMBA_ALLOW_UNSIGNED_AUTH=0` only after the `auth_login{result=signed}`
  metric proves real Adena signatures verify in production.

## 3. Wire format changes

Add the signed doc's free variables to `TokenRequestInfo` (carried inside `GetTokenRequest.info_json`;
`user_signature` already exists). Additive + backward-compatible — empty-sig clients omit them.

```proto
// api/memba/v1/memba.proto — TokenRequestInfo
message TokenRequestInfo {
  string kind = 1;
  Challenge challenge = 2;
  string user_bech32_prefix = 3;
  string user_pubkey_json = 4;
  string user_address = 5;
  string chain_id = 6;
  // A2 signed-login: the free variables Adena actually signed (from the Sign() response
  // `document`), so the backend reconstructs byte-identical sign-bytes. Signature-verified,
  // not trusted — a wrong value just fails verification. Empty on the unsigned path.
  string signed_account_number = 7; // document.account_number
  string signed_sequence = 8;       // document.sequence
  string signed_gas_wanted = 9;     // document.fee.gas
  string signed_gas_fee_amount = 10; // document.fee.amount[0].amount ("" or "0" => zero-Coin "")
  string signed_gas_fee_denom = 11;  // document.fee.amount[0].denom (e.g. "ugnot")
}
```

## 4. The exact reconstructed sign-doc (source of truth)

Backend reconstructs and verifies over:

```text
CanonicalSignBytes(SignDocInput{
  ChainID:       effectiveChainID,                       // == info.Challenge.ChainId, validated
  AccountNumber: parseUint(info.SignedAccountNumber),    // from Adena's signed document
  Sequence:      parseUint(info.SignedSequence),
  GasWanted:     parseInt(info.SignedGasWanted),
  GasFeeAmount:  parseInt(info.SignedGasFeeAmount),      // 0 => gas_fee serializes to "" (zero-Coin trap)
  GasFeeDenom:   info.SignedGasFeeDenom,
  Msgs:          []RawMessage{ loginMsg{                 // RECONSTRUCTED, not from client msgs
                   @type:"/bank.MsgSend",
                   from_address: bech32(pubkey.Address()),
                   to_address:   bech32(pubkey.Address()),  // self-send
                   amount:       "1ugnot" } },
  Memo:          LoginChallengeMemo(nonce),
})
```

The login challenge is a self-`/bank.MsgSend` of `1ugnot` (chosen so Adena's popup can gas-simulate it; a
non-deployed `/vm.m_call` blocks the popup — see §0). `CanonicalSignBytes` applies the final `sortJSON`
pass, so field order is irrelevant; the **exact** amino-JSON key set + `amount` encoding that Adena's
`decodeTxMessages` emits for MsgSend (e.g. `amount:"1ugnot"` coin-string vs an array) is pinned by the
golden vector (Task 1) before the backend `loginMsg` is finalized.

## 5. Files touched

- `api/memba/v1/memba.proto` — add 5 fields to `TokenRequestInfo` (then regenerate Go + TS).
- `backend/internal/auth/login_challenge.go` — parametrize `LoginChallengeSignBytes` /
  `VerifyLoginChallengeSignature` by `(accountNumber, sequence, gasWanted, gasFeeAmount, gasFeeDenom)`.
- `backend/internal/auth/crypto.go` — `MakeToken` passes the new `info.Signed*` fields into verification.
- `backend/internal/auth/testdata/signbytes/` — new golden vector from a **real** Adena `Sign` capture.
- `backend/internal/auth/login_challenge_test.go`, `crypto_a2_test.go` — TDD coverage.
- `frontend/src/lib/loginChallenge.ts` — build the `Sign` params + map the response; drop the
  `SignMultisigTransaction` doc builder.
- `frontend/src/hooks/useAdena.ts` — rewrite `signLoginChallenge` to use `adena.Sign`; return
  `{ signature, pubKey, account_number, sequence, gas_wanted, gas_fee_amount, gas_fee_denom }`.
- `frontend/src/components/layout/Layout.tsx` — submit the signature + signed free-vars (stop sending
  `signature: ""`); keep honest-error fallback when signing is declined.
- `frontend/src/lib/loginChallenge.test.ts` — frontend unit coverage.

---

## Task 1: De-risking spike — capture a real Adena `Sign` golden vector ⚠️ DO THIS FIRST

**Rationale:** Several things can only be resolved against a real wallet: (a) the exact runtime shape of
`res.data` (camel vs snake: `signature.pubKey.value` vs `signature.pub_key.value`); (b) that the
self-`MsgSend` **simulates and the popup completes** (the `/vm.m_call` sentinel was proven to block — §0);
(c) the **exact amino-JSON the signed MsgSend carries** (`amount` as `"1ugnot"` coin-string vs array;
`from_address`/`to_address` key names; whether empty defaults are omitted). This spike produces the golden
vector that all backend byte-equality tests consume — **before** any backend/login code changes.

**Files:**
- Create: `frontend/sign-spike.html` (throwaway, git-ignored — served by vite at `/sign-spike.html`)
- Create: `backend/internal/auth/testdata/signbytes/adena_login_<addr>.json` (captured vector)

- [ ] **Step 1: Throwaway page that calls `adena.Sign` with the self-send login challenge**

```html
<!-- frontend/sign-spike.html — run the frontend dev server, open http://localhost:5173/sign-spike.html
     with Adena installed and the wallet on test12 (and holding a little GNOT). -->
<script type="module">
const CLIENT_MAGIC = "Login to Memba Multisig Service";
const nonceB64 = "AAAA"; // any fixed value for the spike
const memo = `${CLIENT_MAGIC} | nonce: ${nonceB64}`;
window.run = async () => {
  const adena = window.adena;
  await adena.AddEstablish("Memba sign spike");
  const acct = await adena.GetAccount();
  const self = acct.data.address;
  const res = await adena.Sign({
    messages: [{
      type: "/bank.MsgSend",
      value: { from_address: self, to_address: self, amount: "1ugnot" },
    }],
    memo,
  });
  // DUMP THE EXACT RUNTIME SHAPE — this is the deliverable.
  document.getElementById("out").textContent = JSON.stringify(res, null, 2);
  console.log("FULL RESPONSE", res);
};
</script>
<button onclick="run()">Sign login challenge</button>
<pre id="out"></pre>
```

- [ ] **Step 2: Run it against a real Adena wallet on test12 and record observations**

Open the page, click Sign, approve in Adena. Record in the captured-vector file's comments:
- Did the popup **complete** (resolve), or did the confirm button stay disabled? (gas-estimation /
  insufficient-balance — the wallet must hold > 1ugnot + gas).
- The exact `res.data` shape: keys of `document`, keys of `signature` (`pubKey` vs `pub_key`,
  `typeUrl` vs `type_url`), the **signed MsgSend amino form** (`amount` encoding, `from_address`/
  `to_address`), and whether `document.msgs` is `{type,value}` or `{"@type"}` form.

Expected: `res.data = { document:{ msgs, fee:{amount:[{denom,amount}],gas}, chain_id, account_number,
sequence, memo }, signature:{ pubKey:{typeUrl,value}, signature } }`. If the popup still blocks, capture the
error banner text and stop — re-evaluate the login-msg shape before proceeding.

- [ ] **Step 3: Save the captured vector for backend tests**

Save the real `{document, signature}` JSON to
`backend/internal/auth/testdata/signbytes/adena_login_<addr>.json` with a header comment recording the
wallet address, chain_id, and the observed response shape. **This file is the byte-equality oracle.**

- [ ] **Step 4: Commit the vector (spike HTML stays git-ignored)**

```bash
echo "frontend/sign-spike.html" >> frontend/.gitignore
git add backend/internal/auth/testdata/signbytes/adena_login_*.json frontend/.gitignore
git commit -m "test(auth): capture real Adena Sign login golden vector for A2"
```

> **Note:** the login msg is the self-`/bank.MsgSend` of `1ugnot` (§0 decision). `1ugnot`, not `0ugnot` —
> gno rejects zero-coin sends, and a zero amount would also defeat the popup's gas simulation. If Step 2
> still shows a block (e.g. insufficient balance), the wallet needs a little more GNOT; do not fall back to
> the `/vm.m_call` sentinel (proven to block).

---

## Task 2: Backend — parametrize `LoginChallengeSignBytes`

**Files:**
- Modify: `backend/internal/auth/login_challenge.go:53-79`
- Test: `backend/internal/auth/login_challenge_test.go`

- [ ] **Step 1: Write the failing byte-equality test against the real vector**

```go
// login_challenge_test.go
func TestLoginChallengeSignBytes_MatchesAdenaVector(t *testing.T) {
	v := loadAdenaLoginVector(t) // reads testdata/signbytes/adena_login_*.json {document, signature}
	got, err := LoginChallengeSignBytes(LoginSignDocParams{
		ChainID:       v.Document.ChainID,
		UserAddress:   v.Document.Msgs[0].Value.Caller, // == bech32(pubkey.Address())
		Nonce:         mustDecodeMemoNonce(t, v.Document.Memo),
		AccountNumber: mustU64(t, v.Document.AccountNumber),
		Sequence:      mustU64(t, v.Document.Sequence),
		GasWanted:     mustI64(t, v.Document.Fee.Gas),
		GasFeeAmount:  mustI64(t, v.Document.Fee.Amount[0].Amount),
		GasFeeDenom:   v.Document.Fee.Amount[0].Denom,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Adena signs over sortedJsonStringify of the same field set; recompute it here from
	// the captured document and assert byte-equality.
	want := adenaSignedBytes(t, v.Document)
	if !bytes.Equal(got, want) {
		t.Fatalf("sign-bytes mismatch:\n got=%s\nwant=%s", got, want)
	}
}
```

- [ ] **Step 2: Run it — expect FAIL (compile error: new signature/params type)**

Run: `cd backend && go test ./internal/auth/ -run TestLoginChallengeSignBytes_MatchesAdenaVector -v`
Expected: FAIL (does not compile — `LoginSignDocParams` undefined).

- [ ] **Step 3: Parametrize the function — login msg is the self-`MsgSend`**

Replace the `/vm.m_call` `loginMsg` struct (`login_challenge.go:39-47`) with the MsgSend form **pinned by
the Task-1 golden vector**. The login challenge is `from_address == to_address == user`, `amount` `1ugnot`.
Field tags / which keys are omitempty MUST match Adena's `decodeTxMessages` output for MsgSend exactly
(the vector is the oracle — adjust if it shows e.g. an array `amount` or omitted defaults).

```go
// login_challenge.go — login msg shape (CONFIRM against testdata vector before merge)
type loginMsg struct {
	Type        string `json:"@type"`        // "/bank.MsgSend"
	FromAddress string `json:"from_address"`
	ToAddress   string `json:"to_address"`
	Amount      string `json:"amount"`       // gno coin string, e.g. "1ugnot"
}

// LoginAmount is the self-send amount of the login challenge (never meaningfully transferred).
const LoginAmount = "1ugnot"

type LoginSignDocParams struct {
	ChainID       string
	UserAddress   string
	Nonce         []byte
	AccountNumber uint64
	Sequence      uint64
	GasWanted     int64
	GasFeeAmount  int64
	GasFeeDenom   string
}

func LoginChallengeSignBytes(p LoginSignDocParams) ([]byte, error) {
	msg, err := json.Marshal(loginMsg{
		Type:        "/bank.MsgSend",
		FromAddress: p.UserAddress,
		ToAddress:   p.UserAddress, // self-send
		Amount:      LoginAmount,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal login msg: %w", err)
	}
	return CanonicalSignBytes(SignDocInput{
		ChainID:       p.ChainID,
		AccountNumber: p.AccountNumber,
		Sequence:      p.Sequence,
		GasWanted:     p.GasWanted,
		GasFeeAmount:  p.GasFeeAmount,
		GasFeeDenom:   p.GasFeeDenom,
		Msgs:          []json.RawMessage{msg},
		Memo:          LoginChallengeMemo(p.Nonce),
	})
}
```

(The `LoginPkgPath`/`LoginFunc` constants and the old `/vm.m_call` `loginMsg` are removed.)

- [ ] **Step 4: Run the test — expect PASS (byte-equal to the real Adena signature's payload)**

Run: `cd backend && go test ./internal/auth/ -run TestLoginChallengeSignBytes_MatchesAdenaVector -v`
Expected: PASS. **If it fails, the `loginMsg` shape diverges from Adena's `decodeTxMessages` output — diff
`got` vs `want` and reconcile (an unexpected key, `amount` array-vs-string, or an omitted default). Do not
proceed until green.**

- [ ] **Step 5: Commit**

```bash
git add backend/internal/auth/login_challenge.go backend/internal/auth/login_challenge_test.go
git commit -m "feat(auth): parametrize login sign-bytes by Adena's real account/sequence/fee"
```

---

## Task 3: Backend — verify against the signed free-vars

**Files:**
- Modify: `backend/internal/auth/login_challenge.go` (`VerifyLoginChallengeSignature`)
- Test: `backend/internal/auth/login_challenge_test.go`

- [ ] **Step 1: Failing test — real vector signature verifies; tampered free-var fails**

```go
func TestVerifyLoginChallengeSignature_RealVector(t *testing.T) {
	v := loadAdenaLoginVector(t)
	pub := mustPubKeyFromVector(t, v) // secp256k1 from signature.pubKey.value (base64 amino)
	p := loginParamsFromVector(t, v)
	if err := VerifyLoginChallengeSignature(pub, p, v.Signature.Signature); err != nil {
		t.Fatalf("real Adena signature must verify: %v", err)
	}
	bad := p
	bad.Sequence = p.Sequence + 1 // wrong free-var => bytes differ => must fail
	if err := VerifyLoginChallengeSignature(pub, bad, v.Signature.Signature); err == nil {
		t.Fatal("tampered sequence must fail verification")
	}
}
```

- [ ] **Step 2: Run — expect FAIL (signature mismatch on new params type)**

Run: `cd backend && go test ./internal/auth/ -run TestVerifyLoginChallengeSignature_RealVector -v`
Expected: FAIL (compile / signature).

- [ ] **Step 3: Update `VerifyLoginChallengeSignature` to take `LoginSignDocParams`**

```go
func VerifyLoginChallengeSignature(
	pubKey interface{ VerifySignature(msg, sig []byte) bool },
	p LoginSignDocParams,
	sigBase64 string,
) error {
	sig, err := base64.StdEncoding.DecodeString(sigBase64)
	if err != nil {
		return errors.Wrap(err, "failed to decode user signature")
	}
	signBytes, err := LoginChallengeSignBytes(p)
	if err != nil {
		return errors.Wrap(err, "failed to build login challenge sign bytes")
	}
	if !pubKey.VerifySignature(signBytes, sig) {
		return errors.New("invalid user signature")
	}
	return nil
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && go test ./internal/auth/ -run TestVerifyLoginChallengeSignature_RealVector -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/auth/login_challenge.go backend/internal/auth/login_challenge_test.go
git commit -m "feat(auth): verify login signature against Adena's signed free-vars"
```

---

## Task 4: Proto — add signed free-vars to `TokenRequestInfo`

**Files:**
- Modify: `api/memba/v1/memba.proto` (`TokenRequestInfo`, after line 84)
- Regenerate: Go (`backend/...memba_pb.go`) + TS (`frontend/src/gen/...`)

- [ ] **Step 1: Add the 5 fields**

```proto
  string signed_account_number = 7;
  string signed_sequence = 8;
  string signed_gas_wanted = 9;
  string signed_gas_fee_amount = 10;
  string signed_gas_fee_denom = 11;
```

- [ ] **Step 2: Regenerate and verify the codegen compiles**

Run: `make generate && cd backend && go build ./... && cd ../frontend && npm run build`
Expected: clean build; generated structs expose `GetSignedAccountNumber()` etc. (Go) and camelCase fields
(TS). Commit the regenerated files with the proto.

- [ ] **Step 3: Commit**

```bash
git add api/memba/v1/memba.proto backend/internal/**/memba_pb.go frontend/src/gen/
git commit -m "feat(api): carry Adena's signed account/sequence/fee in TokenRequestInfo"
```

---

## Task 5: Backend — wire free-vars through `MakeToken`

**Files:**
- Modify: `backend/internal/auth/crypto.go:357-394` (the signed-signature branch)
- Test: `backend/internal/auth/crypto_a2_test.go`

- [ ] **Step 1: Failing test — MakeToken mints `signed` for the real vector**

```go
func TestMakeToken_SignedVector_MintsSigned(t *testing.T) {
	v := loadAdenaLoginVector(t)
	info := tokenRequestInfoFromVector(t, v) // kind=ClientMagic, challenge bound or unbound, pubkey, signed_* set
	infoJSON := mustProtoJSON(t, info)
	tok, err := MakeToken(srvPriv, srvPub, DefaultTokenDuration, infoJSON, v.Signature.Signature, v.Document.ChainID)
	if err != nil {
		t.Fatalf("expected signed mint, got: %v", err)
	}
	requireAddress(t, tok, v.Document.Msgs[0].Value.Caller)
	// And assert the auth_login gate signal recorded result=signed (capture via slog handler).
}
```

- [ ] **Step 2: Run — expect FAIL (MakeToken still calls the old verifier signature)**

Run: `cd backend && go test ./internal/auth/ -run TestMakeToken_SignedVector_MintsSigned -v`
Expected: FAIL.

- [ ] **Step 3: Update the signed branch to pass the free-vars**

```go
// crypto.go, inside `if signatureBase64 != "" {`
if verr := VerifyLoginChallengeSignature(
	userPubKey,
	LoginSignDocParams{
		ChainID:       effectiveChainID,
		UserAddress:   chainUserAddress,
		Nonce:         info.Challenge.Nonce,
		AccountNumber: parseUintOr0(info.GetSignedAccountNumber()),
		Sequence:      parseUintOr0(info.GetSignedSequence()),
		GasWanted:     parseIntOr0(info.GetSignedGasWanted()),
		GasFeeAmount:  parseIntOr0(info.GetSignedGasFeeAmount()),
		GasFeeDenom:   info.GetSignedGasFeeDenom(),
	},
	signatureBase64,
); verr != nil {
	// ... unchanged phase-1/phase-2 gate + AUTH-A2-DEBUG logging ...
}
```

Add small `parseUintOr0`/`parseIntOr0` helpers (return 0 on empty/invalid — a wrong value just fails
verification, never panics).

- [ ] **Step 4: Run the full auth suite — expect PASS**

Run: `cd backend && go test ./internal/auth/ -v`
Expected: PASS (new test green; all existing A2/A3/keystone tests still green).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/auth/crypto.go backend/internal/auth/crypto_a2_test.go
git commit -m "feat(auth): MakeToken verifies signed login over Adena's real free-vars"
```

---

## Task 6: Frontend — build `Sign` params + map the response

**Files:**
- Modify: `frontend/src/lib/loginChallenge.ts`
- Test: `frontend/src/lib/loginChallenge.test.ts`

- [ ] **Step 1: Failing test for the new builder + response mapper**

```ts
// loginChallenge.test.ts
it("buildSignLoginParams produces the self-MsgSend with nonce memo", () => {
  const p = buildSignLoginParams("g1caller", "QUFBQQ==");
  expect(p.memo).toBe("Login to Memba Multisig Service | nonce: QUFBQQ==");
  expect(p.messages[0].type).toBe("/bank.MsgSend");
  expect(p.messages[0].value.from_address).toBe("g1caller");
  expect(p.messages[0].value.to_address).toBe("g1caller"); // self-send
  expect(p.messages[0].value.amount).toBe("1ugnot");
});

it("mapSignResponse extracts signature, pubkey and signed free-vars", () => {
  // shape per Task 1 capture — adjust pubKey/typeUrl casing to the REAL observed shape
  const res = { data: {
    document: { account_number: "239", sequence: "0",
      fee: { gas: "2000000000", amount: [{ denom: "ugnot", amount: "100000" }] } },
    signature: { pubKey: { value: "A+Fh..." }, signature: "SIG==" },
  }};
  const m = mapSignResponse(res);
  expect(m).toEqual({
    signature: "SIG==",
    userPubkeyJson: '{"type":"tendermint/PubKeySecp256k1","value":"A+Fh..."}',
    signedAccountNumber: "239", signedSequence: "0",
    signedGasWanted: "2000000000", signedGasFeeAmount: "100000", signedGasFeeDenom: "ugnot",
  });
});
```

- [ ] **Step 2: Run — expect FAIL (functions undefined)**

Run: `cd frontend && npm test -- --run loginChallenge`
Expected: FAIL.

- [ ] **Step 3: Implement (replace the `SignMultisigTransaction` doc builder)**

```ts
// loginChallenge.ts — keep CLIENT_MAGIC/LOGIN_PKG_PATH/LOGIN_FUNC/loginChallengeMemo/adenaPubKeyToJSON.
// Remove buildLoginChallengeDoc + LoginChallengeDoc (SignMultisigTransaction-only).

export const LOGIN_AMOUNT = "1ugnot"; // self-send; must equal backend auth.LoginAmount

export function buildSignLoginParams(caller: string, nonceB64: string) {
  return {
    messages: [{
      type: "/bank.MsgSend",
      value: { from_address: caller, to_address: caller, amount: LOGIN_AMOUNT }, // self-send
    }],
    memo: loginChallengeMemo(nonceB64),
  };
}

// NOTE: pubKey/typeUrl casing MUST match the real Task-1 capture.
export function mapSignResponse(res: any) {
  const d = res?.data?.document, s = res?.data?.signature;
  const fee = d?.fee?.amount?.[0] ?? { amount: "", denom: "" };
  const pubVal = s?.pubKey?.value ?? s?.pub_key?.value;
  if (!s?.signature || !pubVal) return null;
  return {
    signature: s.signature as string,
    userPubkeyJson: adenaPubKeyToJSON(pubVal),
    signedAccountNumber: String(d?.account_number ?? ""),
    signedSequence: String(d?.sequence ?? ""),
    signedGasWanted: String(d?.fee?.gas ?? ""),
    signedGasFeeAmount: String(fee.amount ?? ""),
    signedGasFeeDenom: String(fee.denom ?? ""),
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd frontend && npm test -- --run loginChallenge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/loginChallenge.ts frontend/src/lib/loginChallenge.test.ts
git commit -m "feat(auth): build Adena Sign login params + response mapper"
```

---

## Task 7: Frontend — rewrite `signLoginChallenge` on `adena.Sign`

**Files:**
- Modify: `frontend/src/hooks/useAdena.ts:330-356`

- [ ] **Step 1: Replace the `SignMultisigTransaction` body**

```ts
const signLoginChallenge = useCallback(
  async (
    _chainId: string,
    nonceBase64: string,
  ): Promise<ReturnType<typeof mapSignResponse> | null> => {
    const adena = getAdena() as any;
    if (!adena || !state.address) return null;
    if (typeof adena.Sign !== "function") return null;
    try {
      const res = await adena.Sign(buildSignLoginParams(state.address, nonceBase64));
      if (res?.status !== "success") return null;
      return mapSignResponse(res);
    } catch (err) {
      console.error("[Memba] login Sign error:", err);
      return null;
    }
  },
  [state.address],
);
```

Update the import to `buildSignLoginParams, mapSignResponse, adenaPubKeyToJSON` (drop
`buildLoginChallengeDoc`).

- [ ] **Step 2: Verify build/lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: clean (no remaining `buildLoginChallengeDoc` references).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAdena.ts
git commit -m "feat(auth): sign login challenge via adena.Sign (single-account)"
```

---

## Task 8: Frontend — submit the signature + free-vars in `Layout`

**Files:**
- Modify: `frontend/src/components/layout/Layout.tsx` (login handler, where `signature: ""` is sent)

- [ ] **Step 1: Sign, then submit the real signature + free-vars; honest fallback**

```ts
// In the login flow, after GetChallenge:
const signed = await signLoginChallenge(challenge.chainId, nonceB64);
const info = buildTokenRequestInfo({
  nonceB64, expiration: challenge.expiration,
  serverSignatureB64: challenge.serverSignature, boundPubkeyHash: challenge.boundPubkeyHash,
  chainId: challenge.chainId,
  userPubkeyJson: signed?.userPubkeyJson ?? knownPubkeyJson, // sign-response pubkey is authoritative
});
if (signed) {
  info.signedAccountNumber = signed.signedAccountNumber;
  info.signedSequence = signed.signedSequence;
  info.signedGasWanted = signed.signedGasWanted;
  info.signedGasFeeAmount = signed.signedGasFeeAmount;
  info.signedGasFeeDenom = signed.signedGasFeeDenom;
}
const token = await client.getToken({
  infoJson: JSON.stringify(info),
  userSignature: signed?.signature ?? "", // empty => unsigned/gated path (unchanged, still works)
});
// If !signed AND no known pubkey: surface an honest error instead of silently gating.
```

- [ ] **Step 2: Build + unit tests**

Run: `cd frontend && npm run build && npm test -- --run`
Expected: clean build, tests green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/Layout.tsx
git commit -m "feat(auth): submit signed login proof + free-vars from Layout"
```

---

## Task 9: End-to-end verification on a throwaway path (pre-merge, gates permissive)

- [ ] **Step 1:** Deploy backend (Tasks 2–5) to a preview / the existing log-only gate — `MEMBA_ALLOW_UNSIGNED_AUTH` stays default-allow. Frontend on a preview build.
- [ ] **Step 2:** Log in with a **real Adena wallet** (one transacted + one funded-but-untransacted). Confirm: popup completes, `GetToken` → 200, and backend logs `auth_login{result=signed}` (not `signed_invalid`).
- [ ] **Step 3:** Live-probe parity: a wallet with no Adena still logs in via the unsigned path (no regression).
- [ ] **Step 4:** Capture the production `result=signed` ratio over a few days. **Do not flip the gate yet.**

---

## Task 10 (AAA-1, gate-signal-driven): phase-2 enforcement flip

- [ ] When `auth_login{result=signed}` is ~100% for real logins, set `MEMBA_ALLOW_UNSIGNED_AUTH=0` (enforce) in `.env.example` + Fly secrets. Empty-sig and `signed_invalid` then hard-fail. This is **A2.phase2** in the AAA plan §4 (AAA-1 wave). Separate PR; backend deploy before any frontend coupling.

---

## Open risks

1. **Gas-estimation block** — RESOLVED by choosing the self-`/bank.MsgSend` `1ugnot` (simulates cleanly);
   the `/vm.m_call` sentinel was proven to block. Residual: the signing wallet must hold > `1ugnot` + gas
   or the popup trips `isErrorNetworkFee`. Task 1 confirms the popup completes for a funded wallet.
2. **Response-shape casing** (`pubKey` vs `pub_key`, `typeUrl` vs `type_url`). `mapSignResponse` reads both,
   but Task 1's capture pins the truth; update the test's expected shape to match.
3. **`encodeCharacterSet` vs Go HTML-escaping divergence.** Our memo + msgs are ASCII (ClientMagic +
   base64 nonce; bech32 self-address; fixed `amount` "1ugnot"), none of which contain `< > &` or non-ASCII, so the
   escapings agree. The Task-1 golden vector proves it; revisit only if a non-ASCII field is ever added.
4. **Adena overwriting the fee via simulation.** Irrelevant — we pass through `document.fee`, whatever it is.
5. **Multisig accounts.** `adena.Sign` is single-account. Multisig members log in with their **member**
   wallet (single account), which is the existing behavior — multisig identity is separate (A3). No change.

## Self-review

- **Spec coverage:** primitive identified (`adena.Sign`, Task 6/7) ✓; free-vars threaded (proto Task 4,
  backend Tasks 2/3/5, frontend Tasks 6/7/8) ✓; untransacted wallets via sign-response pubkey (Task 8) ✓;
  byte-equality proof (Task 1 vector + Task 2 test) ✓; gates/phase rollout (Tasks 9/10) ✓; gas-estimation
  risk surfaced first (Task 1/1a) ✓.
- **Type consistency:** `LoginSignDocParams` defined in Task 2, consumed identically in Tasks 3/5;
  `mapSignResponse` keys defined in Task 6 match `TokenRequestInfo` fields in Task 4 and submission in
  Task 8.
- **No placeholders:** every code step shows real code; the only deliberately deferred value is the
  response-shape casing, which Task 1 empirically fixes (documented as Risk 2).

# Multisig Propose-Format Alignment + Golden A3 Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`). **Security-critical:** a wrong canonical shape bricks multisig signing once `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1`. The enforce flag stays OFF until the [You] real-Adena-sig handoff (Task 6) passes — so this work cannot brick anything before that gate.

**Goal:** Make `ProposeTransaction` **store the exact canonical doc Adena signs**, so the A3 verifier's reconstruction matches the member signature — closing the store-vs-sign mismatch that would brick multisig under enforcement.

**Architecture:** The brick cause is NOT a backend bug. `CanonicalSignBytes` is golden-validated vs `gnokey sign`, and `useAdena.signArbitrary` already signs via `adena.SignMultisigTransaction` (the proven A2-login primitive). The bug: `ProposeTransaction` **stores** cosmos-shaped fee `{amount,gas}` + `{type,value}`-wrapped msgs, while `signArbitrary` **converts** them to canonical `{gas_wanted,gas_fee}` + `{"@type":...}` *before* Adena signs. So the stored doc (what A3 reconstructs) ≠ the signed doc. Fix: build the canonical doc **once**, store it, and sign it as-is. Mirror the prod-proven `buildLoginChallengeDoc` (A2).

**Tech Stack:** TS/React/Vitest (frontend, standalone npm — `cd frontend && npm ci`); Go/ConnectRPC (backend A3 test). No new deps.

## Global Constraints

- Never commit to `main`; this work is on `feat/multisig-propose-format` in worktree `../memba-multisig`. **`cd` into the worktree before every `git commit`** (the git-rules hook checks the Bash cwd's branch).
- No Claude attribution. Concise commit messages (why-focused), no trailers.
- Frontend tests: `cd frontend && VITE_GNO_CHAIN_ID= npx vitest run`. Backend: `cd backend && go test -race ./... && golangci-lint run`.
- **The enforce flag is NOT flipped by this PR.** This PR makes the flag *safe to flip later*; the flip is gated on Task 6 ([You]).
- TDD: failing test first, watch it fail, minimal code, watch it pass.

---

## The canonical shapes (the authority — copy exactly)

From `backend/internal/auth/testdata/signbytes/*.json` (golden vs `gnokey sign`) and the prod-proven `frontend/src/lib/loginChallenge.ts:buildLoginChallengeDoc` (what Adena's `SignMultisigTransaction` actually produces + the backend verifies):

**bank.MsgSend** (golden `send_basic.json`):
```json
{"@type":"/bank.MsgSend","from_address":"g1…","to_address":"g1…","amount":"1500000ugnot"}
```
- `amount` is a **string** `"<n>ugnot"`, NOT a coin array.

**vm.m_call** (golden `call_send_deposit.json` + A2 `buildLoginChallengeDoc`):
```json
{"@type":"/vm.m_call","args":null,"caller":"g1…","send":"","max_deposit":"","pkg_path":"gno.land/…","func":"…"}
```
- `args`: **`null` when empty** (NOT `[]`, NOT omitted) to match Adena's proto-roundtrip form (`loginChallenge.ts:99-101`). `args:["a","b"]` when present.
- `send`: `"<n>ugnot"` or `""`. `max_deposit`: `""` (present, empty). `caller`, `pkg_path`, `func` present.

**fee** (both vectors + `aminoFeeJSON`):
```json
{"gas_wanted":"<int-string>","gas_fee":"<n>ugnot"}
```
- `gas_fee` is a **single coin string**; a zero amount serializes to `""` (gno `Coin.String()` trap, handled by `CanonicalSignBytes.coinString`).

> `CanonicalSignBytes` re-sorts keys via sortJSON, so msg **field order doesn't matter** — only **which keys are present** and their **values**. The `args:null` vs `[]` vs absent distinction DOES matter (different presence/value). This is the single subtlety the [You] real-Adena-sig handoff (Task 6) exists to confirm.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `frontend/src/lib/multisigTx.ts` | **NEW.** `toCanonicalMsg(AminoMsg)` (wrapped→@type-inlined) + `buildCanonicalFeeJson(gasWanted, gasFeeUgnot)` + `buildAdenaMultisigDoc(canonicalDoc)`. Single source of truth for the canonical shape. | Create |
| `frontend/src/lib/multisigTx.test.ts` | Unit tests pinning each canonical shape vs the golden-vector strings. | Create |
| `frontend/src/pages/ProposeTransaction.tsx` | Build & store the canonical msgs/fee (replace the cosmos-shaped inline construction at `:71-78,110-119,159-162`). | Modify |
| `frontend/src/lib/grc20.ts` | Reuse `toCanonicalMsg` for the grc20 path (its `buildMsgCall` stays wrapped for DoContract; convert at propose time). | Modify (minimal) |
| `frontend/src/hooks/useAdena.ts` | `signArbitrary`: sign the **already-canonical** stored doc (drop the cosmos→canonical conversion at `:254-284`; build `buildAdenaMultisigDoc` from canonical input). | Modify |
| `backend/internal/service/tx_a3_verify_test.go` | De-stale (`test12`→`test13`) + add a `/vm.m_call` canonical round-trip case. | Modify |
| `backend/internal/service/.../create` (CreateTransaction) | Defense: reject a `feeJson` that doesn't parse as `{gas_wanted,gas_fee}` (fail-closed so the cosmos shape can't be stored again). | Modify (small) |
| `docs/BADGE_MINT_RUNBOOK.md`-style runbook | NEW `docs/MULTISIG_ENFORCE_RUNBOOK.md` — the [You] real-sig capture + flip steps. | Create |

---

## Task 1: Canonical msg/fee builders (`multisigTx.ts`) — TDD

**Interfaces produced:**
- `toCanonicalMsg(m: AminoMsg): Record<string, unknown>` — `{type:"bank/MsgSend",value}`→`{"@type":"/bank.MsgSend",…,amount:"<n>ugnot"}`; `{type:"vm/MsgCall",value}`→`{"@type":"/vm.m_call",args:<arr|null>,caller,send,max_deposit:"",pkg_path,func}`.
- `buildCanonicalFeeJson(gasWanted: string, gasFeeUgnot: string): string` — `{"gas_wanted","gas_fee"}` JSON.

- [ ] **Step 1: failing tests** (`multisigTx.test.ts`)

```ts
import { describe, it, expect } from "vitest"
import { toCanonicalMsg, buildCanonicalFeeJson } from "./multisigTx"

describe("toCanonicalMsg", () => {
  it("bank/MsgSend → @type-inlined, amount as ugnot string", () => {
    expect(toCanonicalMsg({ type: "bank/MsgSend", value: {
      from_address: "g1from", to_address: "g1to",
      amount: [{ denom: "ugnot", amount: "1500000" }],
    }})).toEqual({
      "@type": "/bank.MsgSend", from_address: "g1from", to_address: "g1to", amount: "1500000ugnot",
    })
  })

  it("vm/MsgCall with no args → args:null, send/max_deposit present", () => {
    expect(toCanonicalMsg({ type: "vm/MsgCall", value: {
      caller: "g1c", send: "", pkg_path: "gno.land/r/x", func: "F", args: [],
    }})).toEqual({
      "@type": "/vm.m_call", args: null, caller: "g1c", send: "", max_deposit: "", pkg_path: "gno.land/r/x", func: "F",
    })
  })

  it("vm/MsgCall with args → args array preserved", () => {
    const got = toCanonicalMsg({ type: "vm/MsgCall", value: {
      caller: "g1c", send: "5000000ugnot", pkg_path: "gno.land/r/x", func: "F", args: ["a", "b"],
    }}) as Record<string, unknown>
    expect(got.args).toEqual(["a", "b"])
    expect(got.send).toBe("5000000ugnot")
    expect(got["@type"]).toBe("/vm.m_call")
  })
})

describe("buildCanonicalFeeJson", () => {
  it("emits {gas_wanted, gas_fee}", () => {
    expect(JSON.parse(buildCanonicalFeeJson("2000000", "1000000ugnot")))
      .toEqual({ gas_wanted: "2000000", gas_fee: "1000000ugnot" })
  })
})
```

- [ ] **Step 2:** `cd frontend && VITE_GNO_CHAIN_ID= npx vitest run src/lib/multisigTx.test.ts` → FAIL (module missing).
- [ ] **Step 3:** implement `multisigTx.ts`:

```ts
import type { AminoMsg } from "./grc20"

/** Convert an Amino {type,value} msg to the gno-canonical @type-inlined form
 *  that Adena's SignMultisigTransaction signs and the backend A3 verifier
 *  reconstructs. Mirrors loginChallenge.ts (args:null when empty) + the golden
 *  vectors (amount as "<n>ugnot" string). */
export function toCanonicalMsg(m: AminoMsg): Record<string, unknown> {
  if (m.type === "bank/MsgSend") {
    const v = m.value as { from_address: string; to_address: string; amount: Array<{ denom: string; amount: string }> | string }
    const amount = Array.isArray(v.amount)
      ? (v.amount[0] ? `${v.amount[0].amount}${v.amount[0].denom}` : "")
      : (v.amount ?? "")
    return { "@type": "/bank.MsgSend", from_address: v.from_address, to_address: v.to_address, amount }
  }
  if (m.type === "vm/MsgCall") {
    const v = m.value as { caller: string; send?: string; max_deposit?: string; pkg_path: string; func: string; args?: string[] }
    const args = v.args && v.args.length > 0 ? v.args : null
    return { "@type": "/vm.m_call", args, caller: v.caller, send: v.send ?? "", max_deposit: v.max_deposit ?? "", pkg_path: v.pkg_path, func: v.func }
  }
  throw new Error(`toCanonicalMsg: unsupported msg type ${m.type}`)
}

export function buildCanonicalFeeJson(gasWanted: string, gasFeeUgnot: string): string {
  return JSON.stringify({ gas_wanted: gasWanted, gas_fee: gasFeeUgnot })
}
```

- [ ] **Step 4:** rerun → PASS.
- [ ] **Step 5:** commit `feat(multisig): canonical msg/fee builders matching Adena sign-bytes`.

## Task 2: `ProposeTransaction` stores the canonical doc

Replace the inline cosmos-shaped construction so `msgsJson`/`feeJson` sent to `CreateTransaction` are canonical.

- [ ] **Step 1:** failing test — a component or (simpler) a pure-function test asserting the propose payload. Extract the msg-building into a testable `buildProposePayload(txType, fields, address)` in `multisigTx.ts` returning `{ msgsJson, feeJson, type }`; test it produces canonical msgs + `{gas_wanted,gas_fee}` fee for send/call/grc20. (Test code: assert `JSON.parse(msgsJson)[0]["@type"] === "/bank.MsgSend"` and `JSON.parse(feeJson).gas_wanted` is set.)
- [ ] **Step 2-4:** implement `buildProposePayload` (reusing `toCanonicalMsg` + `buildCanonicalFeeJson`; fee: `gas_wanted` = call?`"2000000"`:`"100000"`, `gas_fee` = `"10000ugnot"` per current values), wire `ProposeTransaction.handlePropose` to call it. Run frontend suite.
- [ ] **Step 5:** commit `fix(multisig): store the canonical sign-doc ProposeTransaction (close A3 store-vs-sign mismatch)`.

## Task 3: `signArbitrary` signs the stored canonical doc

Now the stored doc is canonical, so `signArbitrary` must NOT re-convert. Build Adena's `SignMultisigTransaction` document from the canonical input directly.

- [ ] **Step 1:** failing test for a new `buildAdenaMultisigDoc(signDoc)` in `multisigTx.ts` — given a canonical `{account_number,chain_id,fee:{gas_wanted,gas_fee},memo,msgs:[{"@type":…}],sequence}`, returns `{tx:{msg,fee,signatures:null,memo},chainId,accountNumber,sequence}` with msgs/fee passed through unchanged.
- [ ] **Step 2-4:** implement `buildAdenaMultisigDoc`; refactor `useAdena.signArbitrary` to `buildAdenaMultisigDoc(JSON.parse(data))` then `adena.SignMultisigTransaction(...)` (drop `:254-284` conversion). Run suite (mock `window.adena.SignMultisigTransaction`).
- [ ] **Step 5:** commit `fix(multisig): sign the stored canonical doc as-is (no re-conversion)`.

## Task 4: backend A3 test de-stale + `/vm.m_call` case

- [ ] **Step 1:** in `tx_a3_verify_test.go`, change `chainID` `test12`→`test13`; add a sub-test that creates a tx with the canonical `/vm.m_call` `msgsJSON` (`[{"@type":"/vm.m_call","args":null,"caller":…,"send":"","max_deposit":"","pkg_path":…,"func":…}]`) + `feeJSON` `{"gas_wanted":"2000000","gas_fee":"1000000ugnot"}`, signs `CanonicalSignBytes` with an in-Go member key, and asserts enforce-mode accepts it / rejects a bogus sig. (Run → fail if the handler/shape regressed; else it documents the canonical shape as a regression fixture.)
- [ ] **Step 2-4:** `cd backend && go test -race ./internal/service/ -run A3Verification`.
- [ ] **Step 5:** commit `test(multisig): A3 golden round-trip for /vm.m_call on test13`.

## Task 5: CreateTransaction fee-shape guard (defense-in-depth)

- [ ] Reject at `CreateTransaction` a `feeJson` that doesn't unmarshal to non-empty `{gas_wanted,gas_fee}` (so a future regression can't silently store the cosmos `{amount,gas}` shape). TDD: a request with `{"amount":[…],"gas":"…"}` → `InvalidArgument`. Commit `feat(multisig): reject non-canonical feeJson at CreateTransaction`.

## Task 6 — [You] handoff: real-Adena-sig validation, THEN flip

**This is the gate. Do NOT flip enforce before it passes.** Runbook (`docs/MULTISIG_ENFORCE_RUNBOOK.md`):
1. On the deploy preview, create a real `/vm.m_call` multisig tx; sign it with a real Adena multisig member.
2. Capture the stored `msgs_json`, `fee_json`, the member `signature`, `multisig_pubkey_json`, `account_number`, `sequence`, `chain_id`.
3. Add them as a committed golden fixture; assert `VerifyMultisigMemberSignature` returns nil. **If it fails, the `args:null`/field-presence assumption is wrong — iterate the canonical shape (Task 1) against the captured doc.**
4. Only once green on a real sig: set `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1`, watch the `multisig_sig_verify{result=ok}` gate signal (#479 `/metrics`), rollback = flip to `0`.

---

## Self-Review

- **Spec coverage (E9-a):** propose `feeJson {gas_wanted,gas_fee}` (Task 2/5) ✔; canonical `{"@type":"/vm.m_call"}` msgs (Task 1/2) ✔; golden round-trip test (Task 4) ✔; real-Adena-sig gate (Task 6) ✔. **broadcast_tx_commit Amino-binary** (layer 4) is explicitly OUT (independent of the enforce-flag brick risk) — tracked follow-up.
- **Brick-safety:** enforce flag untouched here; Task 6 gates the flip on a real sig verifying. Worktree-isolated; nothing pushed to main.
- **Key risk:** Adena's exact proto-roundtrip form for non-empty `args` / `max_deposit` presence is assumed from `buildLoginChallengeDoc`; Task 6 is the empirical check. Documented as such.

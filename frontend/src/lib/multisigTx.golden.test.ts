// A3 frontend↔chain golden parity — pins the frontend multisig builders against
// the REAL gnokey sign-bytes vectors in backend/internal/auth/testdata/signbytes/.
//
// The chain of proof for MEMBA_ENFORCE_MULTISIG_SIG_VERIFY:
//   1. backend CanonicalSignBytes == gnokey bytes — proven by a real gnokey
//      signature verifying over the reconstruction (signbytes_test.go, all vectors).
//   2. frontend stored doc == the doc gnokey signed — THIS file: the builders must
//      reproduce the frontend_*_parity vectors' unsigned_tx field-for-field.
//   3. Adena signs the stored doc — structural: useAdena.signArbitrary parses the
//      stored doc and hands it to Adena's SignMultisigTransaction unchanged
//      (buildAdenaMultisigDoc passthrough, asserted below); Adena's own serializer
//      is the residual risk, covered by the prod-proven A2 login path (same API,
//      same canonicalization) and the retro sweep metric over real signature rows.
//
// Comparison is deep-equality on PARSED JSON, not byte-equality of the stored
// strings: both Adena and the backend re-serialize with sorted keys (sortJSON),
// so stored key ORDER is canonical-irrelevant; field NAMES/VALUES/presence are
// what must match exactly (send:"" and max_deposit:"" present, args null-vs-list,
// coin STRINGS not arrays).

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildAdenaMultisigDoc, buildCanonicalProposePayload, type CanonicalSignDoc } from "./multisigTx"
import type { AminoMsg } from "./grc20"

const fixturesDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../backend/internal/auth/testdata/signbytes",
)

interface SignBytesFixture {
    description: string
    chain_id: string
    account_number: number
    account_sequence: number
    unsigned_tx: {
        msg: Array<Record<string, unknown>>
        fee: { gas_wanted: string; gas_fee: string }
        signatures: null
        memo: string
    }
    pub_key_b64: string
    signature_b64: string
}

function loadFixture(name: string): SignBytesFixture {
    return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf-8")) as SignBytesFixture
}

describe("frontend_send_parity — bank/MsgSend stored shape == gnokey-signed doc", () => {
    const f = loadFixture("frontend_send_parity")

    it("was generated for the on-wire test13 chain id (hyphen)", () => {
        expect(f.chain_id).toBe("test-13")
    })

    it("buildCanonicalProposePayload reproduces the signed msg and fee", () => {
        const amino: AminoMsg = {
            type: "bank/MsgSend",
            value: {
                from_address: f.unsigned_tx.msg[0].from_address,
                to_address: f.unsigned_tx.msg[0].to_address,
                amount: [{ denom: "ugnot", amount: "1500000" }],
            },
        }
        const { msgsJson, feeJson } = buildCanonicalProposePayload([amino], false)
        expect(JSON.parse(msgsJson)).toEqual(f.unsigned_tx.msg)
        expect(JSON.parse(feeJson)).toEqual(f.unsigned_tx.fee)
    })
})

describe("frontend_call_parity — vm/MsgCall stored shape == gnokey-signed doc", () => {
    const f = loadFixture("frontend_call_parity")

    it("buildCanonicalProposePayload reproduces the signed msg and fee (args list, empty send/max_deposit present)", () => {
        const amino: AminoMsg = {
            type: "vm/MsgCall",
            value: {
                caller: f.unsigned_tx.msg[0].caller,
                pkg_path: f.unsigned_tx.msg[0].pkg_path,
                func: f.unsigned_tx.msg[0].func,
                args: ["1", "yes"],
            },
        }
        const { msgsJson, feeJson } = buildCanonicalProposePayload([amino], true)
        expect(JSON.parse(msgsJson)).toEqual(f.unsigned_tx.msg)
        expect(JSON.parse(feeJson)).toEqual(f.unsigned_tx.fee)
    })

    it("buildAdenaMultisigDoc hands Adena exactly the fields gnokey signed", () => {
        // The sign-doc TransactionView.buildSignDoc assembles from the STORED
        // columns for this tx — account_number/sequence as strings, parsed
        // msgs/fee, memo defaulted to "".
        const signDoc: CanonicalSignDoc = {
            account_number: String(f.account_number),
            chain_id: f.chain_id,
            fee: f.unsigned_tx.fee,
            memo: f.unsigned_tx.memo,
            msgs: f.unsigned_tx.msg,
            sequence: String(f.account_sequence),
        }
        expect(buildAdenaMultisigDoc(signDoc)).toEqual({
            tx: {
                msg: f.unsigned_tx.msg,
                fee: f.unsigned_tx.fee,
                signatures: null,
                memo: f.unsigned_tx.memo,
            },
            chainId: "test-13",
            accountNumber: String(f.account_number),
            sequence: String(f.account_sequence),
        })
    })
})

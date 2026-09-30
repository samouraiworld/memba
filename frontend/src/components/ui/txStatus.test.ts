import { describe, expect, it } from "vitest"
import type { Transaction } from "../../gen/memba/v1/memba_pb"
import { getMultisigStatus } from "./txStatus"

const nativeKey = '{"@type":"/tm.PubKeyMultisig"}'
const legacyKey = '{"type":"tendermint/PubKeyMultisigThreshold"}'
const row = (patch: Partial<Transaction>): Transaction => ({
    multisigPubkeyJson: nativeKey,
    finalHash: "",
    verified: false,
    threshold: 2,
    signatures: [],
    ...patch,
}) as Transaction

describe("multisig transaction status", () => {
    it("does not equate a recorded hash with a verified chain receipt", () => {
        expect(getMultisigStatus(row({ finalHash: "ABC", verified: false }))).toBe("unconfirmed")
        expect(getMultisigStatus(row({ finalHash: "ABC", verified: true }))).toBe("verified")
        // The chain executed it and refused it: closed, never "ready" again.
        expect(getMultisigStatus(row({ finalHash: "ABC", verified: false, onchainError: "insufficient coins" }), true)).toBe("failed")
        expect(getMultisigStatus(row({ multisigPubkeyJson: legacyKey, finalHash: "ABC", verified: true }))).toBe("legacy-hash")
    })

    it("never advertises a legacy quorum as ready to broadcast", () => {
        expect(getMultisigStatus(row({ multisigPubkeyJson: legacyKey, signatures: [{ verified: true }, { verified: true }] as Transaction["signatures"] }), true)).toBe("read-only")
    })
})

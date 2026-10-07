import { describe, expect, it } from "vitest"
import type { Transaction } from "../gen/memba/v1/memba_pb"
import { awaitingText, countAwaiting, sharedAwaitingText, waitsForSignature } from "./multisigAwaiting"

const NATIVE = '{"@type":"/tm.PubKeyMultisig"}'
const tx = (multisigAddress: string, signers: string[], extra: Partial<Transaction> = {}) =>
    ({ multisigAddress, multisigPubkeyJson: NATIVE, finalHash: "", threshold: 2, signatures: signers.map((userAddress) => ({ userAddress })), ...extra }) as unknown as Transaction

describe("proposals waiting for a member's signature", () => {
    it("counts native, unsent proposals short of their threshold that the member has not signed, per account", () => {
        const counts = countAwaiting([
            tx("g1a", ["g1bob"]), tx("g1a", []), tx("g1a", ["g1me"]), tx("g1a", ["g1bob", "g1carol"]),
            tx("g1b", ["g1bob"]), tx("g1b", [], { finalHash: "SENT" }), tx("g1b", [], { multisigPubkeyJson: "{}" }),
        ], "g1me")
        expect([...counts]).toEqual([["g1a", 2], ["g1b", 1]])
    })
    it("waits for nobody without a member", () => {
        expect(waitsForSignature(tx("g1a", []), "")).toBe(false)
    })
    it("words a joined account's count and a shared account's neutral count", () => {
        expect(awaitingText(1)).toBe("1 proposal waits for your signature")
        expect(awaitingText(2)).toBe("2 proposals wait for your signature")
        expect(sharedAwaitingText(1)).toBe("1 proposal waits in a multisig shared with you")
        expect(sharedAwaitingText(3)).toBe("3 proposals wait in a multisig shared with you")
    })
})

import { describe, expect, it } from "vitest"
import { describeTx, formatEth } from "./describe"

const TO = "0x1111111111111111111111111111111111111111" as const

describe("Safe transactions in words", () => {
    it("formats wei as exact ETH", () => {
        expect(formatEth(0n)).toBe("0 ETH")
        expect(formatEth(1n)).toBe("0.000000000000000001 ETH")
        expect(formatEth(1_500_000_000_000_000_000n)).toBe("1.5 ETH")
        expect(formatEth(1234n * 10n ** 18n)).toBe("1,234 ETH")
    })

    it("names payments, approvals, settings, batches, rejections and what it can't read, with full addresses", () => {
        expect(describeTx({ kind: "native-transfer", to: TO, value: 10n ** 18n, severity: "normal" })).toEqual({ title: "Send 1 ETH", detail: `to ${TO}` })
        expect(describeTx({ kind: "erc20-transfer", token: TO, to: TO, amount: 42n, severity: "normal" }).detail).toBe(`42 base units of token ${TO} to ${TO}`)
        expect(describeTx({ kind: "erc20-approve", token: TO, spender: TO, amount: 1n, unlimited: true, severity: "caution" }).title).toBe("Approve unlimited token spending")
        expect(describeTx({ kind: "erc20-approve", token: TO, spender: TO, amount: 0n, unlimited: false, severity: "normal" }).title).toBe("Revoke a token approval")
        expect(describeTx({ kind: "safe-setting", setting: "addOwnerWithThreshold", addresses: [TO], threshold: 2n, severity: "danger" }))
            .toEqual({ title: "Add an owner", detail: `${TO} · threshold 2 · changes who controls this Safe` })
        expect(describeTx({ kind: "batch", via: "multiSendCallOnly", severity: "normal", calls: [{ kind: "native-transfer", to: TO, value: 1n, severity: "normal" }, { kind: "no-op", to: TO, severity: "caution" }] }))
            .toEqual({ title: "Batch of 2", detail: "Send 0.000000000000000001 ETH · Empty call" })
        expect(describeTx({ kind: "no-op", to: TO, severity: "normal" }).title).toBe("Rejection")
        expect(describeTx({ kind: "delegatecall", to: TO, data: "0x", severity: "danger" }).detail).toMatch(/full control/)
        expect(describeTx({ kind: "undecodable", to: TO, data: "0x", reason: "truncated batch entry", severity: "danger" }).detail).toMatch(/truncated batch entry/)
        expect(describeTx({ kind: "contract-call", to: TO, value: 5n, selector: "0x12345678", data: "0x12345678", severity: "caution" }).detail).toBe(`${TO} · function 0x12345678 · 0.000000000000000005 ETH`)
    })
})

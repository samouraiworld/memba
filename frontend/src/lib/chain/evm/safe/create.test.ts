import { describe, expect, it } from "vitest"
import { encodeFunctionData, parseAbi, type Hex } from "viem"
import { assertDeployment, randomSalt, SafeCreateError } from "./create"

const FACTORY: Hex = "0x14F2982D601c9458F93bd70B218933A6f8165e7b"
const SAFE_L2: Hex = "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e"
const SAFE_L1: Hex = "0xFf51A5898e281Db6DfC7855790607438dF2ca44b"
const HANDLER: Hex = "0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4"
const ZERO: Hex = "0x0000000000000000000000000000000000000000"
const A: Hex = "0xa11ce00000000000000000000000000000000001"
const B: Hex = "0xb0b0000000000000000000000000000000000002"

const abi = parseAbi([
    "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
    "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
])

type Setup = [Hex[], bigint, Hex, Hex, Hex, Hex, bigint, Hex]
const goodSetup: Setup = [[A, B], 2n, ZERO, "0x", HANDLER, ZERO, 0n, ZERO]

function deployment(over: { singleton?: Hex; setup?: Partial<Record<number, unknown>>; salt?: bigint; to?: Hex; value?: bigint } = {}) {
    const setup = goodSetup.map((v, i) => (over.setup && i in over.setup ? over.setup[i] : v)) as Setup
    const initializer = encodeFunctionData({ abi, functionName: "setup", args: setup })
    return {
        to: over.to ?? FACTORY,
        value: over.value ?? 0n,
        data: encodeFunctionData({ abi, functionName: "createProxyWithNonce", args: [over.singleton ?? SAFE_L2, initializer, over.salt ?? 7n] }),
    }
}

function refusal(tx: ReturnType<typeof deployment>): string {
    try {
        assertDeployment(tx, [A, B], 2, 7n)
    } catch (err) {
        if (err instanceof SafeCreateError && err.reason.code === "unexpected-deployment") return err.reason.detail
        throw err
    }
    return "accepted"
}

describe("checking a Safe deployment before the wallet sees it", () => {
    it("accepts exactly the requested SafeL2 1.5.0, whatever the address case", () => {
        expect(refusal(deployment())).toBe("accepted")
        expect(refusal({ ...deployment(), to: FACTORY.toLowerCase() as Hex })).toBe("accepted")
    })

    it("refuses another factory, value, singleton or salt", () => {
        expect(refusal(deployment({ to: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67" }))).toBe("not the Safe proxy factory 1.5.0")
        expect(refusal(deployment({ value: 1n }))).toBe("the deployment sends value")
        expect(refusal(deployment({ singleton: SAFE_L1 }))).toBe("not the SafeL2 1.5.0 singleton")
        expect(refusal(deployment({ salt: 8n }))).toBe("another salt")
        expect(refusal({ ...deployment(), data: "0x12345678" })).toBe("not a createProxyWithNonce call")
    })

    it("refuses other owners or order, threshold, a setup call, another handler, or a payment", () => {
        expect(refusal(deployment({ setup: { 0: [B, A] } }))).toBe("other owners")
        expect(refusal(deployment({ setup: { 0: [A] } }))).toBe("other owners")
        expect(refusal(deployment({ setup: { 1: 1n } }))).toBe("another threshold")
        expect(refusal(deployment({ setup: { 2: B, 3: "0x1234" } }))).toBe("a setup call (modules) is included")
        expect(refusal(deployment({ setup: { 3: "0x12" } }))).toBe("a setup call (modules) is included")
        expect(refusal(deployment({ setup: { 4: "0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4" } }))).toBe("another fallback handler")
        expect(refusal(deployment({ setup: { 5: B } }))).toBe("a payment is included")
        expect(refusal(deployment({ setup: { 6: 1n } }))).toBe("a payment is included")
        expect(refusal(deployment({ setup: { 7: B } }))).toBe("a payment is included")
    })

    it("draws a new 256-bit salt each time", () => {
        const a = randomSalt(), b = randomSalt()
        expect(a).not.toBe(b)
        expect(a < 2n ** 256n && a >= 0n).toBe(true)
    })
})

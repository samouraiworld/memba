import { describe, expect, it, vi } from "vitest"
import { keccak256, toBytes, type Address, type Hex } from "viem"
import { evmContract } from "./manifest"
import { MEMBA_TOKEN } from "./membaToken.generated"
import {
    TOKEN_MAX_SUPPLY,
    planTokenDeploy,
    prepareTokenDeploy,
    randomSalt,
    splitSupply,
    tokenNameProblem,
    tokenSymbolProblem,
    type TokenPlanInput,
} from "./tokenDeploy"

// The vector of contracts/evm/test/fork/TokenLaunch.t.sol test_token_create2_from_eoa: the forge trace deploys
// `new MembaToken@0xD59529D1AaE4A563f2E91cC2C64d773Aee131B20`, and `cast create2` gives the same address.
const ALICE: Address = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7" // vm.addr(0xA11CE)
const TREASURY: Address = "0x81c423186385917b0811562b56D387cAC6C80F8E" // makeAddr("memba-team-safe")
const SALT: Hex = keccak256(toBytes("memba.phase0.token"))
const FORGE_INPUT: TokenPlanInput = {
    chainId: 84532,
    name: "Memba Phase0",
    symbol: "MP0",
    totalSupply: 1_000_000n * 10n ** 18n,
    creator: ALICE,
    treasury: TREASURY,
    salt: SALT,
}

describe("token deployment plan", () => {
    it("predicts the address the forge test deploys to, on both chains (same deployer)", () => {
        expect(planTokenDeploy(FORGE_INPUT).token).toBe("0xD59529D1AaE4A563f2E91cC2C64d773Aee131B20")
        expect(planTokenDeploy({ ...FORGE_INPUT, chainId: 8453 }).token).toBe("0xD59529D1AaE4A563f2E91cC2C64d773Aee131B20")
    })

    it("sends salt ++ initcode to the manifest's CREATE2 deployer, with the forge test's split", () => {
        const plan = planTokenDeploy(FORGE_INPUT)
        expect(plan.to).toBe(evmContract(84532, "create2Deployer"))
        expect(plan.data.slice(0, 66)).toBe(SALT)
        expect(plan.data.slice(66, 66 + MEMBA_TOKEN.bytecode.length - 2)).toBe(MEMBA_TOKEN.bytecode.slice(2))
        expect(plan.premint).toBe(995_000n * 10n ** 18n)
        expect(plan.fee).toBe(5_000n * 10n ** 18n)
    })

    it("changes the address with any argument, so a different token can never sit at a planned address", () => {
        const base = planTokenDeploy(FORGE_INPUT).token
        for (const change of [{ name: "Other" }, { symbol: "X" }, { totalSupply: 10n }, { treasury: ALICE }, { creator: TREASURY }, { salt: randomSalt() }]) {
            expect(planTokenDeploy({ ...FORGE_INPUT, ...change }).token).not.toBe(base)
        }
    })

    it("refuses names over 31 bytes, empty fields, bad addresses and salts", () => {
        expect(tokenNameProblem("Thirty-one bytes token name 31b")).toBeNull()
        expect(tokenNameProblem("Thirty-two bytes token name: 32b")).toMatch(/31 bytes/)
        expect(tokenNameProblem("é".repeat(16))).toMatch(/31 bytes/) // 16 characters, 32 bytes
        expect(tokenNameProblem("  ")).toMatch(/Enter a name/)
        expect(tokenSymbolProblem("")).toMatch(/Enter a symbol/)
        expect(() => planTokenDeploy({ ...FORGE_INPUT, name: "x".repeat(32) })).toThrow(/31 bytes/)
        expect(() => planTokenDeploy({ ...FORGE_INPUT, treasury: "0x0000000000000000000000000000000000000000" })).toThrow(/treasury/)
        expect(() => planTokenDeploy({ ...FORGE_INPUT, creator: "0x1234" as Address })).toThrow(/creator/)
        expect(() => planTokenDeploy({ ...FORGE_INPUT, salt: "0x12" })).toThrow(/32 bytes/)
        expect(() => planTokenDeploy({ ...FORGE_INPUT, chainId: 1 })).toThrow(/No EVM manifest/)
    })

    it("splits 0.5% to the treasury, rounding the fee down, within the voting-token cap", () => {
        expect(splitSupply(1000n)).toEqual({ premint: 995n, fee: 5n })
        expect(splitSupply(199n)).toEqual({ premint: 199n, fee: 0n })
        expect(splitSupply(TOKEN_MAX_SUPPLY).premint + splitSupply(TOKEN_MAX_SUPPLY).fee).toBe(TOKEN_MAX_SUPPLY)
        expect(() => splitSupply(0n)).toThrow(/above zero/)
        expect(() => splitSupply(TOKEN_MAX_SUPPLY + 1n)).toThrow(/2\^208/)
    })

    it("draws a fresh 32-byte salt each time", () => {
        const a = randomSalt()
        expect(a).toMatch(/^0x[0-9a-f]{64}$/)
        expect(randomSalt()).not.toBe(a)
    })
})

describe("prepareTokenDeploy", () => {
    const plan = planTokenDeploy(FORGE_INPUT)

    it("sends nothing when the token already exists (front-run or earlier attempt)", async () => {
        const client = { getChainId: vi.fn().mockResolvedValue(84532), getCode: vi.fn().mockResolvedValue("0x6080"), estimateGas: vi.fn() }
        await expect(prepareTokenDeploy(client, plan, ALICE)).resolves.toEqual({ kind: "deployed", token: plan.token })
        expect(client.estimateGas).not.toHaveBeenCalled()
    })

    it("returns the chain-bound write for sendEvmWrite once the estimate succeeds, when the address is empty", async () => {
        for (const empty of [undefined, "0x"]) {
            const client = { getChainId: vi.fn().mockResolvedValue(84532), getCode: vi.fn().mockResolvedValue(empty), estimateGas: vi.fn().mockResolvedValue(1_527_439n) }
            await expect(prepareTokenDeploy(client, plan, ALICE)).resolves.toEqual({
                kind: "send", token: plan.token, write: { chainId: 84532, to: plan.to, data: plan.data, value: 0n }, estimatedGas: 1_527_439n,
            })
            expect(client.estimateGas).toHaveBeenCalledWith({ account: ALICE, to: plan.to, data: plan.data })
        }
    })

    it("never returns a transaction when the estimate reverts", async () => {
        const client = { getChainId: vi.fn().mockResolvedValue(84532), getCode: vi.fn().mockResolvedValue("0x"), estimateGas: vi.fn().mockRejectedValue(new Error("execution reverted")) }
        await expect(prepareTokenDeploy(client, plan, ALICE)).rejects.toThrow(/reverted/)
    })

    it("refuses an RPC on another chain before reading anything else", async () => {
        const client = { getChainId: vi.fn().mockResolvedValue(8453), getCode: vi.fn(), estimateGas: vi.fn() }
        await expect(prepareTokenDeploy(client, plan, ALICE)).rejects.toThrow(/planned for chain 84532, not chain 8453/)
        expect(client.getCode).not.toHaveBeenCalled()
    })
})

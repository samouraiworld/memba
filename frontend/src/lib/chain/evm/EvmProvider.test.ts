/**
 * EvmProvider unit tests (B-6) — against a mocked viem public client and a
 * fake wallet client. No network.
 *
 * Pins the ISSUE-009 regressions that motivated the generic writeAndWait:
 *   - vote() sends the MembaDAO.VoteType enum positions (no=0, yes=1,
 *     abstain=2) — the inverted map sent every YES as Against;
 *   - createToken() supplies the CREATE2 salt AND pays the creation fee;
 *   - getDAOProposal() derives status from the REAL tuple (no `status` field
 *     exists on-chain) across all four branches.
 * Plus the wallet/error contracts (WALLET_NOT_CONNECTED, revert mapping).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { keccak256, stringToHex } from "viem"
import type { CALNetworkConfig } from "../types"

const { mockPublicClient } = vi.hoisted(() => ({
    mockPublicClient: {
        readContract: vi.fn(),
        waitForTransactionReceipt: vi.fn(),
        getBalance: vi.fn(),
    },
}))

vi.mock("viem", async (importOriginal) => ({
    ...(await importOriginal<typeof import("viem")>()),
    createPublicClient: vi.fn(() => mockPublicClient),
}))

import { createEvmProvider } from "./EvmProvider"

const NETWORK: CALNetworkConfig = {
    chainId: "rh-testnet-46630",
    family: "evm",
    label: "Robinhood Chain Testnet",
    rpcUrl: "https://rpc.testnet.chain.robinhood.example",
    fallbackRpcUrls: [],
    explorerTxUrl: "https://explorer.example/tx/{hash}",
    explorerAddressUrl: "https://explorer.example/address/{address}",
    nativeToken: { name: "Ether", symbol: "ETH", microUnit: "wei", decimals: 18 },
    isTestnet: true,
    evmChainId: 46630,
}

const CALLER = "0x1111111111111111111111111111111111111111" as const
const DAO = { id: "0x2222222222222222222222222222222222222222", family: "evm" as const }

const RECEIPT = {
    transactionHash: "0xhash",
    status: "success",
    blockNumber: 42n,
    gasUsed: 21000n,
}

function fakeWallet() {
    return {
        account: { address: CALLER },
        getAddresses: vi.fn(async () => [CALLER]),
        writeContract: vi.fn(async () => "0xhash"),
        signMessage: vi.fn(async () => "0xsig"),
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    mockPublicClient.waitForTransactionReceipt.mockResolvedValue(RECEIPT)
})

describe("EvmProvider — factory guards", () => {
    it("refuses a config with no evmChainId (hostile-endpoint chain check would be silently skipped)", () => {
        expect(() => createEvmProvider({ ...NETWORK, evmChainId: undefined })).toThrowError(/evmChainId/)
    })
})

describe("EvmProvider — vote enum mapping (ISSUE-009 regression)", () => {
    it.each([
        ["yes", 1],
        ["no", 0],
        ["abstain", 2],
    ] as const)("vote(%s) sends MembaDAO.VoteType position %i", async (support, enumValue) => {
        const wc = fakeWallet()
        const p = createEvmProvider(NETWORK, { walletClient: wc as never })
        await p.vote(DAO, 5, support)
        expect(wc.writeContract).toHaveBeenCalledTimes(1)
        const call = wc.writeContract.mock.calls[0][0] as { functionName: string; args: unknown[] }
        expect(call.functionName).toBe("vote")
        expect(call.args).toEqual([5n, enumValue])
    })
})

describe("EvmProvider — createToken (ISSUE-009 regression)", () => {
    it("reads the creation fee, pays it as value, and supplies the CREATE2 salt", async () => {
        const wc = fakeWallet()
        mockPublicClient.readContract.mockResolvedValue(1000n) // creationFee
        const p = createEvmProvider(NETWORK, { walletClient: wc as never })
        await p.createToken("Memba", "MBA", 18, "1000000")

        expect(mockPublicClient.readContract).toHaveBeenCalledWith(
            expect.objectContaining({ functionName: "creationFee" }),
        )
        const call = wc.writeContract.mock.calls[0][0] as {
            functionName: string; args: unknown[]; value: bigint
        }
        expect(call.functionName).toBe("createToken")
        expect(call.value).toBe(1000n)
        expect(call.args).toEqual(["Memba", "MBA", 18, 1000000n, keccak256(stringToHex("Memba:MBA"))])
    })
})

describe("EvmProvider — getDAOProposal status derivation (no on-chain status field)", () => {
    const BASE = {
        proposer: CALLER,
        title: "T",
        description: "D",
        category: 1, // Treasury
        createdAt: 1700000000n,
        forVotes: 30n,
        againstVotes: 10n,
        abstainVotes: 5n,
        executed: false,
        cancelled: false,
    }
    const FUTURE = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const PAST = BigInt(Math.floor(Date.now() / 1000) - 3600)

    function primeProposal(tuple: Record<string, unknown>, passed?: boolean) {
        mockPublicClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
            if (functionName === "getProposal") return tuple
            if (functionName === "proposalPassed") return passed
            throw new Error(`unexpected read: ${functionName}`)
        })
    }

    it("cancelled → rejected", async () => {
        primeProposal({ ...BASE, cancelled: true, votingDeadline: FUTURE })
        const p = createEvmProvider(NETWORK)
        await expect(p.getDAOProposal(DAO, 1)).resolves.toMatchObject({ status: "rejected" })
    })

    it("executed → executed", async () => {
        primeProposal({ ...BASE, executed: true, votingDeadline: PAST })
        const p = createEvmProvider(NETWORK)
        await expect(p.getDAOProposal(DAO, 1)).resolves.toMatchObject({ status: "executed" })
    })

    it("deadline in the future → open (proposalPassed NOT consulted)", async () => {
        primeProposal({ ...BASE, votingDeadline: FUTURE })
        const p = createEvmProvider(NETWORK)
        await expect(p.getDAOProposal(DAO, 1)).resolves.toMatchObject({ status: "open" })
        const consulted = mockPublicClient.readContract.mock.calls.some(
            ([{ functionName }]) => functionName === "proposalPassed",
        )
        expect(consulted).toBe(false)
    })

    it("deadline past + proposalPassed → passed / not passed → rejected", async () => {
        primeProposal({ ...BASE, votingDeadline: PAST }, true)
        const p = createEvmProvider(NETWORK)
        await expect(p.getDAOProposal(DAO, 1)).resolves.toMatchObject({ status: "passed" })

        primeProposal({ ...BASE, votingDeadline: PAST }, false)
        await expect(p.getDAOProposal(DAO, 1)).resolves.toMatchObject({ status: "rejected" })
    })

    it("maps the real tuple fields (votes, weighted total, category enum, ISO date)", async () => {
        primeProposal({ ...BASE, votingDeadline: FUTURE })
        const p = createEvmProvider(NETWORK)
        const prop = await p.getDAOProposal(DAO, 9)
        expect(prop).toMatchObject({
            id: 9,
            yesVotes: 30,
            noVotes: 10,
            abstainVotes: 5,
            totalVoters: 45, // weighted power cast, not a headcount
            category: "treasury",
            createdAt: new Date(1700000000 * 1000).toISOString(),
            proposer: { raw: CALLER, family: "evm" },
        })
    })
})

describe("EvmProvider — wallet + error contracts", () => {
    it("writes without a wallet throw WALLET_NOT_CONNECTED", async () => {
        const p = createEvmProvider(NETWORK)
        await expect(p.vote(DAO, 1, "yes")).rejects.toMatchObject({ code: "WALLET_NOT_CONNECTED" })
    })

    it("setWalletClient injects a wallet after creation; disconnect clears it", async () => {
        const p = createEvmProvider(NETWORK)
        expect(p.isConnected()).toBe(false)
        const wc = fakeWallet()
        p.setWalletClient(wc as never)
        expect(p.isConnected()).toBe(true)
        expect(p.getWalletState()).toMatchObject({ connected: true, address: { raw: CALLER, family: "evm" } })
        await p.disconnect()
        expect(p.isConnected()).toBe(false)
    })

    it("maps an execution revert to CONTRACT_REVERT", async () => {
        mockPublicClient.readContract.mockRejectedValue(new Error("execution reverted: nope"))
        const p = createEvmProvider(NETWORK)
        await expect(p.getDAOConfig(DAO)).rejects.toMatchObject({ code: "CONTRACT_REVERT", family: "evm" })
    })

    it("getNFT maps ownerOf/tokenURI and returns null on a revert (nonexistent token)", async () => {
        mockPublicClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
            if (functionName === "ownerOf") return CALLER
            if (functionName === "tokenURI") return "ipfs://meta"
            throw new Error(`unexpected read: ${functionName}`)
        })
        const p = createEvmProvider(NETWORK)
        await expect(p.getNFT(DAO, "3")).resolves.toMatchObject({
            tokenId: "3",
            owner: { raw: CALLER, family: "evm" },
            tokenURI: "ipfs://meta",
        })

        mockPublicClient.readContract.mockRejectedValue(new Error("execution reverted: ERC721NonexistentToken"))
        await expect(p.getNFT(DAO, "404")).resolves.toBeNull()
    })
})

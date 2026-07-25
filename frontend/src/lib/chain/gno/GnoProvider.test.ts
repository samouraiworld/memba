/**
 * GnoProvider unit tests (B-6) — against mocked lib modules, no network.
 *
 * The provider is a thin adapter over lib/dao, lib/grc20 and lib/grc721; these
 * tests pin (1) that every read threads the provider's PER-NETWORK rpcUrl into
 * the wrapped readers (the B-4 contract — before it, config.rpcUrl was
 * silently ignored), (2) the CAL-shape mappings (ChainAddress family,
 * threshold %→bps, username ""→undefined), and (3) the current wallet
 * dead-end: nothing can set _walletAddress, so every write throws
 * WALLET_NOT_CONNECTED — a real B-5 gap (EvmProvider has setWalletClient;
 * GnoProvider has no equivalent injection path).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createGnoProvider } from "./GnoProvider"
import { ChainError } from "../provider"
import type { CALNetworkConfig } from "../types"

vi.mock("../../dao", () => ({
    getDAOConfig: vi.fn(),
    getDAOMembers: vi.fn(),
    getDAOProposals: vi.fn(),
    getProposalDetail: vi.fn(),
    buildVoteMsg: vi.fn(),
    buildExecuteMsg: vi.fn(),
    buildProposeMsg: vi.fn(),
    buildProposeAddMemberMsg: vi.fn(),
    buildProposeRemoveMemberMsg: vi.fn(),
}))
vi.mock("../../grc20", () => ({
    doContractBroadcast: vi.fn(),
    listFactoryTokens: vi.fn(),
    GRC20_FACTORY_PATH: "gno.land/r/samcrew/tokenfactory_v2",
}))
vi.mock("../../grc721", () => ({
    listCollectionTokens: vi.fn(),
    getNFTOwner: vi.fn(),
    getTokenURI: vi.fn(),
}))

import { getDAOConfig, getDAOMembers, getProposalDetail } from "../../dao"
import { listCollectionTokens, getNFTOwner, getTokenURI } from "../../grc721"

const mockGetDAOConfig = vi.mocked(getDAOConfig)
const mockGetDAOMembers = vi.mocked(getDAOMembers)
const mockGetProposalDetail = vi.mocked(getProposalDetail)
const mockListCollectionTokens = vi.mocked(listCollectionTokens)
const mockGetNFTOwner = vi.mocked(getNFTOwner)
const mockGetTokenURI = vi.mocked(getTokenURI)

/** A NON-active network on purpose: these tests pin that reads follow the
 *  provider's config, not the app's frozen active network. */
const NETWORK: CALNetworkConfig = {
    chainId: "topaz-1",
    family: "gno",
    label: "Topaz",
    rpcUrl: "https://rpc.topaz.example",
    fallbackRpcUrls: [],
    explorerTxUrl: "https://gnoscan.io/transactions/{hash}",
    explorerAddressUrl: "https://gnoscan.io/accounts/{address}",
    nativeToken: { name: "Gno", symbol: "GNOT", microUnit: "ugnot", decimals: 6 },
    isTestnet: true,
}

const DAO = { id: "gno.land/r/samcrew/memba_dao", family: "gno" as const }

beforeEach(() => {
    vi.clearAllMocks()
})

describe("GnoProvider — per-network rpcUrl threading (B-4 contract)", () => {
    it("getDAOConfig reads via the provider's config.rpcUrl", async () => {
        mockGetDAOConfig.mockResolvedValue({
            name: "Memba", description: "d", threshold: "66%", memberCount: 12,
            memberstorePath: "", tierDistribution: [], isArchived: false,
        })
        const p = createGnoProvider(NETWORK)
        await p.getDAOConfig(DAO)
        expect(mockGetDAOConfig).toHaveBeenCalledWith(NETWORK.rpcUrl, DAO.id)
    })

    it("getNFT threads config.rpcUrl into grc721 owner + URI reads", async () => {
        mockGetNFTOwner.mockResolvedValue("g1owner")
        mockGetTokenURI.mockResolvedValue("ipfs://x")
        const p = createGnoProvider(NETWORK)
        const nft = await p.getNFT({ id: "gno.land/r/x/nft", family: "gno" }, "7")
        expect(mockGetNFTOwner).toHaveBeenCalledWith(NETWORK.rpcUrl, "gno.land/r/x/nft", "default", "7")
        expect(mockGetTokenURI).toHaveBeenCalledWith(NETWORK.rpcUrl, "gno.land/r/x/nft", "default", "7")
        expect(nft).toEqual({
            tokenId: "7",
            owner: { raw: "g1owner", family: "gno" },
            tokenURI: "ipfs://x",
            collection: { id: "gno.land/r/x/nft", family: "gno" },
        })
    })

    it("getNFTsByOwner threads config.rpcUrl and filters by owner", async () => {
        mockListCollectionTokens.mockResolvedValue([
            { tokenId: "1", owner: "g1me", tokenURI: "ipfs://1" },
            { tokenId: "2", owner: "g1other", tokenURI: "ipfs://2" },
        ])
        const p = createGnoProvider(NETWORK)
        const mine = await p.getNFTsByOwner(
            { id: "gno.land/r/x/nft", family: "gno" },
            { raw: "g1me", family: "gno" },
        )
        expect(mockListCollectionTokens).toHaveBeenCalledWith(NETWORK.rpcUrl, "gno.land/r/x/nft", "default")
        expect(mine).toHaveLength(1)
        expect(mine[0].tokenId).toBe("1")
    })
})

describe("GnoProvider — CAL-shape mappings", () => {
    it("converts a percent threshold string to basis points", async () => {
        mockGetDAOConfig.mockResolvedValue({
            name: "Memba", description: "d", threshold: "66%", memberCount: 12,
            memberstorePath: "", tierDistribution: [], isArchived: false,
        })
        const p = createGnoProvider(NETWORK)
        const cfg = await p.getDAOConfig(DAO)
        expect(cfg.threshold).toBe(6600)
    })

    it("reports null (not a fabricated default) when the threshold is absent", async () => {
        mockGetDAOConfig.mockResolvedValue({
            name: "Memba", description: "d", threshold: "", memberCount: 12,
            memberstorePath: "", tierDistribution: [], isArchived: false,
        })
        const p = createGnoProvider(NETWORK)
        const cfg = await p.getDAOConfig(DAO)
        expect(cfg.threshold).toBeNull()
    })

    it("throws CONTRACT_REVERT when the DAO does not resolve", async () => {
        mockGetDAOConfig.mockResolvedValue(null)
        const p = createGnoProvider(NETWORK)
        await expect(p.getDAOConfig(DAO)).rejects.toMatchObject({ code: "CONTRACT_REVERT", family: "gno" })
    })

    it("maps members to ChainAddress and drops empty usernames", async () => {
        mockGetDAOMembers.mockResolvedValue([
            { address: "g1aaa", roles: ["admin"], tier: "T1", votingPower: 3, username: "alice" },
            { address: "g1bbb", roles: [], tier: "", votingPower: 1, username: "" },
        ])
        const p = createGnoProvider(NETWORK)
        const members = await p.getDAOMembers(DAO)
        expect(members[0]).toMatchObject({
            address: { raw: "g1aaa", family: "gno" }, votingPower: 3, username: "alice",
        })
        expect(members[1].username).toBeUndefined()
    })

    it("getDAOProposal returns null for a missing proposal, mapped shape otherwise", async () => {
        mockGetProposalDetail.mockResolvedValue(null)
        const p = createGnoProvider(NETWORK)
        await expect(p.getDAOProposal(DAO, 3)).resolves.toBeNull()

        mockGetProposalDetail.mockResolvedValue({
            id: 3, title: "T", description: "D", category: "governance", status: "open",
            author: "@a", authorProfile: "", tiers: [], yesPercent: 50, noPercent: 50,
            yesVotes: 5, noVotes: 5, abstainVotes: 0, totalVoters: 10, proposer: "g1prop",
        })
        const prop = await p.getDAOProposal(DAO, 3)
        expect(prop).toMatchObject({
            id: 3, status: "open", proposer: { raw: "g1prop", family: "gno" }, yesVotes: 5,
        })
    })

    it("getNFT returns null when the token has no owner", async () => {
        mockGetNFTOwner.mockResolvedValue(null)
        mockGetTokenURI.mockResolvedValue(null)
        const p = createGnoProvider(NETWORK)
        await expect(p.getNFT({ id: "gno.land/r/x/nft", family: "gno" }, "404")).resolves.toBeNull()
    })
})

describe("GnoProvider — wallet dead-end (documented B-5 gap)", () => {
    // Nothing can set the provider's internal _walletAddress (connect() throws
    // by design, and unlike EvmProvider.setWalletClient there is no injection
    // path), so EVERY write throws WALLET_NOT_CONNECTED today. When B-5 wires
    // the useAdena bridge, these pins must be replaced with real write tests
    // (vote mapping yes→"YES", addMember power/roles threading, …).
    it("every write path throws WALLET_NOT_CONNECTED", async () => {
        const p = createGnoProvider(NETWORK)
        const addr = { raw: "g1x", family: "gno" as const }
        for (const call of [
            () => p.propose(DAO, "t", "d", "governance"),
            () => p.vote(DAO, 1, "yes"),
            () => p.executeProposal(DAO, 1),
            () => p.addMember(DAO, addr, 1, ["member"]),
            () => p.removeMember(DAO, addr),
        ]) {
            await expect(call()).rejects.toMatchObject({ code: "WALLET_NOT_CONNECTED" })
        }
    })

    it("connect() itself is a documented no-op that throws toward useAdena", async () => {
        const p = createGnoProvider(NETWORK)
        await expect(p.connect()).rejects.toBeInstanceOf(ChainError)
        expect(p.isConnected()).toBe(false)
        expect(p.getWalletState()).toEqual({ connected: false, address: null, family: "gno" })
    })
})

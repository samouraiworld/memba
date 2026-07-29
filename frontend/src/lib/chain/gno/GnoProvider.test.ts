/**
 * GnoProvider unit tests (B-6) — against mocked lib modules, no network.
 *
 * The provider is a thin adapter over lib/dao, lib/grc20 and lib/grc721; these
 * tests pin (1) that every read threads the provider's PER-NETWORK rpcUrl into
 * the wrapped readers (the B-4 contract — before it, config.rpcUrl was
 * silently ignored), (2) the CAL-shape mappings (ChainAddress family,
 * threshold %→bps, username ""→undefined), and (3) the setWalletBridge
 * injection path (B-5 Phase 0) and the write/error-mapping pins behind it —
 * vote-string mapping, addMember arg threading, broadcast error codes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createGnoProvider } from "./GnoProvider"
import { ChainError } from "../provider"
import type { CALNetworkConfig } from "../types"

vi.mock("../../dao", () => ({
    getDAOConfig: vi.fn(),
    getMemberRole: vi.fn(),
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

import { getDAOConfig, getDAOMembers, getDAOProposals, getMemberRole, getProposalDetail, buildVoteMsg, buildProposeAddMemberMsg } from "../../dao"
import { doContractBroadcast } from "../../grc20"
import { listCollectionTokens, getNFTOwner, getTokenURI } from "../../grc721"

const mockGetDAOConfig = vi.mocked(getDAOConfig)
const mockGetDAOProposals = vi.mocked(getDAOProposals)
const mockGetMemberRole = vi.mocked(getMemberRole)
const mockGetDAOMembers = vi.mocked(getDAOMembers)
const mockGetProposalDetail = vi.mocked(getProposalDetail)
const mockBuildVoteMsg = vi.mocked(buildVoteMsg)
const mockBuildProposeAddMemberMsg = vi.mocked(buildProposeAddMemberMsg)
const mockDoContractBroadcast = vi.mocked(doContractBroadcast)
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

    it("getNFT/getNFTsByOwner address the sub-collection via ContractRef.subId (B-5 Phase 2b)", async () => {
        mockGetNFTOwner.mockResolvedValue("g1owner")
        mockGetTokenURI.mockResolvedValue("ipfs://x")
        mockListCollectionTokens.mockResolvedValue([])
        const p = createGnoProvider(NETWORK)
        const ref = { id: "gno.land/r/samcrew/memba_nft_v2", family: "gno" as const, subId: "genesis" }
        await p.getNFT(ref, "7")
        expect(mockGetNFTOwner).toHaveBeenCalledWith(NETWORK.rpcUrl, ref.id, "genesis", "7")
        expect(mockGetTokenURI).toHaveBeenCalledWith(NETWORK.rpcUrl, ref.id, "genesis", "7")
        await p.getNFTsByOwner(ref, { raw: "g1me", family: "gno" })
        expect(mockListCollectionTokens).toHaveBeenCalledWith(NETWORK.rpcUrl, ref.id, "genesis")
    })

    it("getNFT reads owner and URI in PARALLEL (one round-trip wave, not two)", async () => {
        // The v3 grid enumerates through this per token — sequential awaits
        // would double the grid's load time (design-panel finding v).
        let ownerResolve!: (v: string) => void
        const ownerGate = new Promise<string>((res) => { ownerResolve = res })
        mockGetNFTOwner.mockReturnValue(ownerGate)
        mockGetTokenURI.mockResolvedValue("ipfs://x")
        const p = createGnoProvider(NETWORK)
        const pending = p.getNFT({ id: "gno.land/r/x/nft", family: "gno" }, "1")
        // URI must have been requested BEFORE the owner read resolves.
        await vi.waitFor(() => expect(mockGetTokenURI).toHaveBeenCalledTimes(1))
        ownerResolve("g1owner")
        await expect(pending).resolves.toMatchObject({ tokenId: "1" })
    })
})

describe("GnoProvider — wallet bridge (B-5 Phase 0, G1)", () => {
    // Wallet state is injected via setWalletBridge (mirroring
    // EvmProvider.setWalletClient) — connection itself stays useAdena's job
    // (Phase 1 wires ChainContextProvider to push the hook's state in).
    it("writes without an injected wallet throw WALLET_NOT_CONNECTED", async () => {
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

    it("setWalletBridge injects the wallet; clearing it disconnects", () => {
        const p = createGnoProvider(NETWORK)
        expect(p.isConnected()).toBe(false)
        p.setWalletBridge({ address: "g1me" })
        expect(p.isConnected()).toBe(true)
        expect(p.getWalletState()).toEqual({
            connected: true, address: { raw: "g1me", family: "gno" }, family: "gno",
        })
        p.setWalletBridge(null)
        expect(p.isConnected()).toBe(false)
        expect(p.getWalletState()).toEqual({ connected: false, address: null, family: "gno" })
    })

    it("connect() still throws toward useAdena — connection is the hook's job", async () => {
        const p = createGnoProvider(NETWORK)
        await expect(p.connect()).rejects.toBeInstanceOf(ChainError)
    })
})

describe("GnoProvider — writes through the bridge (regression pins)", () => {
    function connected() {
        const p = createGnoProvider(NETWORK)
        p.setWalletBridge({ address: "g1caller" })
        return p
    }

    beforeEach(() => {
        mockDoContractBroadcast.mockResolvedValue({ hash: "0xabc" })
    })

    it("vote maps yes/no/abstain to the basedao vote strings — abstain must NOT become a NO", async () => {
        const p = connected()
        mockBuildVoteMsg.mockReturnValue({ type: "vm/MsgCall", value: {} } as never)

        await p.vote(DAO, 7, "yes")
        expect(mockBuildVoteMsg).toHaveBeenLastCalledWith("g1caller", DAO.id, 7, "YES")
        await p.vote(DAO, 7, "no")
        expect(mockBuildVoteMsg).toHaveBeenLastCalledWith("g1caller", DAO.id, 7, "NO")
        await p.vote(DAO, 7, "abstain")
        expect(mockBuildVoteMsg).toHaveBeenLastCalledWith("g1caller", DAO.id, 7, "ABSTAIN")
    })

    it("addMember threads votingPower and comma-joins roles — the args a previous version silently dropped", async () => {
        const p = connected()
        mockBuildProposeAddMemberMsg.mockReturnValue({ type: "vm/MsgCall", value: {} } as never)
        await p.addMember(DAO, { raw: "g1new", family: "gno" }, 3, ["member", "reviewer"])
        expect(mockBuildProposeAddMemberMsg).toHaveBeenCalledWith(
            "g1caller", DAO.id, "g1new", 3, "member,reviewer",
        )
    })

    it("a successful broadcast maps to a TxResult", async () => {
        const p = connected()
        mockBuildVoteMsg.mockReturnValue({ type: "vm/MsgCall", value: {} } as never)
        const res = await p.vote(DAO, 1, "yes")
        expect(res).toMatchObject({ hash: "0xabc", success: true })
        expect(mockDoContractBroadcast).toHaveBeenCalledTimes(1)
    })

    it.each([
        ["user rejected the request", "USER_REJECTED"],
        ["insufficient funds for fee", "INSUFFICIENT_FUNDS"],
        ["caller is not a member", "CONTRACT_REVERT"],
        ["wallet not available", "WALLET_NOT_CONNECTED"],
        ["request timeout", "NETWORK_ERROR"],
        ["something exotic", "UNKNOWN"],
    ] as const)("broadcast failure %j maps to ChainError %s", async (message, code) => {
        const p = connected()
        mockBuildVoteMsg.mockReturnValue({ type: "vm/MsgCall", value: {} } as never)
        mockDoContractBroadcast.mockRejectedValue(new Error(message))
        await expect(p.vote(DAO, 1, "yes")).rejects.toMatchObject({ code, family: "gno" })
    })
})

describe("B-7 — the CAL relays what the chain reported, and never derives it", () => {
    const cfg: CALNetworkConfig = {
        chainId: "topaz-1", family: "gno", name: "Topaz",
        rpcUrl: "https://rpc.topaz.example", explorerUrl: "https://ex.example",
    } as CALNetworkConfig

    it("relays the realm's own yes/no percentages instead of recomputing them from votes", async () => {
        // Deliberately inconsistent: the realm says 90/10 while the raw counts
        // imply 50/50 (weighted voting). Deriving would display 50 and disagree
        // with the realm on whether the proposal is passing.
        mockGetDAOProposals.mockResolvedValue([{
            id: 1, title: "T", description: "", category: "governance", status: "open",
            author: "@alice", authorProfile: "", tiers: [],
            yesPercent: 90, noPercent: 10,
            yesVotes: 1, noVotes: 1, abstainVotes: 0, totalVoters: 2,
            proposer: "g1abc",
        }] as never)

        const [p] = await createGnoProvider(cfg).getDAOProposals({ id: "gno.land/r/x/dao" })
        expect(p.yesPercent).toBe(90)
        expect(p.noPercent).toBe(10)
        expect(p.author).toBe("@alice")
        // the raw counts still ride along, untouched
        expect(p.yesVotes).toBe(1)
        expect(p.totalVoters).toBe(2)
    })

    it("marks votes unavailable so a failed vote RPC cannot read as a zero-vote proposal", async () => {
        mockGetDAOProposals.mockResolvedValue([{
            id: 2, title: "T", description: "", category: "", status: "open",
            author: "", authorProfile: "", tiers: [],
            yesPercent: 0, noPercent: 0,
            yesVotes: 0, noVotes: 0, abstainVotes: 0, totalVoters: 0,
            proposer: "g1abc", enrichFailed: true,
        }] as never)

        const [p] = await createGnoProvider(cfg).getDAOProposals({ id: "gno.land/r/x/dao" })
        expect(p.votesUnavailable).toBe(true)
        expect(p.author).toBeUndefined()   // "" is absence, not a name
    })

    it("carries the threshold label verbatim and refuses to invent a number for a non-numeric one", async () => {
        mockGetDAOConfig.mockResolvedValue({
            name: "D", description: "", threshold: "supermajority",
            memberCount: 3, memberstorePath: "", tierDistribution: [], isArchived: false,
        } as never)

        const c = await createGnoProvider(cfg).getDAOConfig({ id: "gno.land/r/x/dao" })
        // parseFloat("supermajority") is NaN; NaN is neither a threshold nor honest.
        expect(c.threshold).toBeNull()
        expect(Number.isNaN(c.threshold as number)).toBe(false)
        expect(c.thresholdLabel).toBe("supermajority")
    })

    it("still converts a numeric threshold to basis points, and keeps the wording", async () => {
        mockGetDAOConfig.mockResolvedValue({
            name: "D", description: "", threshold: "66.5%",
            memberCount: 3, memberstorePath: "", tierDistribution: [], isArchived: false,
        } as never)

        const c = await createGnoProvider(cfg).getDAOConfig({ id: "gno.land/r/x/dao" })
        expect(c.threshold).toBe(6650)
        expect(c.thresholdLabel).toBe("66.5%")
    })
})

describe("getDAOMember — the provider absorbs Gno's memberstore routing", () => {
    const cfg: CALNetworkConfig = {
        chainId: "topaz-1", family: "gno", name: "Topaz",
        rpcUrl: "https://rpc.topaz.example", explorerUrl: "https://ex.example",
    } as CALNetworkConfig
    const addr = { raw: "g1abc", family: "gno" as const }
    const daoRef = { id: "gno.land/r/gov/dao", family: "gno" as const }

    it("resolves the memberstore path from config and passes it to the lookup — the caller never sees it", async () => {
        mockGetDAOConfig.mockResolvedValue({
            name: "GovDAO", description: "", threshold: "66%", memberCount: 3,
            memberstorePath: "gno.land/r/gov/dao/memberstore", tierDistribution: [], isArchived: false,
        } as never)
        mockGetMemberRole.mockResolvedValue({
            address: "g1abc", roles: [], tier: "T2", votingPower: 20, username: "",
        } as never)

        const m = await createGnoProvider(cfg).getDAOMember(daoRef, addr)
        expect(mockGetMemberRole).toHaveBeenCalledWith(
            "https://rpc.topaz.example", "gno.land/r/gov/dao", "g1abc",
            "gno.land/r/gov/dao/memberstore",
        )
        expect(m?.tier).toBe("T2")
        expect(m?.votingPower).toBe(20)
        expect(m?.username).toBeUndefined()   // "" is absence, not a blank name
    })

    it("caches the memberstore path — a second lookup does not re-read the config", async () => {
        mockGetDAOConfig.mockResolvedValue({
            name: "GovDAO", description: "", threshold: "", memberCount: 1,
            memberstorePath: "gno.land/r/gov/dao/memberstore", tierDistribution: [], isArchived: false,
        } as never)
        mockGetMemberRole.mockResolvedValue(null as never)

        const p = createGnoProvider(cfg)
        await p.getDAOMember(daoRef, addr)
        await p.getDAOMember(daoRef, addr)
        expect(mockGetDAOConfig).toHaveBeenCalledTimes(1)
    })

    it("returns null for a non-member, and survives a failed config read", async () => {
        mockGetDAOConfig.mockRejectedValue(new Error("all RPCs down"))
        mockGetMemberRole.mockResolvedValue(null as never)

        // A config failure must not surface as "not a member" by throwing — it
        // falls back to the render-parse path, exactly like the direct reader.
        const m = await createGnoProvider(cfg).getDAOMember(daoRef, addr)
        expect(m).toBeNull()
        expect(mockGetMemberRole).toHaveBeenCalledWith(
            "https://rpc.topaz.example", "gno.land/r/gov/dao", "g1abc", undefined,
        )
    })
})

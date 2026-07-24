/**
 * EvmProvider — Production ChainProvider for EVM chains (Robinhood Chain).
 *
 * Uses viem for all contract interactions:
 * - publicClient for reads (no wallet needed)
 * - walletClient for writes (requires connected wallet)
 *
 * Wallet connection is handled externally (wagmi/RainbowKit) and
 * injected via setWalletClient(). This keeps the provider pure.
 *
 * @module lib/chain/evm/EvmProvider
 */

import {
    createPublicClient,
    http,
    formatEther,
    parseEther,
    getAddress,
    type PublicClient,
    type WalletClient,
    type Hash,
    type TransactionReceipt,
    type Address,
} from "viem"

import type { ChainProvider, WalletState } from "../provider"
import { ChainError } from "../provider"
import type {
    ChainAddress,
    TxResult,
    ContractRef,
    TokenInfo,
    CALMember,
    CALProposal,
    CALDAOConfig,
    CALNFT,
    CALEscrowContract,
    CALNetworkConfig,
} from "../types"

import { MembaDAOABI, MembaEscrowABI, MembaTokenFactoryABI, MembaTokenABI, MembaNFTABI } from "./abi"
import { getContractAddresses, type EvmContractAddresses } from "./addresses"

// ── Helpers ──────────────────────────────────────────────────

function toChainAddress(raw: string): ChainAddress {
    return { raw, family: "evm" }
}

function toAddress(ref: ContractRef | ChainAddress): Address {
    const raw = "id" in ref ? ref.id : ref.raw
    return getAddress(raw)
}

function mapTxResult(receipt: TransactionReceipt): TxResult {
    return {
        hash: receipt.transactionHash,
        success: receipt.status === "success",
        blockHeight: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed,
        raw: receipt,
    }
}

/** Map Solidity revert reasons to ChainErrorCode. */
function mapError(err: unknown): ChainError {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.includes("User rejected") || msg.includes("user rejected")) {
        return new ChainError(msg, "USER_REJECTED", "evm", err)
    }
    if (msg.includes("insufficient funds") || msg.includes("InsufficientFunds")) {
        return new ChainError(msg, "INSUFFICIENT_FUNDS", "evm", err)
    }
    if (msg.includes("revert") || msg.includes("execution reverted")) {
        return new ChainError(msg, "CONTRACT_REVERT", "evm", err)
    }
    return new ChainError(msg, "UNKNOWN", "evm", err)
}

// ── Vote type mapping ────────────────────────────────────────

const VOTE_MAP = { yes: 0, no: 1, abstain: 2 } as const
const STATUS_MAP = ["open", "passed", "rejected", "executed"] as const
const ESCROW_STATUS_MAP = ["active", "completed", "cancelled", "disputed"] as const
const MILESTONE_STATUS_MAP = ["pending", "funded", "completed", "released", "refunded"] as const

// ── Provider Factory ─────────────────────────────────────────

export interface EvmProviderOptions {
    /** External wallet client from wagmi. */
    walletClient?: WalletClient
}

/**
 * Create a production EvmProvider.
 *
 * @param config - Network configuration (from registry).
 * @param opts   - Optional initial wallet client.
 */
export function createEvmProvider(config: CALNetworkConfig, opts?: EvmProviderOptions): ChainProvider & {
    /** Inject/update the wallet client (called by wagmi adapter). */
    setWalletClient(wc: WalletClient | null): void
} {
    // ── Clients ──────────────────────────────────────────────
    const publicClient: PublicClient = createPublicClient({
        transport: http(config.rpcUrl),
    })

    let walletClient: WalletClient | null = opts?.walletClient ?? null

    const addresses = getContractAddresses(config.chainId)

    // ── Internal helpers ─────────────────────────────────────

    function requireWallet(): WalletClient {
        if (!walletClient) throw new ChainError("Wallet not connected", "WALLET_NOT_CONNECTED", "evm")
        return walletClient
    }

    function requireAddresses(): EvmContractAddresses {
        if (!addresses) throw new ChainError(`No contract addresses for chain ${config.chainId}`, "UNKNOWN", "evm")
        return addresses
    }

    /** Write to contract and wait for receipt. */
    async function writeAndWait(params: {
        address: Address
        abi: readonly unknown[]
        functionName: string
        args?: readonly unknown[]
        value?: bigint
    }): Promise<TxResult> {
        const wc = requireWallet()
        try {
            const hash = await wc.writeContract(params as Parameters<typeof wc.writeContract>[0])
            const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as Hash })
            return mapTxResult(receipt)
        } catch (err) {
            throw mapError(err)
        }
    }

    // ── Provider implementation ──────────────────────────────

    const provider: ChainProvider & { setWalletClient(wc: WalletClient | null): void } = {
        family: "evm",
        network: config,

        setWalletClient(wc: WalletClient | null) {
            walletClient = wc
        },

        // ── Wallet ───────────────────────────────────────────

        async connect(): Promise<ChainAddress> {
            // Connection is handled externally by wagmi. This just returns the current address.
            const wc = requireWallet()
            const [addr] = await wc.getAddresses()
            return toChainAddress(addr)
        },

        async disconnect(): Promise<void> {
            walletClient = null
        },

        getWalletState(): WalletState {
            if (!walletClient) return { connected: false, address: null, family: "evm" }
            // walletClient.account may be set by wagmi
            const account = walletClient.account
            return {
                connected: true,
                address: account ? toChainAddress(account.address) : null,
                family: "evm",
            }
        },

        isConnected(): boolean {
            return walletClient !== null
        },

        // ── Auth ─────────────────────────────────────────────

        async signLoginChallenge(challenge: string): Promise<string> {
            const wc = requireWallet()
            try {
                const [addr] = await wc.getAddresses()
                return await wc.signMessage({ account: addr, message: challenge })
            } catch (err) {
                throw mapError(err)
            }
        },

        // ── Reads (DAO) ──────────────────────────────────────

        async getDAOConfig(dao: ContractRef): Promise<CALDAOConfig> {
            try {
                const addr = toAddress(dao)
                const [name, desc, threshold, quorum, memberCount] = await Promise.all([
                    publicClient.readContract({ address: addr, abi: MembaDAOABI, functionName: "name" }),
                    publicClient.readContract({ address: addr, abi: MembaDAOABI, functionName: "description" }),
                    publicClient.readContract({ address: addr, abi: MembaDAOABI, functionName: "votingThreshold" }),
                    publicClient.readContract({ address: addr, abi: MembaDAOABI, functionName: "quorumBps" }),
                    publicClient.readContract({ address: addr, abi: MembaDAOABI, functionName: "memberCount" }),
                ])
                return {
                    name: name as string,
                    description: desc as string,
                    threshold: Number(threshold),
                    quorum: Number(quorum),
                    memberCount: Number(memberCount),
                }
            } catch (err) {
                throw mapError(err)
            }
        },

        async getDAOMembers(dao: ContractRef): Promise<CALMember[]> {
            try {
                const addr = toAddress(dao)
                const count = (await publicClient.readContract({
                    address: addr, abi: MembaDAOABI, functionName: "memberCount",
                })) as bigint

                const members: CALMember[] = []
                for (let i = 0n; i < count; i++) {
                    const member = (await publicClient.readContract({
                        address: addr, abi: MembaDAOABI, functionName: "getMemberByIndex",
                        args: [i],
                    })) as { addr: string; votingPower: bigint; roles: string[] }
                    members.push({
                        address: toChainAddress(member.addr),
                        votingPower: Number(member.votingPower),
                        roles: member.roles,
                    })
                }
                return members
            } catch (err) {
                throw mapError(err)
            }
        },

        async getDAOProposals(dao: ContractRef): Promise<CALProposal[]> {
            try {
                const addr = toAddress(dao)
                const count = (await publicClient.readContract({
                    address: addr, abi: MembaDAOABI, functionName: "proposalCount",
                })) as bigint

                const proposals: CALProposal[] = []
                for (let i = 0n; i < count; i++) {
                    const p = await this.getDAOProposal(dao, Number(i))
                    if (p) proposals.push(p)
                }
                return proposals
            } catch (err) {
                throw mapError(err)
            }
        },

        async getDAOProposal(dao: ContractRef, proposalId: number): Promise<CALProposal | null> {
            try {
                const addr = toAddress(dao)
                const p = (await publicClient.readContract({
                    address: addr, abi: MembaDAOABI, functionName: "getProposal",
                    args: [BigInt(proposalId)],
                })) as {
                    title: string
                    description: string
                    category: string
                    status: number
                    proposer: string
                    yesVotes: bigint
                    noVotes: bigint
                    abstainVotes: bigint
                    totalVoters: bigint
                }
                return {
                    id: proposalId,
                    title: p.title,
                    description: p.description,
                    category: p.category,
                    status: STATUS_MAP[p.status] ?? "open",
                    proposer: toChainAddress(p.proposer),
                    yesVotes: Number(p.yesVotes),
                    noVotes: Number(p.noVotes),
                    abstainVotes: Number(p.abstainVotes),
                    totalVoters: Number(p.totalVoters),
                }
            } catch (err) {
                throw mapError(err)
            }
        },

        async isDAOMember(dao: ContractRef, address: ChainAddress): Promise<boolean> {
            try {
                return (await publicClient.readContract({
                    address: toAddress(dao), abi: MembaDAOABI, functionName: "isMember",
                    args: [toAddress(address)],
                })) as boolean
            } catch {
                return false
            }
        },

        // ── Writes (DAO) ─────────────────────────────────────

        async propose(dao: ContractRef, title: string, description: string, category: string): Promise<TxResult> {
            return writeAndWait({
                address: toAddress(dao), abi: MembaDAOABI, functionName: "createProposal",
                args: [title, description, category, BigInt(7 * 24 * 60 * 60)], // 7 day default deadline
            })
        },

        async vote(dao: ContractRef, proposalId: number, support: "yes" | "no" | "abstain"): Promise<TxResult> {
            return writeAndWait({
                address: toAddress(dao), abi: MembaDAOABI, functionName: "vote",
                args: [BigInt(proposalId), VOTE_MAP[support]],
            })
        },

        async executeProposal(dao: ContractRef, proposalId: number): Promise<TxResult> {
            return writeAndWait({
                address: toAddress(dao), abi: MembaDAOABI, functionName: "executeProposal",
                args: [BigInt(proposalId)],
            })
        },

        async addMember(dao: ContractRef, address: ChainAddress, votingPower: number, roles: string[]): Promise<TxResult> {
            return writeAndWait({
                address: toAddress(dao), abi: MembaDAOABI, functionName: "addMember",
                args: [toAddress(address), BigInt(votingPower), roles],
            })
        },

        async removeMember(dao: ContractRef, address: ChainAddress): Promise<TxResult> {
            return writeAndWait({
                address: toAddress(dao), abi: MembaDAOABI, functionName: "removeMember",
                args: [toAddress(address)],
            })
        },

        // ── Reads (Tokens) ───────────────────────────────────

        async getTokenInfo(token: ContractRef): Promise<TokenInfo | null> {
            try {
                const addr = toAddress(token)
                const [name, symbol, decimals, totalSupply] = await Promise.all([
                    publicClient.readContract({ address: addr, abi: MembaTokenABI, functionName: "name" }),
                    publicClient.readContract({ address: addr, abi: MembaTokenABI, functionName: "symbol" }),
                    publicClient.readContract({ address: addr, abi: MembaTokenABI, functionName: "decimals" }),
                    publicClient.readContract({ address: addr, abi: MembaTokenABI, functionName: "totalSupply" }),
                ])
                return {
                    id: token.id,
                    name: name as string,
                    symbol: symbol as string,
                    decimals: Number(decimals),
                    totalSupply: (totalSupply as bigint).toString(),
                }
            } catch {
                return null
            }
        },

        async getTokenBalance(token: ContractRef, address: ChainAddress): Promise<string> {
            try {
                const bal = (await publicClient.readContract({
                    address: toAddress(token), abi: MembaTokenABI, functionName: "balanceOf",
                    args: [toAddress(address)],
                })) as bigint
                return bal.toString()
            } catch {
                return "0"
            }
        },

        async listTokens(): Promise<TokenInfo[]> {
            // In EVM, tokens are discovered via events/indexer, not on-chain listing.
            // Returns empty for now — will be populated via backend EvmReader.
            return []
        },

        // ── Writes (Tokens) ──────────────────────────────────

        async createToken(name: string, symbol: string, decimals: number, initialSupply: string): Promise<TxResult> {
            const addrs = requireAddresses()
            return writeAndWait({
                address: addrs.tokenFactory, abi: MembaTokenFactoryABI, functionName: "createToken",
                args: [name, symbol, decimals, BigInt(initialSupply)],
            })
        },

        async mintTokens(_token: ContractRef, _to: ChainAddress, _amount: string): Promise<TxResult> {
            // MembaToken doesn't have a public mint — only initial supply at creation.
            throw new ChainError("ERC-20 minting not supported post-creation", "CONTRACT_REVERT", "evm")
        },

        // ── Reads (NFT) ──────────────────────────────────────

        async getNFTsByOwner(collection: ContractRef, owner: ChainAddress): Promise<CALNFT[]> {
            // ERC-721 doesn't have built-in enumeration by owner.
            // In production, use an indexer (Blockscout API / subgraph).
            // For now, return empty — will be populated via backend.
            void collection
            void owner
            return []
        },

        async getNFT(collection: ContractRef, tokenId: string): Promise<CALNFT | null> {
            try {
                const addr = toAddress(collection)
                const [ownerAddr, uri] = await Promise.all([
                    publicClient.readContract({ address: addr, abi: MembaNFTABI, functionName: "ownerOf", args: [BigInt(tokenId)] }),
                    publicClient.readContract({ address: addr, abi: MembaNFTABI, functionName: "tokenURI", args: [BigInt(tokenId)] }),
                ])
                return {
                    tokenId,
                    owner: toChainAddress(ownerAddr as string),
                    tokenURI: uri as string,
                    collection,
                }
            } catch {
                return null
            }
        },

        // ── Reads (Escrow) ───────────────────────────────────

        async getEscrowContract(escrow: ContractRef, contractId: number): Promise<CALEscrowContract | null> {
            try {
                const addr = toAddress(escrow)
                const sc = (await publicClient.readContract({
                    address: addr, abi: MembaEscrowABI, functionName: "getContract",
                    args: [BigInt(contractId)],
                })) as {
                    buyer: string; seller: string; title: string; status: number;
                    milestoneCount: bigint; createdAt: bigint;
                }

                const milestones = []
                for (let i = 0n; i < sc.milestoneCount; i++) {
                    const ms = (await publicClient.readContract({
                        address: addr, abi: MembaEscrowABI, functionName: "getMilestone",
                        args: [BigInt(contractId), i],
                    })) as { title: string; amount: bigint; status: number }
                    milestones.push({
                        title: ms.title,
                        amount: ms.amount.toString(),
                        status: MILESTONE_STATUS_MAP[ms.status] ?? "pending",
                    })
                }

                return {
                    id: contractId,
                    buyer: toChainAddress(sc.buyer),
                    seller: toChainAddress(sc.seller),
                    title: sc.title,
                    status: ESCROW_STATUS_MAP[sc.status] ?? "active",
                    milestones,
                    createdAt: Number(sc.createdAt),
                }
            } catch {
                return null
            }
        },

        // ── Writes (Escrow) ──────────────────────────────────

        async createEscrowContract(
            escrow: ContractRef,
            seller: ChainAddress,
            title: string,
            milestoneTitles: string[],
            milestoneAmounts: string[],
        ): Promise<TxResult> {
            return writeAndWait({
                address: toAddress(escrow), abi: MembaEscrowABI, functionName: "createContract",
                args: [toAddress(seller), title, milestoneTitles, milestoneAmounts.map(a => BigInt(a))],
            })
        },

        async fundMilestone(escrow: ContractRef, contractId: number, milestoneIdx: number, amount: string): Promise<TxResult> {
            return writeAndWait({
                address: toAddress(escrow), abi: MembaEscrowABI, functionName: "fundMilestone",
                args: [BigInt(contractId), BigInt(milestoneIdx)],
                value: BigInt(amount),
            })
        },

        async completeMilestone(escrow: ContractRef, contractId: number, milestoneIdx: number): Promise<TxResult> {
            return writeAndWait({
                address: toAddress(escrow), abi: MembaEscrowABI, functionName: "completeMilestone",
                args: [BigInt(contractId), BigInt(milestoneIdx)],
            })
        },

        async releaseFunds(escrow: ContractRef, contractId: number, milestoneIdx: number): Promise<TxResult> {
            return writeAndWait({
                address: toAddress(escrow), abi: MembaEscrowABI, functionName: "releaseFunds",
                args: [BigInt(contractId), BigInt(milestoneIdx)],
            })
        },

        // ── Utilities ────────────────────────────────────────

        getExplorerTxUrl(txHash: string): string {
            return config.explorerTxUrl.replace("{hash}", txHash)
        },

        getExplorerAddressUrl(address: ChainAddress): string {
            return config.explorerAddressUrl.replace("{address}", address.raw)
        },

        parseAddress(raw: string): ChainAddress {
            return toChainAddress(getAddress(raw)) // also checksums
        },

        async getNativeBalance(address: ChainAddress): Promise<string> {
            try {
                const bal = await publicClient.getBalance({ address: toAddress(address) })
                return formatEther(bal)
            } catch {
                return "0"
            }
        },
    }

    return provider
}

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
    keccak256,
    stringToHex,
    getAddress,
    type Abi,
    type Chain,
    type ContractFunctionName,
    type ContractFunctionArgs,
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

// These MUST mirror the Solidity enums exactly. They are positional and the
// compiler cannot check them, so each one names its source enum. Changing the
// order of a Solidity enum without updating the map here silently corrupts data.

/** Mirrors `MembaDAO.VoteType { Against, For, Abstain }` — NOT alphabetical.
 *  This was previously `{ yes: 0, no: 1, abstain: 2 }`, which sent every YES
 *  vote as Against and every NO vote as For. */
const VOTE_MAP = { no: 0, yes: 1, abstain: 2 } as const

/** Mirrors `MembaEscrow.ContractStatus { Active, Completed, Cancelled, Disputed }`. */
const ESCROW_STATUS_MAP = ["active", "completed", "cancelled", "disputed"] as const

/** Mirrors `MembaEscrow.MilestoneStatus { Pending, Funded, Completed, Released, Refunded }`.
 *  The contract has no per-milestone "disputed" state — disputes are contract-level —
 *  even though `EscrowMilestoneStatus` permits that value. */
const MILESTONE_STATUS_MAP = ["pending", "funded", "completed", "released", "refunded"] as const

/** Mirrors `MembaDAO.ProposalCategory { Governance, Treasury, Membership, Operations }`. */
const CATEGORY_MAP = ["governance", "treasury", "membership", "operations"] as const

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

    // Define the chain rather than omitting it. Without this viem never compares
    // the RPC's reported chain id against `config.evmChainId`, so a misconfigured
    // or hostile endpoint is trusted silently — and every write has to opt out of
    // the chain check entirely. Declaring it also enables multicall batching.
    if (config.evmChainId === undefined) {
        throw new ChainError(
            `Network ${config.chainId} is missing evmChainId`, "UNKNOWN", "evm",
        )
    }
    const chain = {
        id: config.evmChainId,
        name: config.label,
        nativeCurrency: {
            name: config.nativeToken.name,
            symbol: config.nativeToken.symbol,
            decimals: config.nativeToken.decimals,
        },
        rpcUrls: { default: { http: [config.rpcUrl, ...config.fallbackRpcUrls] } },
        testnet: config.isTestnet,
    } as const satisfies Chain

    const publicClient: PublicClient = createPublicClient({
        chain,
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

    /**
     * Write to a contract and wait for the receipt.
     *
     * Generic over the ABI on purpose. This previously took
     * `abi: readonly unknown[]` and cast the whole params object, which discarded
     * the `as const` inference the generated ABIs already provide — so every write
     * was unchecked. Four calls addressed functions that do not exist
     * (`createProposal`, `executeProposal`) or omitted required arguments
     * (`createToken` missing `salt` and its payable `value`), and the compiler had
     * no way to say so. Typing it this way turns each of those into a build error.
     */
    async function writeAndWait<
        const TAbi extends Abi,
        TFn extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
    >(params: {
        address: Address
        abi: TAbi
        functionName: TFn
        args?: ContractFunctionArgs<TAbi, "nonpayable" | "payable", TFn>
        value?: bigint
    }): Promise<TxResult> {
        const wc = requireWallet()
        try {
            const [account] = await wc.getAddresses()
            const hash = await wc.writeContract({
                ...params,
                account,
                chain,
            } as Parameters<typeof wc.writeContract>[0])
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
                    publicClient.readContract({ address: addr, abi: MembaDAOABI, functionName: "thresholdBps" }),
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
                // The contract exposes `getMembers() -> address[]` and `getMember(address)`.
                // There is no index-based accessor; the previous `getMemberByIndex` call
                // would have reverted with an unknown-selector error on every invocation.
                const addresses = await publicClient.readContract({
                    address: addr, abi: MembaDAOABI, functionName: "getMembers",
                })

                // Fetch details concurrently rather than in an awaited loop.
                return await Promise.all(
                    addresses.map(async (memberAddr) => {
                        const m = await publicClient.readContract({
                            address: addr, abi: MembaDAOABI, functionName: "getMember",
                            args: [memberAddr],
                        })
                        return {
                            address: toChainAddress(memberAddr),
                            votingPower: Number(m.votingPower),
                            roles: [...m.roles],
                        }
                    }),
                )
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
                // The real tuple is
                //   { proposer, title, description, category(uint8), createdAt,
                //     votingDeadline, forVotes, againstVotes, abstainVotes,
                //     executed, cancelled }
                // The previous cast claimed `status`, `yesVotes`, `noVotes` and
                // `totalVoters`, none of which exist — so every proposal rendered
                // as permanently "open" with NaN vote counts.
                const p = await publicClient.readContract({
                    address: addr, abi: MembaDAOABI, functionName: "getProposal",
                    args: [BigInt(proposalId)],
                })

                // There is no `status` field; it has to be derived. `proposalPassed`
                // is only meaningful once voting has closed.
                let status: CALProposal["status"]
                if (p.cancelled) {
                    status = "rejected"
                } else if (p.executed) {
                    status = "executed"
                } else if (BigInt(Math.floor(Date.now() / 1000)) <= p.votingDeadline) {
                    status = "open"
                } else {
                    const passed = await publicClient.readContract({
                        address: addr, abi: MembaDAOABI, functionName: "proposalPassed",
                        args: [BigInt(proposalId)],
                    })
                    status = passed ? "passed" : "rejected"
                }

                return {
                    id: proposalId,
                    title: p.title,
                    description: p.description,
                    category: CATEGORY_MAP[p.category] ?? String(p.category),
                    status,
                    proposer: toChainAddress(p.proposer),
                    yesVotes: Number(p.forVotes),
                    noVotes: Number(p.againstVotes),
                    abstainVotes: Number(p.abstainVotes),
                    // The contract records weighted voting power, not a headcount, and
                    // exposes no voter count. This is the total power cast.
                    totalVoters: Number(p.forVotes + p.againstVotes + p.abstainVotes),
                    createdAt: new Date(Number(p.createdAt) * 1000).toISOString(),
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
            // The function is `propose(string,string,uint8)`. There is no
            // `createProposal`, and no deadline argument — the voting period is a
            // contract constant (DEFAULT_VOTING_PERIOD), not a caller input.
            const categoryIndex = CATEGORY_MAP.indexOf(category.toLowerCase() as typeof CATEGORY_MAP[number])
            if (categoryIndex < 0) {
                throw new ChainError(
                    `Unknown proposal category "${category}" (expected one of ${CATEGORY_MAP.join(", ")})`,
                    "CONTRACT_REVERT", "evm",
                )
            }
            return writeAndWait({
                address: toAddress(dao), abi: MembaDAOABI, functionName: "propose",
                args: [title, description, categoryIndex],
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
                // The function is `execute(uint256)`; `executeProposal` does not exist.
                address: toAddress(dao), abi: MembaDAOABI, functionName: "execute",
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
            // `createToken` is payable and takes a CREATE2 salt. The previous call
            // omitted both, so it could not encode and would have reverted on the
            // fee check regardless.
            const fee = await publicClient.readContract({
                address: addrs.tokenFactory, abi: MembaTokenFactoryABI, functionName: "creationFee",
            })
            // Deterministic per (name, symbol). `msg.sender` is part of the child's
            // init code, so two creators using the same salt do not collide; only the
            // same creator reusing it for identical params does, which reverts cleanly.
            const salt = keccak256(stringToHex(`${name}:${symbol}`))
            return writeAndWait({
                address: addrs.tokenFactory, abi: MembaTokenFactoryABI, functionName: "createToken",
                args: [name, symbol, decimals, BigInt(initialSupply), salt],
                value: fee,
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

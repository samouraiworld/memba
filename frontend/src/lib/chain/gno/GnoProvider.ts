/**
 * GnoProvider — ChainProvider implementation for Gno.land chains.
 *
 * Wraps the existing Memba Gno integration code (useAdena, ABCI queries,
 * MsgCall builders, doContractBroadcast) behind the ChainProvider interface.
 *
 * This is a THIN ADAPTER — no logic duplication. Every method delegates to
 * existing functions in lib/dao/, lib/grc20.ts, lib/grc721.ts, etc.
 *
 * @module lib/chain/gno/GnoProvider
 */

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

// ── Existing Gno integration imports ─────────────────────────
// These are the EXISTING functions we wrap — no duplication.

import {
    getDAOConfig as gnoGetDAOConfig,
    getDAOMembers as gnoGetDAOMembers,
    getDAOProposals as gnoGetDAOProposals,
    getProposalDetail as gnoGetProposalDetail,
    buildVoteMsg,
    buildExecuteMsg,
    buildProposeMsg,
    buildProposeAddMemberMsg,
    buildProposeRemoveMemberMsg,
} from "../../dao"

import {
    doContractBroadcast,
    listFactoryTokens,
    type AminoMsg,
} from "../../grc20"

import {
    listCollectionTokens,
    getNFTOwner,
    getTokenURI,
} from "../../grc721"

import { GNO_RPC_URL } from "../../config"

// ── GnoProvider Implementation ───────────────────────────────

/**
 * Create a GnoProvider for the given network configuration.
 *
 * NOTE: Wallet connection is managed externally by the useAdena hook.
 * This provider reads wallet state from the hook's global state.
 */
export function createGnoProvider(config: CALNetworkConfig): ChainProvider {
    const rpcUrl = config.rpcUrl

    // Wallet state is managed by useAdena hook; this is read from module-level state.
    // The hook calls setWalletRpcContext() which is used by doContractBroadcast.
    let _walletAddress: string | null = null
    let _connected = false

    /**
     * Convert a raw Gno address string to a ChainAddress.
     */
    function toChainAddress(raw: string): ChainAddress {
        return { raw, family: "gno" }
    }

    /**
     * Convert a Gno tx result to the CAL TxResult format.
     */
    function toTxResult(hash: string, success: boolean, error?: string): TxResult {
        return {
            hash,
            success,
            blockHeight: 0, // Gno DoContract doesn't return block height directly
            error,
        }
    }

    /**
     * Broadcast a set of Amino messages via the existing doContractBroadcast.
     */
    async function broadcast(msgs: AminoMsg[], memo: string): Promise<TxResult> {
        try {
            const { hash } = await doContractBroadcast(msgs, memo)
            return toTxResult(hash, true)
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)

            // Map known error patterns to ChainErrorCode
            if (/user (rejected|denied)|cancelled/i.test(msg)) {
                throw new ChainError(msg, "USER_REJECTED", "gno", err)
            }
            if (/insufficient funds/i.test(msg)) {
                throw new ChainError(msg, "INSUFFICIENT_FUNDS", "gno", err)
            }
            if (/not a member|unauthorized/i.test(msg)) {
                throw new ChainError(msg, "CONTRACT_REVERT", "gno", err)
            }
            if (/wallet not available/i.test(msg)) {
                throw new ChainError(msg, "WALLET_NOT_CONNECTED", "gno", err)
            }
            if (/timeout|network/i.test(msg)) {
                throw new ChainError(msg, "NETWORK_ERROR", "gno", err)
            }

            throw new ChainError(msg, "UNKNOWN", "gno", err)
        }
    }

    // ── Provider Object ──────────────────────────────────────

    const provider: ChainProvider = {
        family: "gno",
        network: config,

        // ── Wallet ───────────────────────────────────────────

        async connect(): Promise<ChainAddress> {
            // Wallet connection is managed by useAdena hook.
            // This method is a no-op on Gno — the hook handles Adena's AddEstablish.
            // In practice, the React layer calls useAdena().connect() directly.
            throw new ChainError(
                "Use useAdena().connect() for Gno wallet connection",
                "WALLET_NOT_CONNECTED",
                "gno",
            )
        },

        async disconnect(): Promise<void> {
            _walletAddress = null
            _connected = false
        },

        getWalletState(): WalletState {
            return {
                connected: _connected,
                address: _walletAddress ? toChainAddress(_walletAddress) : null,
                family: "gno",
            }
        },

        isConnected(): boolean {
            return _connected
        },

        // ── Auth ─────────────────────────────────────────────

        async signLoginChallenge(challenge: string): Promise<string> {
            // Delegates to useAdena().signLogin() which builds an ADR-036 document.
            // The actual signing is done via the hook; this is a bridge method.
            throw new ChainError(
                "Use useAdena().signLogin() for Gno auth challenges",
                "WALLET_NOT_CONNECTED",
                "gno",
            )
        },

        // ── Reads (DAO) ──────────────────────────────────────

        async getDAOConfig(dao: ContractRef): Promise<CALDAOConfig> {
            const daoConfig = await gnoGetDAOConfig(rpcUrl, dao.id)
            if (!daoConfig) {
                throw new ChainError(`DAO not found: ${dao.id}`, "CONTRACT_REVERT", "gno")
            }
            return {
                name: daoConfig.name,
                description: daoConfig.description,
                threshold: parseInt(daoConfig.threshold, 10) || 5100,
                quorum: 0, // Gno DAOs don't have a separate quorum setting
                memberCount: daoConfig.memberCount,
            }
        },

        async getDAOMembers(dao: ContractRef): Promise<CALMember[]> {
            const members = await gnoGetDAOMembers(rpcUrl, dao.id)
            return members.map(m => ({
                address: toChainAddress(m.address),
                roles: m.roles,
                votingPower: m.votingPower,
                username: m.username || undefined,
            }))
        },

        async getDAOProposals(dao: ContractRef): Promise<CALProposal[]> {
            const proposals = await gnoGetDAOProposals(rpcUrl, dao.id)
            return proposals.map(p => ({
                id: p.id,
                title: p.title,
                description: p.description,
                category: p.category,
                status: p.status,
                proposer: toChainAddress(p.proposer),
                yesVotes: p.yesVotes,
                noVotes: p.noVotes,
                abstainVotes: p.abstainVotes,
                totalVoters: p.totalVoters,
                createdAt: p.createdAt,
            }))
        },

        async getDAOProposal(dao: ContractRef, proposalId: number): Promise<CALProposal | null> {
            const detail = await gnoGetProposalDetail(rpcUrl, dao.id, proposalId)
            if (!detail) return null
            return {
                id: detail.id,
                title: detail.title,
                description: detail.description,
                category: detail.category,
                status: detail.status,
                proposer: toChainAddress(detail.proposer),
                yesVotes: detail.yesVotes,
                noVotes: detail.noVotes,
                abstainVotes: detail.abstainVotes,
                totalVoters: detail.totalVoters,
                createdAt: detail.createdAt,
            }
        },

        async isDAOMember(dao: ContractRef, address: ChainAddress): Promise<boolean> {
            const members = await gnoGetDAOMembers(rpcUrl, dao.id)
            return members.some(m => m.address === address.raw)
        },

        // ── Writes (DAO) ─────────────────────────────────────

        async propose(dao: ContractRef, title: string, description: string, category: string): Promise<TxResult> {
            if (!_walletAddress) throw new ChainError("Wallet not connected", "WALLET_NOT_CONNECTED", "gno")
            const msg = buildProposeMsg(_walletAddress, dao.id, title, description, category)
            return broadcast([msg], `Propose: ${title}`)
        },

        async vote(dao: ContractRef, proposalId: number, support: "yes" | "no" | "abstain"): Promise<TxResult> {
            if (!_walletAddress) throw new ChainError("Wallet not connected", "WALLET_NOT_CONNECTED", "gno")
            // Map CAL vote to Gno vote (true = yes, false = no)
            // Note: Gno basedao only supports yes/no, not abstain
            const isYes = support === "yes"
            const msg = buildVoteMsg(_walletAddress, dao.id, proposalId, isYes)
            return broadcast([msg], `Vote ${support} on proposal #${proposalId}`)
        },

        async executeProposal(dao: ContractRef, proposalId: number): Promise<TxResult> {
            if (!_walletAddress) throw new ChainError("Wallet not connected", "WALLET_NOT_CONNECTED", "gno")
            const msg = buildExecuteMsg(_walletAddress, dao.id, proposalId)
            return broadcast([msg], `Execute proposal #${proposalId}`)
        },

        async addMember(dao: ContractRef, address: ChainAddress, votingPower: number, roles: string[]): Promise<TxResult> {
            if (!_walletAddress) throw new ChainError("Wallet not connected", "WALLET_NOT_CONNECTED", "gno")
            const msg = buildProposeAddMemberMsg(_walletAddress, dao.id, address.raw)
            return broadcast([msg], `Propose add member ${address.raw}`)
        },

        async removeMember(dao: ContractRef, address: ChainAddress): Promise<TxResult> {
            if (!_walletAddress) throw new ChainError("Wallet not connected", "WALLET_NOT_CONNECTED", "gno")
            const msg = buildProposeRemoveMemberMsg(_walletAddress, dao.id, address.raw)
            return broadcast([msg], `Propose remove member ${address.raw}`)
        },

        // ── Reads (Tokens) ───────────────────────────────────

        async getTokenInfo(_token: ContractRef): Promise<TokenInfo | null> {
            // TODO: Implement via grc20 queryEval when needed
            return null
        },

        async getTokenBalance(_token: ContractRef, _address: ChainAddress): Promise<string> {
            // TODO: Implement via grc20 queryEval
            return "0"
        },

        async listTokens(): Promise<TokenInfo[]> {
            try {
                const tokens = await listFactoryTokens(rpcUrl)
                return tokens.map(t => ({
                    id: t.path,
                    name: t.name,
                    symbol: t.symbol,
                    decimals: 6, // Gno GRC20 default
                    totalSupply: "0",
                }))
            } catch {
                return []
            }
        },

        // ── Writes (Tokens) ──────────────────────────────────

        async createToken(_name: string, _symbol: string, _decimals: number, _initialSupply: string): Promise<TxResult> {
            // TODO: Build MsgCall for tokenfactory.CreateToken
            throw new ChainError("Token creation via CAL not yet implemented for Gno", "UNKNOWN", "gno")
        },

        async mintTokens(_token: ContractRef, _to: ChainAddress, _amount: string): Promise<TxResult> {
            // TODO: Build MsgCall for token.Mint
            throw new ChainError("Token minting via CAL not yet implemented for Gno", "UNKNOWN", "gno")
        },

        // ── Reads (NFT) ──────────────────────────────────────

        async getNFTsByOwner(collection: ContractRef, owner: ChainAddress): Promise<CALNFT[]> {
            try {
                // Use listCollectionTokens and filter by owner
                // collection.id format: "realmPath" — we use "default" as collectionID
                const tokens = await listCollectionTokens(collection.id, "default")
                return tokens
                    .filter(t => t.owner === owner.raw)
                    .map(t => ({
                        tokenId: t.tokenId,
                        owner: toChainAddress(t.owner),
                        tokenURI: t.tokenURI,
                        collection,
                    }))
            } catch {
                return []
            }
        },

        async getNFT(collection: ContractRef, tokenId: string): Promise<CALNFT | null> {
            try {
                const owner = await getNFTOwner(rpcUrl, collection.id, "default", tokenId)
                const uri = await getTokenURI(rpcUrl, collection.id, "default", tokenId)
                if (!owner) return null
                return {
                    tokenId,
                    owner: toChainAddress(owner),
                    tokenURI: uri || "",
                    collection,
                }
            } catch {
                return null
            }
        },

        // ── Reads (Escrow) ───────────────────────────────────

        async getEscrowContract(_escrow: ContractRef, _contractId: number): Promise<CALEscrowContract | null> {
            // TODO: Implement via escrow realm queryEval
            return null
        },

        // ── Writes (Escrow) ──────────────────────────────────

        async createEscrowContract(
            _escrow: ContractRef,
            _seller: ChainAddress,
            _title: string,
            _milestoneTitles: string[],
            _milestoneAmounts: string[],
        ): Promise<TxResult> {
            throw new ChainError("Escrow creation via CAL not yet implemented for Gno", "UNKNOWN", "gno")
        },

        async fundMilestone(_escrow: ContractRef, _contractId: number, _milestoneIdx: number, _amount: string): Promise<TxResult> {
            throw new ChainError("Escrow funding via CAL not yet implemented for Gno", "UNKNOWN", "gno")
        },

        async completeMilestone(_escrow: ContractRef, _contractId: number, _milestoneIdx: number): Promise<TxResult> {
            throw new ChainError("Escrow completion via CAL not yet implemented for Gno", "UNKNOWN", "gno")
        },

        async releaseFunds(_escrow: ContractRef, _contractId: number, _milestoneIdx: number): Promise<TxResult> {
            throw new ChainError("Escrow release via CAL not yet implemented for Gno", "UNKNOWN", "gno")
        },

        // ── Utilities ────────────────────────────────────────

        getExplorerTxUrl(txHash: string): string {
            return config.explorerTxUrl.replace("{hash}", txHash)
        },

        getExplorerAddressUrl(address: ChainAddress): string {
            return config.explorerAddressUrl.replace("{address}", address.raw)
        },

        parseAddress(raw: string): ChainAddress {
            return toChainAddress(raw)
        },

        async getNativeBalance(_address: ChainAddress): Promise<string> {
            // TODO: Query bank balance via ABCI
            return "0"
        },
    }

    // ── Sync wallet state from useAdena ──────────────────────
    // The GnoProvider exposes a method to update wallet state from the hook.
    // This is called by the ChainContextProvider when useAdena state changes.
    ;(provider as GnoProviderExtended).setWalletState = (address: string | null, connected: boolean) => {
        _walletAddress = address
        _connected = connected
    }

    return provider
}

/** Extended GnoProvider with wallet state setter (used by ChainContextProvider). */
export interface GnoProviderExtended extends ChainProvider {
    setWalletState(address: string | null, connected: boolean): void
}

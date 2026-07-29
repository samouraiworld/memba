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
    getMemberRole as gnoGetMemberRole,
    buildVoteMsg,
    buildExecuteMsg,
    buildProposeMsg,
    buildProposeAddMemberMsg,
    buildProposeRemoveMemberMsg,
} from "../../dao"

import {
    doContractBroadcast,
    listFactoryTokens,
    GRC20_FACTORY_PATH,
    type AminoMsg,
} from "../../grc20"

import {
    listCollectionTokens,
    getNFTOwner,
    getTokenURI,
} from "../../grc721"


// ── GnoProvider Implementation ───────────────────────────────

/** Wallet state pushed into the provider by the React layer (B-5 Phase 0).
 *  Object (not a bare string) so future fields — pubkey, chainId — are
 *  additive rather than signature breaks. */
export interface GnoWalletBridgeState {
    /** Connected wallet address (g1…). */
    address: string
}

/**
 * Create a GnoProvider for the given network configuration.
 *
 * NOTE: Wallet CONNECTION is managed externally by the useAdena hook (Adena's
 * AddEstablish/GetAccount flow, RPC-trust validation, reconnect persistence).
 * The provider only needs the resulting address to build MsgCall messages —
 * broadcast itself rides the existing doContractBroadcast path, which takes
 * its safety context from the hook's setWalletRpcContext. The React layer
 * (ChainContextProvider, wired in B-5 Phase 1) pushes the hook's state in via
 * setWalletBridge — the exact counterpart of EvmProvider.setWalletClient.
 */
export function createGnoProvider(config: CALNetworkConfig): GnoProviderExtended {
    const rpcUrl = config.rpcUrl

    let _walletAddress: string | null = null
    let _connected = false

    /**
     * Convert a raw Gno address string to a ChainAddress.
     */
    function toChainAddress(raw: string): ChainAddress {
        return { raw, family: "gno" }
    }

    /**
     * Memberstore realm path for a DAO, resolved once per provider instance.
     *
     * Tier DAOs hold membership in a separate realm whose path the DAO's own
     * config reports. That path is fixed configuration for a deployed realm — it
     * does not change between renders — so caching it for the provider's
     * lifetime is safe, and it keeps `getDAOMember` from paying an extra config
     * read on every lookup (this hook runs once per saved DAO card).
     *
     * A DAO that does not render, or reports no memberstore, resolves to
     * `undefined`; `getMemberRole` then falls back to parsing the DAO's own
     * member list, exactly as the direct path does.
     */
    const memberstoreCache = new Map<string, string | undefined>()
    async function resolveMemberstorePath(daoId: string): Promise<string | undefined> {
        if (memberstoreCache.has(daoId)) return memberstoreCache.get(daoId)
        let path: string | undefined
        try {
            const cfg = await gnoGetDAOConfig(rpcUrl, daoId)
            path = cfg?.memberstorePath?.trim() || undefined
        } catch {
            // A failed config read must not fail the membership lookup — fall
            // through to the render-parse path rather than reporting "not a
            // member", which would silently strip someone's role badge.
            path = undefined
            return path
        }
        memberstoreCache.set(daoId, path)
        return path
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

    const provider: GnoProviderExtended = {
        family: "gno",
        network: config,

        // ── Wallet ───────────────────────────────────────────

        setWalletBridge(wallet: GnoWalletBridgeState | null) {
            _walletAddress = wallet?.address || null
            _connected = _walletAddress !== null
        },

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

        async signLoginChallenge(_challenge: string): Promise<string> {
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
                // `daoConfig.threshold` is a display string such as "66%", and is ""
                // when the render omits it. `parseInt("66%") || 5100` read that as
                // 66 basis points (0.66%), and turned an absent value into a
                // fabricated 51% — the exact default parseDaoThreshold() refuses to
                // invent. Convert percent to basis points, or report null.
                // A non-numeric threshold (e.g. "supermajority") made parseFloat
                // return NaN, which Math.round passed straight through — so
                // `threshold` could be NaN, which is neither a number nor the
                // honest `null`. Guard it: unparseable means unreported.
                threshold: (() => {
                    if (!daoConfig.threshold) return null
                    const pct = parseFloat(daoConfig.threshold)
                    return Number.isFinite(pct) ? Math.round(pct * 100) : null
                })(),
                // Relay the realm's own wording so the UI shows what the chain
                // said rather than a re-rendering of the number above.
                thresholdLabel: daoConfig.threshold?.trim() || undefined,
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
                // Reported-not-derived (B-7). The realm publishes its own vote
                // percentages and a display author; relay them rather than
                // recomputing from the counts, which can disagree under
                // weighted voting or rounding. `enrichFailed` becomes
                // `votesUnavailable` so a failed vote RPC cannot render as a
                // genuine zero-vote proposal.
                author: p.author?.trim() || undefined,
                yesPercent: p.yesPercent,
                noPercent: p.noPercent,
                votesUnavailable: p.enrichFailed || undefined,
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

        async getDAOMember(dao: ContractRef, address: ChainAddress): Promise<CALMember | null> {
            // Gno tier DAOs (GovDAO and friends) keep membership in a SEPARATE
            // memberstore realm, and the lookup has to be routed there. That path
            // lives in the DAO's own config, so the caller would otherwise have to
            // fetch the config, carry a Gno-only `memberstorePath`, and hand it
            // back — which is precisely the chain detail this layer absorbs.
            const memberstorePath = await resolveMemberstorePath(dao.id)
            const member = await gnoGetMemberRole(rpcUrl, dao.id, address.raw, memberstorePath)
            if (!member) return null
            return {
                address: toChainAddress(member.address),
                roles: member.roles ?? [],
                votingPower: member.votingPower ?? 0,
                // "" is absence, not an empty name/tier — omit rather than relay a blank.
                username: member.username?.trim() || undefined,
                tier: member.tier?.trim() || undefined,
            }
        },

        // ── Writes (DAO) ─────────────────────────────────────

        async propose(dao: ContractRef, title: string, description: string, category: string): Promise<TxResult> {
            if (!_walletAddress) throw new ChainError("Wallet not connected", "WALLET_NOT_CONNECTED", "gno")
            const msg = buildProposeMsg(_walletAddress, dao.id, title, description, category)
            return broadcast([msg], `Propose: ${title}`)
        },

        async vote(dao: ContractRef, proposalId: number, support: "yes" | "no" | "abstain"): Promise<TxResult> {
            if (!_walletAddress) throw new ChainError("Wallet not connected", "WALLET_NOT_CONNECTED", "gno")
            // `buildVoteMsg` has always accepted "YES" | "NO" | "ABSTAIN".
            // A previous comment here claimed Gno basedao supports only yes/no and
            // passed a boolean, which would have recorded every abstention as a NO.
            const GNO_VOTE = { yes: "YES", no: "NO", abstain: "ABSTAIN" } as const
            const msg = buildVoteMsg(_walletAddress, dao.id, proposalId, GNO_VOTE[support])
            return broadcast([msg], `Vote ${support} on proposal #${proposalId}`)
        },

        async executeProposal(dao: ContractRef, proposalId: number): Promise<TxResult> {
            if (!_walletAddress) throw new ChainError("Wallet not connected", "WALLET_NOT_CONNECTED", "gno")
            const msg = buildExecuteMsg(_walletAddress, dao.id, proposalId)
            return broadcast([msg], `Execute proposal #${proposalId}`)
        },

        async addMember(dao: ContractRef, address: ChainAddress, votingPower: number, roles: string[]): Promise<TxResult> {
            if (!_walletAddress) throw new ChainError("Wallet not connected", "WALLET_NOT_CONNECTED", "gno")
            // `buildProposeAddMemberMsg` takes (caller, realmPath, target, power, roles).
            // The previous call passed only the first three, silently dropping the
            // caller's chosen voting power and roles — onboarding every member at
            // whatever the realm defaults to. `roles` is a comma-separated string here,
            // not an array.
            const msg = buildProposeAddMemberMsg(
                _walletAddress, dao.id, address.raw, votingPower, roles.join(","),
            )
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
                // grc20.TokenInfo carries no `path` — reading `t.path` yielded
                // `id: undefined` for every token. The factory addresses a token by
                // its symbol (`<factory path>:SYMBOL`), so that is the stable id.
                // `decimals`/`totalSupply` are left as the list view reports them
                // (the factory render omits both; they are filled by a per-token
                // query). Hardcoding decimals to 6 here misreported every token.
                return tokens.map(t => ({
                    id: `${GRC20_FACTORY_PATH}:${t.symbol}`,
                    name: t.name,
                    symbol: t.symbol,
                    decimals: t.decimals,
                    totalSupply: t.totalSupply,
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
                // Use listCollectionTokens and filter by owner. The realm
                // multiplexes collections; ContractRef.subId selects one
                // (B-5 Phase 2b) — absent means the "default" collection.
                const tokens = await listCollectionTokens(rpcUrl, collection.id, collection.subId ?? "default")
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
                // B-4: grc721 reads take rpcUrl first and thread it to the
                // transport, so this provider's per-network endpoint is honored
                // (dao/shared routes a non-active endpoint through abciQueryAt —
                // direct, no cross-network failover). Owner+URI in PARALLEL —
                // the v3 grid enumerates through this per token, so sequential
                // awaits would double its load time (B-5 Phase 2b).
                const subId = collection.subId ?? "default"
                const [owner, uri] = await Promise.all([
                    getNFTOwner(rpcUrl, collection.id, subId, tokenId),
                    getTokenURI(rpcUrl, collection.id, subId, tokenId),
                ])
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

    return provider
}

/** Provider type with the wallet bridge (what createGnoProvider returns).
 *  Replaces the old cast-attached `setWalletState` extension, which was
 *  invisible in the return type and called by nothing. */
export interface GnoProviderExtended extends ChainProvider {
    /** Inject/update the wallet state (called by the useAdena bridge in Phase 1). */
    setWalletBridge(wallet: GnoWalletBridgeState | null): void
}

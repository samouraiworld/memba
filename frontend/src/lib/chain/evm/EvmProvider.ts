/**
 * EvmProvider — ChainProvider implementation for EVM chains (Robinhood Chain).
 *
 * Stub implementation. Will be fully implemented using wagmi + viem when
 * EVM contracts are deployed. All write methods throw "not yet implemented".
 * Read methods return empty/null results.
 *
 * @module lib/chain/evm/EvmProvider
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

/**
 * Create an EvmProvider for the given network configuration.
 *
 * NOTE: This is a STUB. Full implementation will use:
 * - wagmi for wallet connection (ConnectKit / RainbowKit)
 * - viem for contract reads/writes
 * - SIWE (Sign-In With Ethereum) for authentication
 */
export function createEvmProvider(config: CALNetworkConfig): ChainProvider {
    let _walletAddress: string | null = null
    let _connected = false

    function toChainAddress(raw: string): ChainAddress {
        return { raw, family: "evm" }
    }

    function notImplemented(method: string): never {
        throw new ChainError(
            `${method} not yet implemented for EVM. Contracts are not deployed.`,
            "UNKNOWN",
            "evm",
        )
    }

    const provider: ChainProvider = {
        family: "evm",
        network: config,

        // ── Wallet ───────────────────────────────────────────
        // Will use wagmi's useConnect / useAccount / useDisconnect

        async connect(): Promise<ChainAddress> {
            notImplemented("connect")
        },

        async disconnect(): Promise<void> {
            _walletAddress = null
            _connected = false
        },

        getWalletState(): WalletState {
            return {
                connected: _connected,
                address: _walletAddress ? toChainAddress(_walletAddress) : null,
                family: "evm",
            }
        },

        isConnected(): boolean {
            return _connected
        },

        // ── Auth ─────────────────────────────────────────────
        // Will use SIWE (EIP-4361) via viem's signMessage

        async signLoginChallenge(_challenge: string): Promise<string> {
            notImplemented("signLoginChallenge")
        },

        // ── Reads (DAO) ──────────────────────────────────────
        // Will use viem readContract() against MembaDAO ABI

        async getDAOConfig(_dao: ContractRef): Promise<CALDAOConfig> {
            notImplemented("getDAOConfig")
        },

        async getDAOMembers(_dao: ContractRef): Promise<CALMember[]> {
            return []
        },

        async getDAOProposals(_dao: ContractRef): Promise<CALProposal[]> {
            return []
        },

        async getDAOProposal(_dao: ContractRef, _proposalId: number): Promise<CALProposal | null> {
            return null
        },

        async isDAOMember(_dao: ContractRef, _address: ChainAddress): Promise<boolean> {
            return false
        },

        // ── Writes (DAO) ─────────────────────────────────────
        // Will use viem writeContract() against MembaDAO ABI

        async propose(_dao: ContractRef, _title: string, _description: string, _category: string): Promise<TxResult> {
            notImplemented("propose")
        },

        async vote(_dao: ContractRef, _proposalId: number, _support: "yes" | "no" | "abstain"): Promise<TxResult> {
            notImplemented("vote")
        },

        async executeProposal(_dao: ContractRef, _proposalId: number): Promise<TxResult> {
            notImplemented("executeProposal")
        },

        async addMember(_dao: ContractRef, _address: ChainAddress, _votingPower: number, _roles: string[]): Promise<TxResult> {
            notImplemented("addMember")
        },

        async removeMember(_dao: ContractRef, _address: ChainAddress): Promise<TxResult> {
            notImplemented("removeMember")
        },

        // ── Reads (Tokens) ───────────────────────────────────
        // Will use viem readContract() against ERC-20 ABI

        async getTokenInfo(_token: ContractRef): Promise<TokenInfo | null> {
            return null
        },

        async getTokenBalance(_token: ContractRef, _address: ChainAddress): Promise<string> {
            return "0"
        },

        async listTokens(): Promise<TokenInfo[]> {
            return []
        },

        // ── Writes (Tokens) ──────────────────────────────────

        async createToken(_name: string, _symbol: string, _decimals: number, _initialSupply: string): Promise<TxResult> {
            notImplemented("createToken")
        },

        async mintTokens(_token: ContractRef, _to: ChainAddress, _amount: string): Promise<TxResult> {
            notImplemented("mintTokens")
        },

        // ── Reads (NFT) ──────────────────────────────────────

        async getNFTsByOwner(_collection: ContractRef, _owner: ChainAddress): Promise<CALNFT[]> {
            return []
        },

        async getNFT(_collection: ContractRef, _tokenId: string): Promise<CALNFT | null> {
            return null
        },

        // ── Reads (Escrow) ───────────────────────────────────

        async getEscrowContract(_escrow: ContractRef, _contractId: number): Promise<CALEscrowContract | null> {
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
            notImplemented("createEscrowContract")
        },

        async fundMilestone(_escrow: ContractRef, _contractId: number, _milestoneIdx: number, _amount: string): Promise<TxResult> {
            notImplemented("fundMilestone")
        },

        async completeMilestone(_escrow: ContractRef, _contractId: number, _milestoneIdx: number): Promise<TxResult> {
            notImplemented("completeMilestone")
        },

        async releaseFunds(_escrow: ContractRef, _contractId: number, _milestoneIdx: number): Promise<TxResult> {
            notImplemented("releaseFunds")
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
            // TODO: viem publicClient.getBalance()
            return "0"
        },
    }

    return provider
}

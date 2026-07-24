/**
 * Chain Abstraction Layer (CAL) — Public API
 *
 * Re-exports all public types, interfaces, hooks, and utilities
 * from the chain/ module. UI components import from here:
 *
 *   import { useChain, type ChainProvider, type CALProposal } from "../../lib/chain"
 *
 * @module lib/chain
 */

// Types
export type {
    ChainFamily,
    ChainId,
    ChainAddress,
    TxResult,
    TxStatus,
    ContractRef,
    TokenInfo,
    NativeToken,
    CALMember,
    CALProposal,
    CALDAOConfig,
    CALNFT,
    CALEscrowContract,
    CALMilestone,
    EscrowContractStatus,
    EscrowMilestoneStatus,
    CALNetworkConfig,
} from "./types"

// Utilities
export {
    isGnoAddress,
    isEvmAddress,
    formatAddress,
} from "./types"

// Provider interface & errors
export type { ChainProvider, WalletState } from "./provider"
export { ChainError, type ChainErrorCode } from "./provider"

// React context & hook
export { ChainContext, useChain, type ChainContextValue } from "./context"
export { ChainContextProvider, type ChainContextProviderProps } from "./ChainContextProvider"

// Registry
export {
    registerProviderFactory,
    getProvider,
    clearProviderCache,
    ALL_NETWORKS,
    getNetworkConfig,
    getNetworksByFamily,
    type ProviderFactory,
} from "./registry"

// Auth
export type {
    LoginChallenge,
    LoginProof,
    AuthResult,
    AuthStrategy,
} from "./auth"
export { buildSiweMessage } from "./auth"

// Transactions
export {
    useTransaction,
    createTxNotification,
    getExplorerName,
    formatTxHash,
    type TxState,
    type TxNotification,
    type TxNotificationType,
} from "./tx"

// Events & Notifications
export {
    useNotifications,
    eventToNotification,
    type ChainEvent,
    type EventFilter,
    type NotificationItem,
} from "./events"

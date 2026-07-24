/**
 * EVM chain provider — barrel export.
 * @module lib/chain/evm
 */
export { createEvmProvider, type EvmProviderOptions } from "./EvmProvider"
export { getContractAddresses, EVM_CONTRACT_ADDRESSES, type EvmContractAddresses } from "./addresses"
export * from "./abi"

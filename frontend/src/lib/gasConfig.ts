/**
 * Shared gas configuration — reads user preferences from localStorage.
 *
 * Usage:
 *   import { getGasConfig } from "../lib/gasConfig"
 *   const gas = getGasConfig()
 *   // gas.fee = user-configured fee (default 1M ugnot)
 *   // gas.wanted = user-configured gas limit (default 10M)
 *   // gas.deployWanted = elevated gas for deploy txs (5x wanted)
 */

const SETTINGS_KEY = "memba_settings"

export interface GasConfig {
    /** Gas fee in ugnot. Default: 1,000,000 (1 GNOT). */
    fee: number
    /** Gas limit for regular transactions. Default: 10,000,000. */
    wanted: number
    /** Gas limit for deploy transactions (5x wanted). */
    deployWanted: number
}

const DEFAULT_GAS_WANTED = 10_000_000
const DEFAULT_GAS_FEE = 1_000_000
const DEPLOY_MULTIPLIER = 5

/**
 * Read gas configuration from user settings (localStorage).
 * Falls back to safe defaults if not configured.
 */
export function getGasConfig(): GasConfig {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            const wanted = typeof parsed.gasWanted === "number" && parsed.gasWanted > 0
                ? parsed.gasWanted
                : DEFAULT_GAS_WANTED
            const fee = typeof parsed.gasFee === "number" && parsed.gasFee > 0
                ? parsed.gasFee
                : DEFAULT_GAS_FEE
            return { fee, wanted, deployWanted: wanted * DEPLOY_MULTIPLIER }
        }
    } catch { /* ignore corrupt settings */ }
    return {
        fee: DEFAULT_GAS_FEE,
        wanted: DEFAULT_GAS_WANTED,
        deployWanted: DEFAULT_GAS_WANTED * DEPLOY_MULTIPLIER,
    }
}

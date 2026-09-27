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

export const DEFAULT_GAS_WANTED = 10_000_000
export const DEFAULT_GAS_FEE = 1_000_000
const DEPLOY_MULTIPLIER = 5
// A deploy uses five times the regular limit. Its 500M ceiling is enforced by
// the broadcaster, so the saved regular default must stay within 100M.
export const MAX_DEFAULT_GAS_WANTED = 100_000_000
// This flat default is paid in ugnot (10 GNOT maximum). Explicit operation
// fees can have different budgets and are validated by their own callers.
export const MAX_DEFAULT_GAS_FEE_UGNOT = 10_000_000

export function validDefaultGasWanted(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_DEFAULT_GAS_WANTED
}

export function validDefaultGasFee(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_DEFAULT_GAS_FEE_UGNOT
}

/** Reject partial numbers, decimals, signs, and exponential notation from inputs. */
export function parseDefaultGasInput(raw: string, max: number): number | null {
    if (!/^\d+$/.test(raw)) return null
    const value = Number(raw)
    return Number.isSafeInteger(value) && value > 0 && value <= max ? value : null
}

/**
 * Read gas configuration from user settings (localStorage).
 * Falls back to safe defaults if not configured.
 */
export function getGasConfig(): GasConfig {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            const wanted = validDefaultGasWanted(parsed.gasWanted)
                ? parsed.gasWanted
                : DEFAULT_GAS_WANTED
            const fee = validDefaultGasFee(parsed.gasFee)
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

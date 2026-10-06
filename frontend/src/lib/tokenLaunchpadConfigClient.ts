/** Whether a Launchpad lane takes new actions in a currency now: config's
 * `ActionStatusJSON`, schema `launchpad-config-action-v1`. Exits never depend on it.
 */
import { readLaunchpad, readLaunchpadJSON, TokenLaunchpadReadError } from "./tokenLaunchpadClient"

export const TOKEN_LAUNCHPAD_CONFIG_PATH = "gno.land/r/samcrew/launchpad/config/v1"
export type LaunchpadLane = "direct" | "fairsale" | "airdrop" | "collection" | "nft_drops" | "nft_market"
const MAX_INT64 = 9223372036854775807n

export interface LaunchpadActionStatus {
    lane: LaunchpadLane
    currency: string
    version: bigint
    paused: boolean
    allowlisted: boolean
    laneReady: boolean
    /** Not paused, the currency listed and the lane's terms set: the lane takes new actions. */
    open: boolean
}

function invalid(message: string): never {
    throw new TokenLaunchpadReadError("invalid_response", `Launchpad config response: ${message}`)
}

function bool(row: Record<string, unknown>, key: string): boolean {
    if (typeof row[key] !== "boolean") invalid(`invalid ${key}`)
    return row[key] as boolean
}

// Keys the schema does not name are ignored, so the realm can add fields.
export function parseActionStatus(value: unknown, lane: LaunchpadLane, currency: string): LaunchpadActionStatus {
    if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("expected an object")
    const row = value as Record<string, unknown>
    if (row.schema !== "launchpad-config-action-v1") invalid("unknown schema")
    if (row.lane !== lane || row.currency !== currency) invalid("answer for another lane or currency")
    const version = row.version
    if (typeof version !== "string" || version.length > 19 || !/^[1-9][0-9]*$/.test(version) || BigInt(version) > MAX_INT64) invalid("invalid version")
    const status = {
        lane, currency, version: BigInt(version),
        paused: bool(row, "paused"), allowlisted: bool(row, "allowlisted"), laneReady: bool(row, "laneReady"),
        open: bool(row, "configGateOpen"),
    }
    if (status.open !== (!status.paused && status.allowlisted && status.laneReady)) invalid("inconsistent gate")
    return status
}

export async function readActionStatus(networkKey: string, lane: LaunchpadLane, currency: string): Promise<LaunchpadActionStatus> {
    if (currency.length === 0 || currency.length > 200) invalid("invalid currency")
    const value = await readLaunchpadJSON(networkKey, TOKEN_LAUNCHPAD_CONFIG_PATH, `ActionStatusJSON(${JSON.stringify(lane)}, ${JSON.stringify(currency)})`)
    return parseActionStatus(value, lane, currency)
}

/** Why a Launchpad lane takes no new action now (config's ActionStatusJSON), in one sentence; empty when it is open. */
export function laneClosedReason(status: Pick<LaunchpadActionStatus, "open" | "paused" | "allowlisted">, action: string): string {
    if (status.open) return ""
    if (status.paused) return `${action} is paused on this network for now.`
    if (!status.allowlisted) return `${action} in this currency is not allowed on this network.`
    return `${action} is not set up on this network yet.`
}

/** Whether config reserves a ticker: the ledger refuses a token that takes one. */
export async function readReserved(networkKey: string, ticker: string): Promise<boolean> {
    if (!/^[A-Z0-9]{1,10}$/.test(ticker)) invalid("invalid ticker")
    const raw = await readLaunchpad(networkKey, TOKEN_LAUNCHPAD_CONFIG_PATH, `IsReserved(${JSON.stringify(ticker)})`)
    const match = raw.match(/^\(\s*(true|false)\s+bool\s*\)\s*$/)
    if (!match) invalid("invalid reserved answer")
    return match[1] === "true"
}

/**
 * Whether a Launchpad lane takes new actions now, as the config realm says:
 * paused by the pauser, the currency off the allowlist, or the lane not set
 * up for it. A closed lane refuses new mints, listings and offers; it never
 * stops a holder or a refund, so only a new action asks.
 *
 * @module lib/nft/lane
 */
import { bool, currencyKey, decimal, record } from "./parse"
import { readJSON } from "./read"

export const LAUNCHPAD_CONFIG_PATH = "gno.land/r/samcrew/launchpad/config/v1"

export type LaunchpadLane = "collection" | "nft_drops" | "nft_market"

export interface LaneStatus {
    lane: LaunchpadLane
    currency: string
    paused: boolean
    allowlisted: boolean
    laneReady: boolean
    /** True only when none of the three stops the lane. */
    open: boolean
}

const KEYS = ["schema", "lane", "currency", "version", "paused", "allowlisted", "laneReady", "configGateOpen"] as const

export async function getLaneStatus(lane: LaunchpadLane, currency: string): Promise<LaneStatus> {
    const row = record(await readJSON(LAUNCHPAD_CONFIG_PATH, `ActionStatusJSON("${lane}", "${currencyKey(currency)}")`, "lane status"), "lane status", KEYS)
    if (row.schema !== "launchpad-config-action-v1" || row.lane !== lane || row.currency !== currency) throw new Error("Lane status does not match the request")
    decimal(row.version, "config version")
    const paused = bool(row.paused, "lane paused")
    const allowlisted = bool(row.allowlisted, "currency allowlisted")
    const laneReady = bool(row.laneReady, "lane ready")
    const open = bool(row.configGateOpen, "lane open")
    if (open !== (!paused && allowlisted && laneReady)) throw new Error("Inconsistent lane status")
    return { lane, currency, paused, allowlisted, laneReady, open }
}

/** Why a lane is closed, in one sentence; empty when it is open. */
export function laneClosedReason(status: LaneStatus, action: string): string {
    if (status.open) return ""
    if (status.paused) return `${action} is paused on this network for now.`
    if (!status.allowlisted) return `${action} in this currency is not allowed on this network.`
    return `${action} is not set up on this network yet.`
}

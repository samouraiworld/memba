/**
 * Gas limit and storage deposit cap for each call into a version-2 DAO realm.
 *
 * Proposals store their title and description in the realm, so their cost
 * grows with the text: a proposal with the longest description (8,000
 * four-byte characters) used 350M gas and 42 KB of storage (4.2 GNOT deposit),
 * while a short text proposal uses about 10M gas and 6.7 KB. A single default
 * gas limit either fails long proposals or overpays short ones, and an empty
 * deposit cap lets the chain lock up to its 100 GNOT default.
 *
 * The models below are upper bounds of measurements on an in-memory gnoland
 * node at the gnoland-1 runtime pin (31b6650a), for 3-member and 99-member DAOs
 * with 16 roles of 30 characters. `v2Budget.test.ts` checks every measured
 * point against them. Gas limits carry a 25 % margin; deposit caps are twice
 * the storage estimate, rounded up to 0.01 GNOT. The chain locks only the
 * bytes a call really adds, so the cap is a ceiling, not a price.
 */
import type { DaoAction } from "./builders"

/** vm `storage_price` on gnoland-1 and pearl-1 (read 2026-09-17): ugnot per byte. */
export const STORAGE_PRICE_UGNOT = 100

/** Largest gas limit these models produce (a proposal with maximal text and 16 roles). */
export const V2_MAX_CALL_GAS = 490_000_000

/**
 * Default ceiling on the storage-deposit cap of one call: 10 GNOT. Every
 * modelled call stays below it (the largest proposal needs about 9.5 GNOT);
 * a plan above it is signed only after the member explicitly approves that
 * exact amount (see daoTx `approvedDepositUgnot`).
 */
export const V2_MAX_DEPOSIT_UGNOT = 10_000_000

/** True when a deposit cap is above the ceiling and needs an explicit override. */
export function depositNeedsOverride(maxDepositUgnot: number): boolean {
    return maxDepositUgnot > V2_MAX_DEPOSIT_UGNOT
}

export interface V2CallBudget {
    gasWanted: number
    /** Storage deposit cap in ugnot. */
    maxDepositUgnot: number
}

export interface V2StorageAndGas {
    gas: number
    storageBytes: number
}

const encoder = new TextEncoder()
const bytes = (s: string) => encoder.encode(s).length

/** Execute needs the stored action to size the roles it writes. */
export type V2ExecuteTarget = { kind: "text" | "add_member" | "remove_member" | "set_roles" | "archive"; roles: string[] }

/** Raw upper-bound model, before margins. */
export function estimateV2Call(action: DaoAction, executes?: V2ExecuteTarget): V2StorageAndGas {
    switch (action.type) {
        case "vote":
            return { gas: 12_000_000, storageBytes: 2_000 }
        case "execute": {
            const rolesBytes = executes && (executes.kind === "add_member" || executes.kind === "set_roles") ? bytes(executes.roles.join(",")) : 0
            const grows = executes?.kind === "add_member" || executes?.kind === "set_roles"
            return { gas: 20_000_000, storageBytes: grows ? 3_000 + 6 * rolesBytes : 1_000 }
        }
        default: {
            const titleBytes = bytes(action.title)
            const descBytes = bytes(action.description)
            const rolesBytes = "roles" in action ? bytes(action.roles.join(",")) : 0
            return {
                gas: 20_000_000 + 11_000 * (titleBytes + descBytes) + 20_000 * rolesBytes,
                // The title is stored twice (raw and JSON-escaped); the description once.
                storageBytes: 8_000 + 3 * titleBytes + Math.ceil(1.1 * descBytes) + 5 * rolesBytes,
            }
        }
    }
}

const roundUp = (value: number, step: number) => Math.ceil(value / step) * step

/** Gas limit and deposit cap to send with a call into a version-2 DAO. */
export function v2CallBudget(action: DaoAction, executes?: V2ExecuteTarget): V2CallBudget {
    const { gas, storageBytes } = estimateV2Call(action, executes)
    return {
        gasWanted: Math.min(V2_MAX_CALL_GAS, roundUp(gas * 1.25, 1_000_000)),
        maxDepositUgnot: roundUp(storageBytes * 2 * STORAGE_PRICE_UGNOT, 10_000),
    }
}

/** "4.16 GNOT" style amount for a ugnot value. */
export function formatUgnot(ugnot: number): string {
    const gnot = ugnot / 1_000_000
    return `${gnot.toLocaleString("en-US", { maximumFractionDigits: 2 })} GNOT`
}

/** Exact "10.000001 GNOT" style amount for a ugnot value: no rounding, trailing zeros trimmed. */
export function formatUgnotExact(ugnot: number): string {
    const units = BigInt(Math.trunc(ugnot))
    const whole = units / 1_000_000n
    const fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "")
    return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""} GNOT`
}

/**
 * usernameRegistration — @username claims through the network's public
 * registrar (`r/sys/namereg/v0` on gno.land mainnet).
 *
 * The registrar's rules, read from its source on gnoland-1 (2026-09-24):
 * - names match `nym-[a-z]{5,13}\d{3}`, and the letter stem may not start with
 *   a reserved prefix or equal a reserved role name;
 * - the call must carry EXACTLY the current register price in ugnot (free by
 *   default, but governance can change it), so the price is read from the
 *   realm before every call instead of being hardcoded.
 *
 * Cost, from `.app/simulate` on gnoland-1 (heights 447,689 to 449,315,
 * 2026-09-30, about 100 sampled names): 30.8M to 42.5M gas, far above the 10M
 * default limit, and 3,161 to 3,253 bytes across the registrar and r/sys/users.
 * Gas follows where the name falls in the registry's trees, not its length, so
 * it grows with the registry. The gas limit is at least twice the highest
 * measurement; the deposit estimate is 3,300 bytes and its cap twice that. A
 * member cannot remove a registered name, so the deposit is locked for good.
 *
 * @module lib/usernameRegistration
 */
import { depositCapUgnot, STORAGE_PRICE_UGNOT } from "./dao/v2Budget"
import { feeForGasWanted, type AminoMsg, type GasPrice } from "./grc20"
import { resilientAbciQuery } from "./rpcFallback"

export const REGISTER_GAS_WANTED = 90_000_000
const REGISTER_STORAGE_BYTES = 3_300
export const REGISTER_DEPOSIT_UGNOT = REGISTER_STORAGE_BYTES * STORAGE_PRICE_UGNOT
export const REGISTER_MAX_DEPOSIT_UGNOT = depositCapUgnot(REGISTER_STORAGE_BYTES)

/** Gas limit and fee to broadcast a registration with, at the quoted network price. */
export function registerBroadcastOptions(price: GasPrice) {
    return { gasWanted: REGISTER_GAS_WANTED, gasFee: feeForGasWanted(REGISTER_GAS_WANTED, price) }
}

/** The registrar's name format (namereg `reNymFormat`). */
export const NYM_NAME_RE = /^nym-[a-z]{5,13}\d{3}$/

/** Stem prefixes the registrar refuses (namereg `reservedPrefixes`). The
 *  reserved role-name list is checked on-chain only. */
const RESERVED_PREFIXES = ["gl", "g1", "gno", "atom", "atone", "photon", "cosmos"]

/** Why a name is refused before any call, or null when it passes the local checks. */
export function nymNameProblem(name: string): string | null {
    if (!NYM_NAME_RE.test(name)) {
        return "Use nym- + 5 to 13 lowercase letters + 3 digits (e.g. nym-builder042)"
    }
    const stem = name.slice(4, -3)
    const reserved = RESERVED_PREFIXES.find(p => stem.startsWith(p))
    if (reserved) return `The letters after nym- can't start with "${reserved}"`
    return null
}

/** Parse an `int64` qeval literal such as `(0 int64)`. */
export function parseInt64Result(raw: string): bigint | null {
    const m = raw.trim().match(/^\((\d+) int64\)$/)
    return m ? BigInt(m[1]) : null
}

/** Current register price in ugnot, or null when it cannot be read. */
export async function fetchRegisterPrice(registrarPath: string): Promise<bigint | null> {
    try {
        const raw = await resilientAbciQuery("vm/qeval", `${registrarPath}.registerPrice`, true)
        return raw === null ? null : parseInt64Result(raw)
    } catch {
        return null
    }
}

/** The `Register(username)` call, carrying exactly `priceUgnot`. Broadcast it with {@link registerBroadcastOptions}. */
export function buildRegisterUsernameMsg(caller: string, registrarPath: string, name: string, priceUgnot: bigint): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: priceUgnot > 0n ? `${priceUgnot}ugnot` : "",
            pkg_path: registrarPath,
            func: "Register",
            args: [name],
            max_deposit: `${REGISTER_MAX_DEPOSIT_UGNOT}ugnot`,
        },
    }
}

/** A readable line for a failed registration. */
export function registrationErrorMessage(raw: string): string {
    const msg = raw.toLowerCase()
    if (msg.includes("confusable")) return "That name is too close to an existing one. Try a different one."
    if (msg.includes("already taken")) return "That name is already taken. Try a different one."
    if (msg.includes("already registered")) return "This address already has a username."
    if (msg.includes("deleting")) return "This address deleted its username and can't register a new one."
    if (msg.includes("reserved")) return "That name is reserved. Try a different one."
    if (msg.includes("invalid payment")) return "The registration price changed. Try again."
    if (msg.includes("paused")) return "Username registration is paused right now."
    if (msg.includes("non-user call")) return "Register directly from your wallet, not through a script or another realm."
    if (msg.includes("insufficient")) return "Not enough GNOT to pay the network fee and the storage deposit."
    return raw
}

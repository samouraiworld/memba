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
 * @module lib/usernameRegistration
 */
import type { AminoMsg } from "./grc20"
import { resilientAbciQuery } from "./rpcFallback"

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

/** The `Register(username)` call, carrying exactly `priceUgnot`. */
export function buildRegisterUsernameMsg(caller: string, registrarPath: string, name: string, priceUgnot: bigint): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: priceUgnot > 0n ? `${priceUgnot}ugnot` : "",
            pkg_path: registrarPath,
            func: "Register",
            args: [name],
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
    if (msg.includes("insufficient")) return "Not enough GNOT to pay the transaction fee."
    return raw
}

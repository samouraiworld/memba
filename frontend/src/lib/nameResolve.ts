/**
 * Recipient resolution for send forms: "@name", "name" or a g1 address.
 *
 * Every outcome is a typed result, so a form can tell "no such user" apart
 * from "the registry could not be read" and never sends to a guess.
 */

import { isValidGnoAddressChecksum } from "./dao/address"
import { REGISTRY_NAME_MAX_LEN, REGISTRY_NAME_RE, resolveUsernameToAddress } from "./dao/shared"

export type RecipientResolution =
    | { kind: "address"; address: string; name?: string }
    | { kind: "unregistered"; name: string }
    | { kind: "invalid"; reason: string }
    | { kind: "unreachable"; name: string }

/** r/sys/users `reAddressLookalike` (gnoland-1): the registry refuses any
 *  name of this shape, so it can only be an address. */
const ADDRESS_LOOKALIKE_RE = /^g1[a-z0-9]{20,38}$/
/** A bare (no "@") input of this shape is read as an address attempt, so a
 *  mistyped address with extra characters is reported as invalid instead of
 *  being looked up as a name. A registered name of this shape still resolves
 *  when typed with "@". */
const BARE_ADDRESS_ATTEMPT_RE = /^g1[a-z0-9]{20,}$/

function invalid(reason: string): RecipientResolution {
    return { kind: "invalid", reason }
}

function resolveAddress(input: string): RecipientResolution {
    const lower = input.toLowerCase()
    // bech32 is either all lowercase or all uppercase; mixed case is invalid.
    if (input !== lower && input !== input.toUpperCase()) {
        return invalid("A g1 address can't mix upper and lower case.")
    }
    if (!isValidGnoAddressChecksum(lower)) {
        return invalid("This is not a valid g1 address. Check it for a typo.")
    }
    return { kind: "address", address: lower }
}

/**
 * Resolve what a user typed as a recipient. A g1 address is checked locally
 * (bech32 checksum) with no network call. A name (one leading "@" optional,
 * case-insensitive like the registry's lowercase-only names) must pass the
 * r/sys/users name rule before it is looked up through `ResolveName`.
 * Never throws: any failure of the lookup is "unreachable".
 */
export async function resolveRecipient(input: string): Promise<RecipientResolution> {
    const trimmed = typeof input === "string" ? input.trim() : ""
    if (!trimmed) return invalid("Enter a @username or a g1 address.")

    const hasAt = trimmed.startsWith("@")
    const body = hasAt ? trimmed.slice(1) : trimmed
    const name = body.toLowerCase()

    if (!hasAt && BARE_ADDRESS_ATTEMPT_RE.test(name)) return resolveAddress(body)

    if (!name) return invalid("Enter a username after the @.")
    if (ADDRESS_LOOKALIKE_RE.test(name)) {
        return invalid("That looks like an address, not a username. Remove the @.")
    }
    if (name.length > REGISTRY_NAME_MAX_LEN) {
        return invalid(`Usernames are at most ${REGISTRY_NAME_MAX_LEN} characters.`)
    }
    if (!REGISTRY_NAME_RE.test(name)) {
        return invalid("Usernames start with a letter and contain only letters, digits, and single - or _ between them.")
    }

    try {
        const address = await resolveUsernameToAddress(name)
        if (address === null) return { kind: "unreachable", name }
        if (address === "") return { kind: "unregistered", name }
        // The resolver already checks this; a send must never go to a bad address.
        if (!isValidGnoAddressChecksum(address)) return { kind: "unreachable", name }
        return { kind: "address", address, name }
    } catch {
        return { kind: "unreachable", name }
    }
}

/**
 * A multisig's name as a member sees it. Their own name wins; with none, the
 * current name of the member who first named it, marked with who: the address
 * stays the identity and the name is only a label. Outside its own page, an
 * account the member has not joined shows no other member's words (anyone
 * holding a member's key can register a multisig with it).
 *
 * @module lib/multisigName
 */
import type { Multisig } from "../gen/memba/v1/memba_pb"
import { revealInvisibleFormatting } from "./dao/v2Text"

export interface MultisigLabel {
    name: string
    /** Who gave the name, when it is another member's; "" otherwise. */
    namedBy: string
}

/** `neutral` is shown when there is no name to show; `onPage` is true on the account's own page. */
export function multisigLabel(m: Multisig, neutral: string, onPage: boolean): MultisigLabel {
    if (m.name) return { name: revealInvisibleFormatting(m.name), namedBy: "" }
    if (m.sharedName && m.namedBy && (m.joined || onPage)) return { name: revealInvisibleFormatting(m.sharedName), namedBy: m.namedBy }
    return { name: neutral, namedBy: "" }
}

export function namedByText(address: string): string {
    return `named by ${address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-4)}` : address}`
}

/**
 * Rules for showing values a member is about to sign (call arguments,
 * addresses, memos) without letting the display differ from the signed bytes.
 *
 * @module lib/signingText
 */
import { stripInvisibleFormatting } from "./dao/v2Text"

/** Anything that looks like a bech32 address or a realm/package path, even glued to other text. */
const ADDRESS_OR_PATH = /g1[a-z0-9]{38}|gno\.land\/[pr]\//i

/** Arguments longer than this are cut behind a visible marker and a "Show full" toggle. */
export const ARG_PREVIEW_CHARS = 64

/**
 * True when a value must never be shortened: it is, or contains, an address or
 * a realm path. A signer tells lookalike addresses apart by any character,
 * including the middle ones a head…tail shortening would hide. Invisible
 * characters inside an address do not stop it being recognised.
 */
export function mustShowInFull(value: string): boolean {
    return ADDRESS_OR_PATH.test(stripInvisibleFormatting(value))
}

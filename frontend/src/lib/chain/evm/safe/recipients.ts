/**
 * Address-poisoning defences for the recipient of a Safe payment.
 *
 * Poisoners send dust or fake zero-value transfers from an address that
 * starts and ends like one the victim uses, hoping it gets copied from the
 * history. So:
 *
 * - the address is shown in full, in groups of four (`addressGroups`);
 * - mixed-case input must match its EIP-55 checksum (`parseRecipient`);
 * - suggestions come only from the Safe's owners, addresses the member saved,
 *   and recipients of payments this Safe already sent; never from incoming
 *   transfers (`knownRecipients`);
 * - an address that looks like a known one without being it is "danger"; a
 *   first-time recipient, a contract, the token itself or the Safe itself are
 *   flagged (`recipientWarnings`).
 *
 * No EVM library: the checksum function is passed in (the adapter gives viem's
 * `getAddress`). Addresses are compared and kept lowercase; EIP-55 is for display.
 *
 * @module lib/chain/evm/safe/recipients
 */
import { ZERO_ADDRESS } from "./abi"
import type { Hex } from "./known"

/** EIP-55 checksum of a lowercase address. */
export type ToChecksum = (address: Hex) => Hex

export type ParsedRecipient =
    | { ok: true; address: Hex; display: Hex }
    | { ok: false; error: string }

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

export function parseRecipient(input: string, toChecksum: ToChecksum): ParsedRecipient {
    const text = input.trim()
    if (!ADDRESS.test(text)) return { ok: false, error: "Enter a full address: 0x followed by 40 hexadecimal characters." }
    const address = text.toLowerCase() as Hex
    const display = toChecksum(address)
    const letters = text.slice(2).replace(/[0-9]/g, "")
    const mixedCase = letters !== letters.toLowerCase() && letters !== letters.toUpperCase()
    if (mixedCase && text.slice(2) !== display.slice(2)) {
        return { ok: false, error: "This address's capital letters don't match its checksum, so a character is probably wrong. Copy it again from a source you trust." }
    }
    if (address === ZERO_ADDRESS) return { ok: false, error: "This is the zero address: anything sent there is lost." }
    return { ok: true, address, display }
}

export type RecipientSource = "owner" | "saved" | "sent-before"

export interface KnownRecipient {
    address: Hex
    source: RecipientSource
    label?: string
}

const SOURCE_RANK: Readonly<Record<RecipientSource, number>> = { owner: 0, saved: 1, "sent-before": 2 }

/**
 * The addresses Memba may suggest, each once, owners first. `sentBefore` is
 * the recipients of payments this Safe executed; incoming transfers must never
 * be passed here.
 */
export function knownRecipients(sources: { owners?: readonly string[]; saved?: readonly { address: string; label?: string }[]; sentBefore?: readonly string[] }): KnownRecipient[] {
    const all: KnownRecipient[] = [
        ...(sources.owners ?? []).map((a) => ({ address: a, source: "owner" as const })),
        ...(sources.saved ?? []).map((s) => ({ address: s.address, source: "saved" as const, label: s.label })),
        ...(sources.sentBefore ?? []).map((a) => ({ address: a, source: "sent-before" as const })),
    ].flatMap((r) => (ADDRESS.test(r.address) ? [{ ...r, address: r.address.toLowerCase() as Hex }] : []))
    const byAddress = new Map<Hex, KnownRecipient>()
    for (const r of all.sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source])) {
        if (!byAddress.has(r.address)) byAddress.set(r.address, r.label ? r : { address: r.address, source: r.source })
    }
    return [...byAddress.values()]
}

export type RecipientWarningCode = "look-alike" | "token-contract" | "self" | "new" | "contract"

export interface RecipientWarning {
    code: RecipientWarningCode
    severity: "danger" | "caution"
    /** For "look-alike": the known address it imitates. */
    resembles?: Hex
    text: string
}

/** Same first and last four hex characters: what a glance at a shortened address compares. */
function looksLike(a: Hex, b: Hex): boolean {
    return a !== b && a.slice(2, 6) === b.slice(2, 6) && a.slice(-4) === b.slice(-4)
}

export function recipientWarnings(recipient: Hex, ctx: { safe: string; token?: string; known: readonly KnownRecipient[]; isContract?: boolean }): RecipientWarning[] {
    const to = recipient.toLowerCase() as Hex
    const safe = ctx.safe.toLowerCase() as Hex
    const token = ctx.token?.toLowerCase() as Hex | undefined
    const warnings: RecipientWarning[] = []
    const resembled = [safe, ...ctx.known.map((k) => k.address)].find((k) => looksLike(to, k))
    if (resembled) warnings.push({
        code: "look-alike", severity: "danger", resembles: resembled,
        text: "This address starts and ends like one you know, but it is a different address. Poisoners create such look-alikes. Compare every character.",
    })
    if (token && to === token) warnings.push({
        code: "token-contract", severity: "danger",
        text: "This is the token's own contract. Tokens sent to it are usually lost.",
    })
    if (to === safe) warnings.push({ code: "self", severity: "caution", text: "This is the Safe itself: the funds would not leave it." })
    else if (!ctx.known.some((k) => k.address === to)) warnings.push({
        code: "new", severity: "caution",
        text: "This Safe has not paid this address before. Check it with the recipient through another channel.",
    })
    if (ctx.isContract && to !== safe && to !== token) warnings.push({
        code: "contract", severity: "caution",
        text: "This address is a contract. Make sure it can receive and pass on what you send.",
    })
    return warnings
}

/** "0x" then groups of four characters, for showing an address in full. */
export function addressGroups(display: string): string[] {
    return ["0x", ...(display.slice(2).match(/.{1,4}/g) ?? [])]
}

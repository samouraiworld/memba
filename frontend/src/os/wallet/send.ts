/**
 * Wallet Send rules (mockup v4 FLOWS.send, D16, D17, D24, D37): GNOT amounts
 * in exact ugnot, recipients, the tiered safety check on mainnet (100 GNOT or
 * more, or an address never used before), recent and saved recipients, and
 * the send lock that holds an unknown outcome until the member checks it.
 * Pure where it can be, so it can be tested.
 *
 * @module os/wallet/send
 */
import { isChecksummedAddress } from "../../lib/templates/dao/v2/bech32"
import type { AminoMsg } from "../../lib/grc20"

/** A plain bank send is cheap; padded well above it. Confirm with the first real send (D37). */
export const SEND_GAS_WANTED = 2_000_000
/** D24: sends of this size need the explicit address check on mainnet. */
export const LARGE_SEND_UGNOT = 100_000_000n
export const MEMO_MAX = 256
const UGNOT = 1_000_000n

/**
 * "12.5" → 12500000n ugnot; null unless a plain positive number with at most
 * 6 decimals. Commas are refused, never read as thousands separators: "12,5"
 * is 12.5 in much of the world and must not become 125.
 */
export function parseGnot(text: string): bigint | null {
    const t = text.trim().replace(/[\s_]/g, "")
    const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(t)
    if (!m) return null
    const v = BigInt(m[1]) * UGNOT + BigInt((m[2] ?? "").padEnd(6, "0"))
    return v > 0n ? v : null
}

/** 12500000n → "12.5 GNOT" (exact). */
export function formatUgnot(v: bigint): string {
    const whole = v / UGNOT
    const frac = (v % UGNOT).toString().padStart(6, "0").replace(/0+$/, "")
    return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""} GNOT`
}

export type Recipient =
    | { kind: "address"; address: string }
    /** An @name from the gno.land user registry (D23), with the address it resolved to. */
    | { kind: "name"; name: string; address: string }
    | { kind: "pending"; name: string }
    | { kind: "error"; error: string }
    | null

/** What the registry said about a name (the component looks it up; this module stays pure). */
export type NameLookup = { status: "loading" } | { status: "found"; address: string } | { status: "missing" } | { status: "error" }

/** r/sys/users name rule (validateName on gnoland-1): lowercase, max 64, and never shaped like an address. */
const REGISTRY_NAME = /^[a-z][a-z0-9]*([_-][a-z0-9]+)*$/
const ADDRESS_LOOKALIKE = /^g1[a-z0-9]{20,38}$/
const ADDRESS = /^g1[02-9ac-hj-np-z]{38}$/
/** Only ASCII whitespace is trimmed: String.trim() would also drop U+FEFF and U+00A0. */
const trimAscii = (s: string) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "")

/** The registry name to look up for this To field, or null when it isn't a well-formed @name.
 *  Anything outside printable ASCII is refused BEFORE lower-casing: Unicode case folding maps
 *  look-alikes such as U+212A (Kelvin sign) to "k", which would pay a real, different user. */
export function nameToLookUp(input: string): string | null {
    const v = trimAscii(input)
    if (!v.startsWith("@") || /[^\x21-\x7e]/.test(v)) return null
    const name = v.slice(1).toLowerCase()
    return name.length <= 64 && REGISTRY_NAME.test(name) && !ADDRESS_LOOKALIKE.test(name) ? name : null
}

/** The address a recipient pays, once there is one. */
export function recipientAddress(r: Recipient): string | null {
    return r?.kind === "address" || r?.kind === "name" ? r.address : null
}

/** What the To field names: a g1 address, or an @name resolved through `lookup`. */
export function readRecipient(input: string, lookup?: (name: string) => NameLookup | undefined, hrp = "g"): Recipient {
    const v = trimAscii(input)
    if (!v) return null
    if (v.startsWith("@")) {
        const name = nameToLookUp(v)
        if (!name) return { kind: "error", error: "That isn't a gno.land username (lowercase letters, digits, - or _)." }
        const found = lookup?.(name) ?? { status: "loading" }
        if (found.status === "loading") return { kind: "pending", name }
        if (found.status === "missing") return { kind: "error", error: `No gno.land user is named @${name}.` }
        if (found.status === "error") return { kind: "error", error: `Couldn't look up @${name} right now. Try again, or paste the g1… address.` }
        // The registry's answer is checked like a typed address: a bad one never becomes a recipient.
        if (!ADDRESS.test(found.address) || !isChecksummedAddress(found.address, hrp)) return { kind: "error", error: `@${name} resolved to an invalid address. Paste the g1… address instead.` }
        return { kind: "name", name, address: found.address }
    }
    if (/^[a-z][a-z0-9_-]{2,}$/i.test(v) && !v.startsWith("g1")) return { kind: "error", error: "Start a username with @ (like @alice), or paste the g1… address." }
    if (!ADDRESS.test(v)) return { kind: "error", error: "That isn't a g1… address." }
    if (!isChecksummedAddress(v, hrp)) return { kind: "error", error: "This address has a typo (its checksum doesn't match)." }
    return { kind: "address", address: v }
}

export interface SendDraft { to: string; amount: string; memo: string; save: boolean }

export interface SendCheck {
    recipient: Recipient
    ugnot: bigint | null
    problems: Partial<Record<"to" | "amount" | "memo", string>>
    /** D17 reasons for the explicit address check (mainnet only). */
    tiers: string[]
}

export function checkSend(d: SendDraft, ctx: { from: string; balance: bigint | null; fee: bigint; mainnet: boolean; known: (a: string) => boolean; lookup?: (name: string) => NameLookup | undefined }): SendCheck {
    const recipient = readRecipient(d.to, ctx.lookup)
    const to = recipientAddress(recipient)
    const ugnot = parseGnot(d.amount)
    const problems: SendCheck["problems"] = {}
    if (!recipient) problems.to = "Who should receive it?"
    else if (recipient.kind === "error") problems.to = recipient.error
    else if (recipient.kind === "pending") problems.to = `Looking up @${recipient.name}…`
    else if (to === ctx.from) problems.to = "That's your own address."
    if (ugnot === null) problems.amount = d.amount.includes(",") ? "Use a dot for decimals, and no commas (12.5)." : "Enter an amount, up to 6 decimals."
    else if (ctx.balance !== null && ugnot + ctx.fee > ctx.balance) problems.amount = `More than you have (${formatUgnot(ctx.balance)}), keeping ${formatUgnot(ctx.fee)} for the fee.`
    if ([...d.memo].length > MEMO_MAX) problems.memo = `Up to ${MEMO_MAX} characters.`
    const tiers: string[] = []
    if (ctx.mainnet && to !== null && !ctx.known(to)) tiers.push("new address")
    if (ctx.mainnet && ugnot !== null && ugnot >= LARGE_SEND_UGNOT) tiers.push("100 GNOT or more")
    return { recipient, ugnot, problems, tiers }
}

/** The exact message Adena signs (D37: one coin string). */
export function buildSendMsg(from: string, to: string, ugnot: bigint): AminoMsg {
    return { type: "/bank.MsgSend", value: { from_address: from, to_address: to, amount: `${ugnot}ugnot` } }
}

// ── Recent and saved recipients, per network and wallet, in this browser ─────

const peopleKey = (chainId: string, wallet: string) => `memba_os_recipients:${chainId}:${wallet}`

export interface Recipients { recent: string[]; saved: string[] }

export function readRecipients(chainId: string, wallet: string): Recipients {
    try {
        const v: unknown = JSON.parse(localStorage.getItem(peopleKey(chainId, wallet)) ?? "null")
        const ok = (x: unknown): x is string[] => Array.isArray(x) && x.every((a) => typeof a === "string" && /^g1[02-9ac-hj-np-z]{38}$/.test(a))
        if (v && typeof v === "object" && ok((v as Recipients).recent) && ok((v as Recipients).saved)) return v as Recipients
    } catch { /* unreadable: start empty */ }
    return { recent: [], saved: [] }
}

export function rememberRecipient(chainId: string, wallet: string, address: string, save: boolean): void {
    const r = readRecipients(chainId, wallet)
    const next = { recent: [address, ...r.recent.filter((a) => a !== address)].slice(0, 8), saved: save && !r.saved.includes(address) ? [...r.saved, address] : r.saved }
    try { localStorage.setItem(peopleKey(chainId, wallet), JSON.stringify(next)) } catch { /* storage refused */ }
}

// ── The send lock: an attempt saved before the wallet opens ────────────────

const lockKey = (chainId: string, wallet: string) => `memba_os_send_lock:${chainId}:${wallet}`

export interface SendLock { label: string; hash: string; at: number }

export function readSendLock(chainId: string, wallet: string): SendLock | null {
    try {
        const v: unknown = JSON.parse(localStorage.getItem(lockKey(chainId, wallet)) ?? "null")
        if (v && typeof v === "object" && typeof (v as SendLock).label === "string" && typeof (v as SendLock).hash === "string" && typeof (v as SendLock).at === "number") return v as SendLock
    } catch { /* unreadable */ }
    return null
}

/** Throws when the browser refuses storage: then the send must not start. */
export function writeSendLock(chainId: string, wallet: string, lock: SendLock): void {
    localStorage.setItem(lockKey(chainId, wallet), JSON.stringify(lock))
}

export function clearSendLock(chainId: string, wallet: string): void {
    try { localStorage.removeItem(lockKey(chainId, wallet)) } catch { /* nothing to clear */ }
}

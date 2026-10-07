/**
 * How the NFT screens write a price, a rate and a time. The price and the
 * rate are exact: they are cut from the bigint the realm stated, never passed
 * through a float.
 *
 * @module lib/nft/format
 */
import { formatUgnot } from "../../os/wallet/send"

/**
 * 1500000n ugnot → "1.5 GNOT". Any other currency is a GRC20 registry key,
 * whose decimals this client does not know: its amount stays the integer the
 * realm stated, named by the key's last path segment ("gno.land/r/demo/foo20"
 * → "1,500 foo20"). A token whose segment reads like GNOT is named by its full
 * key, so it never passes for the coin. An amount is never negative.
 */
export function formatAmount(amount: bigint, currency: string): string {
    if (amount < 0n) throw new Error("Invalid amount")
    if (currency === "ugnot") return formatUgnot(amount)
    const segment = currency.slice(currency.lastIndexOf("/") + 1)
    return `${amount.toLocaleString("en-US")} ${segment === "" || /^u?gnot$/i.test(segment) ? currency : segment}`
}

/** Basis points as a percentage: 250n → "2.5%". Never negative. */
export function formatBPS(bps: bigint): string {
    if (bps < 0n) throw new Error("Invalid basis points")
    const fraction = (bps % 100n).toString().padStart(2, "0").replace(/0+$/, "")
    return `${bps / 100n}${fraction ? `.${fraction}` : ""}%`
}

/** The first second of the year 10000: past it, a date no longer has the fixed form below. */
const YEAR_10000 = 253_402_300_800n

/** Unix seconds as a fixed UTC time, the same for every reader: "2026-10-01 14:00 UTC". */
export function formatTime(seconds: bigint): string {
    if (seconds >= YEAR_10000) return "after the year 9999"
    return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`
}

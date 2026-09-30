/**
 * How the NFT screens write a price and a rate. Both are exact: they are cut
 * from the bigint the realm stated, never passed through a float.
 *
 * @module lib/nft/format
 */
import { formatUgnot } from "../../os/wallet/send"

/**
 * 1500000n ugnot → "1.5 GNOT". Any other currency is a GRC20 registry key,
 * whose decimals this client does not know: its amount stays the integer the
 * realm stated, named by the key's last path segment ("gno.land/r/demo/foo20"
 * → "1,500 foo20").
 */
export function formatAmount(amount: bigint, currency: string): string {
    if (currency === "ugnot") return formatUgnot(amount)
    return `${amount.toLocaleString("en-US")} ${currency.slice(currency.lastIndexOf("/") + 1) || currency}`
}

/** Basis points as a percentage: 250n → "2.5%". */
export function formatBPS(bps: bigint): string {
    const fraction = (bps % 100n).toString().padStart(2, "0").replace(/0+$/, "")
    return `${bps / 100n}${fraction ? `.${fraction}` : ""}%`
}

/**
 * Creating a collection through the drops realm, as Memba signs it. The terms
 * are checked by the rules the NFT ledger applies (its meta package for the
 * name, symbol, description and links; a content-addressed base URI; the
 * royalty list), so a call the chain would refuse is stopped before any
 * wallet: a refused transaction still costs its network fee. The collection
 * fee is paid in GNOT: exactly the fee the creator read. Collections with a
 * hidden "reveal" need a secret salt kept safe until the reveal: Memba does
 * not create them yet.
 *
 * @module lib/nft/create
 */
import { depositCapUgnot } from "../dao/v2Budget"
import { isGnoPrintable } from "../gnoPrintable"
import type { AminoMsg } from "../grc20"
import { TOKEN_LAUNCHPAD_CONFIG_PATH } from "../tokenLaunchpadConfigClient"
import { NFT_DROPS_PATH } from "./drops"
import type { NftMode } from "./ledger"
import { INT64_MAX, address } from "./parse"
import { readBool } from "./read"

/** Measured 8.9 to 17.0 KB for a creation, the most with the longest terms; the cap is twice the bytes. */
export const CREATE_COLLECTION_STORAGE_BYTES = 17_000

export interface NftRoyaltyShare {
    account: string
    bps: bigint
}

export interface CollectionTerms {
    name: string
    symbol: string
    description: string
    image: string
    banner: string
    website: string
    mode: NftMode
    /** Soulbound only: the creator may revoke a token. */
    revocable: boolean
    /** Zero is an open edition. */
    maxSupply: bigint
    metadataMode: "static" | "mutable"
    /** An ipfs:// directory: token n is <base><n>.json. */
    baseURI: string
    royalties: NftRoyaltyShare[]
}

const MAX_ROYALTY_RECEIVERS = 10
const MAX_ROYALTY_BPS = 1000n

const bytes = (s: string) => new TextEncoder().encode(s).length

/** The ledger's safe URI: one of the schemes and more, at most 200 bytes, printable ASCII without quotes, brackets or markup. */
function safeURI(s: string, schemes: string[]): boolean {
    if (bytes(s) > 200 || !schemes.some((scheme) => s.startsWith(scheme) && s.length > scheme.length)) return false
    return [...s].every((c) => c > " " && c < "\u007f" && !"\"'<>\\`()[]{}|^".includes(c))
}

/** An IPFS directory that resolves to the same files for good: no empty CID, dot segment, escape, query or fragment. */
export function validBaseURI(s: string): boolean {
    return s.startsWith("ipfs://") && s.length > 7 && s[7] !== "/" && !s.includes("/.") && !/[%?#]/.test(s) &&
        safeURI(s, ["ipfs://", "https://"]) && s.endsWith("/")
}

/**
 * The ledger checks a creation's text and links character by character and each royalty receiver
 * against config, so the gas grows with the terms: measured 19 to 21M for the shortest, plus
 * about 1.3M per royalty receiver, 77k to 88k per byte of image, banner, website and base URI,
 * and for the name and description 20k per ASCII byte but up to 180k per byte of other text (a
 * symbol outside Latin-1 is looked up in every Unicode table: 144.6M for the costliest terms the
 * ledger takes). The limit is twice this estimate, rounded up to a million, so a creation with
 * short terms pays a small fee.
 */
export function createCollectionGasWanted(t: CollectionTerms): number {
    const linkBytes = bytes(t.image) + bytes(t.banner) + bytes(t.website) + bytes(t.baseURI)
    let estimate = 21_000_000 + 1_300_000 * t.royalties.length + 90_000 * linkBytes
    for (const c of t.name + t.description) estimate += c < "\u0080" ? 20_000 : 200_000 * bytes(c)
    return Math.ceil(2 * estimate / 1_000_000) * 1_000_000
}

/** "2.5" → 250n basis points; null unless a percentage with at most two decimals. */
export function percentToBPS(text: string): bigint | null {
    const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text.trim())
    return m ? BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0")) : null
}

/** "address:bps;address:bps" with addresses in strictly ascending order: the one encoding the ledger accepts. */
export function encodeRoyalties(royalties: readonly NftRoyaltyShare[]): string {
    return [...royalties].sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0)).map((r) => `${r.account}:${r.bps}`).join(";")
}

/** The first rule the ledger would refuse these terms by, in words; empty when it would take them. */
export function termsProblem(t: CollectionTerms): string {
    if (bytes(t.name) < 1 || bytes(t.name) > 32 || !isGnoPrintable(t.name) || /[[\]()*#<>`|\\]/.test(t.name) || t.name.trim() !== t.name) {
        return "The name is 1 to 32 bytes of plain text, without brackets, *, #, <, >, `, | or \\, and no space at either end."
    }
    if (!/^[A-Z0-9]{1,10}$/.test(t.symbol)) return "The symbol is 1 to 10 capital letters or digits."
    if (bytes(t.description) > 280 || !isGnoPrintable(t.description) || /[[\]()<>]/.test(t.description)) {
        return "The description is at most 280 bytes of plain text, without brackets, < or >."
    }
    // The ledger takes an https image or banner; Memba loads only IPFS ones (see mediaUrl), and the form says so.
    if (t.image !== "" && !safeURI(t.image, ["ipfs://", "https://"])) return "The image is an ipfs:// link of at most 200 characters, without quotes, brackets or spaces."
    if (t.banner !== "" && !safeURI(t.banner, ["ipfs://", "https://"])) return "The banner is an ipfs:// link of at most 200 characters, without quotes, brackets or spaces."
    if (t.website !== "" && !safeURI(t.website, ["https://"])) return "The website is an https:// link of at most 200 characters."
    if (t.revocable && t.mode !== "soulbound") return "Only soulbound tokens can be revocable."
    if (t.maxSupply < 0n || t.maxSupply > INT64_MAX) return "The maximum supply is a whole number, 0 for an open edition."
    if (!validBaseURI(t.baseURI)) return "The base URI is an ipfs:// folder ending with /, with no ?, # or %."
    if (t.mode === "royalty_protected" && t.royalties.length === 0) return "A royalty-protected collection needs at least one royalty receiver."
    if (t.mode === "soulbound" && t.royalties.length > 0) return "Soulbound tokens are never sold, so they take no royalties."
    if (t.royalties.length > MAX_ROYALTY_RECEIVERS) return "At most 10 royalty receivers."
    const accounts = new Set<string>()
    let total = 0n
    for (const royalty of t.royalties) {
        try { address(royalty.account, "royalty receiver") } catch { return `${royalty.account || "A receiver"} is not an address the chain writes this way.` }
        if (accounts.has(royalty.account)) return `${royalty.account} is listed twice.`
        accounts.add(royalty.account)
        if (royalty.bps < 1n || royalty.bps > 9999n) return "Each royalty share is above 0%."
        total += royalty.bps
    }
    if (total > MAX_ROYALTY_BPS) return "Royalties add up to at most 10%."
    return ""
}

/**
 * CreateCollection(name, symbol, description, image, banner, website, mode,
 * revocable, maxSupply, metadataMode, baseURI, "", "", "", royalties,
 * "ugnot", maxFee), with exactly the fee attached.
 */
export function buildCreateCollectionMsg(caller: string, t: CollectionTerms, fee: bigint): AminoMsg {
    const problem = termsProblem(t)
    if (problem) throw new Error(problem)
    if (fee < 0n || fee > INT64_MAX) throw new Error("Invalid collection fee")
    return {
        type: "vm/MsgCall",
        value: {
            caller: address(caller, "account"),
            send: fee > 0n ? `${fee}ugnot` : "",
            pkg_path: NFT_DROPS_PATH,
            func: "CreateCollection",
            args: [
                t.name, t.symbol, t.description, t.image, t.banner, t.website, t.mode, String(t.revocable), t.maxSupply.toString(),
                t.metadataMode, t.baseURI, "", "", "", encodeRoyalties(t.royalties), "ugnot", fee.toString(),
            ],
            max_deposit: `${depositCapUgnot(CREATE_COLLECTION_STORAGE_BYTES)}ugnot`,
        },
    }
}

/** Whether config refuses this account as a receiver of payments: a Launchpad realm, for one. */
export async function isUnspendable(account: string): Promise<boolean> {
    return readBool(TOKEN_LAUNCHPAD_CONFIG_PATH, `IsUnspendable("${address(account, "account")}")`, "receiver check")
}

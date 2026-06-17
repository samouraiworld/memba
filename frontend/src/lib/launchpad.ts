/**
 * launchpad.ts — MsgCall builders + Render parsers for the canonical
 * `memba_collections` registry realm (Phase 2, Model A launchpad).
 *
 * Creators register collections INTO the shared registry (centrally tradable),
 * rather than deploying their own siloed realm. Each builder emits an Amino
 * vm/MsgCall whose arg order EXACTLY mirrors the on-chain ABI — see
 * docs/planning/CANONICAL_COLLECTION_ABI.md. The allowlist proof crosses the
 * ABI as a comma-joined hex string because vm/MsgCall cannot encode a []string.
 *
 * @module lib/launchpad
 */

import type { AminoMsg } from "./grc20"

// ── Realm constants (mirror memba_collections collection.gno) ────────────────

/** Anti-spam launch fee charged by CreateCollection, in ugnot (1 GNOT). */
export const CREATE_FEE_UGNOT = 1_000_000

/** royaltyBPS sentinel: pass -1 to use the realm's DefaultRoyaltyBPS (5%). */
export const ROYALTY_SENTINEL = -1

/** Hard ceiling on royalty (10%). The realm clamps to maxCreatorRoyaltyBPS. */
export const MAX_ROYALTY_BPS = 1000

/** Realm default royalty applied when royaltyBPS == ROYALTY_SENTINEL. */
export const DEFAULT_ROYALTY_BPS = 500

/** Minimum non-zero mint price (0.001 GNOT) — anti-truncation. */
export const MIN_MINT_PRICE = 1000

/** Collection-meta key for the team/DAO-curated "verified" trust badge (Phase 1). */
export const META_VERIFIED_KEY = "verified"

/** Sale phases (mirror config.gno). */
export const Phase = {
    Draft: 0,
    Allowlist: 1,
    Public: 2,
    Closed: 3,
} as const
export type PhaseValue = (typeof Phase)[keyof typeof Phase]

// ── helpers ──────────────────────────────────────────────────────────────────

function msgCall(
    caller: string,
    pkgPath: string,
    func: string,
    args: string[],
    send = "",
): AminoMsg {
    return { type: "vm/MsgCall", value: { caller, send, pkg_path: pkgPath, func, args } }
}

/** Encode native ugnot to attach; "" for a zero/GRC20 payment. */
function ugnotSend(amount: number): string {
    return amount > 0 ? `${amount}ugnot` : ""
}

/** Canonical comma encoder for a Merkle proof (matches splitProof in-realm). */
export function joinProof(proof: string[]): string {
    return proof.join(",")
}

/** Mirror of the realm's validSlug: ^[a-z0-9-]{1,64}$ (lowercase, digits, hyphen). */
const SLUG_RE = /^[a-z0-9-]{1,64}$/
export function isValidSlug(slug: string): boolean {
    return SLUG_RE.test(slug)
}

/** Derive the collectionID the realm will assign: `creator/slug`. */
export function deriveCollectionID(creator: string, slug: string): string {
    return `${creator}/${slug}`
}

// ── Launchpad: CreateCollection + 2-step admin ──────────────────────────────

export interface CreateCollectionParams {
    slug: string
    name: string
    symbol: string
    royaltyBPS: number // ROYALTY_SENTINEL (-1) → realm default
    royaltyRecip: string // "" → defaults to creator in-realm
    mintCustody: string // "" → defaults to creator in-realm
    maxSupply: number // 0 = unlimited
    maxPerWallet: number // 0 = unlimited
}

/** CreateCollection(slug,name,symbol,royaltyBPS,royaltyRecip,mintCustody,maxSupply,maxPerWallet) — attaches createFee. */
export function buildCreateCollectionMsg(
    caller: string,
    collectionsPath: string,
    p: CreateCollectionParams,
    createFeeUgnot: number = CREATE_FEE_UGNOT,
): AminoMsg {
    return msgCall(
        caller,
        collectionsPath,
        "CreateCollection",
        [
            p.slug,
            p.name,
            p.symbol,
            String(p.royaltyBPS),
            p.royaltyRecip,
            p.mintCustody,
            String(p.maxSupply),
            String(p.maxPerWallet),
        ],
        `${createFeeUgnot}ugnot`,
    )
}

/** SetCollectionAdmin(id,newAdmin) — step 1 of 2. */
export function buildSetCollectionAdminMsg(
    caller: string,
    collectionsPath: string,
    id: string,
    newAdmin: string,
): AminoMsg {
    return msgCall(caller, collectionsPath, "SetCollectionAdmin", [id, newAdmin])
}

/** AcceptCollectionAdmin(id) — step 2 of 2. */
export function buildAcceptCollectionAdminMsg(
    caller: string,
    collectionsPath: string,
    id: string,
): AminoMsg {
    return msgCall(caller, collectionsPath, "AcceptCollectionAdmin", [id])
}

// ── Mint-phase config (admin) ────────────────────────────────────────────────

/** SetMintPhase(id,phase,allowlistRoot). */
export function buildSetMintPhaseMsg(
    caller: string,
    collectionsPath: string,
    id: string,
    phase: PhaseValue,
    allowlistRoot: string,
): AminoMsg {
    return msgCall(caller, collectionsPath, "SetMintPhase", [id, String(phase), allowlistRoot])
}

export interface MintConfigParams {
    mintPrice: number // 0 = free; else [MIN_MINT_PRICE, MaxPriceUgnot]
    payDenom: string // "" / "ugnot" = native; else a grc20reg key
    maxSupply: number // 0 = unlimited
    maxPerWallet: number // 0 = unlimited
    mintStartBlock: number // 0 = open now
    mintCooldownBlocks: number // 0 = none
}

/** SetMintConfig(id,mintPrice,payDenom,maxSupply,maxPerWallet,mintStartBlock,mintCooldownBlocks). */
export function buildSetMintConfigMsg(
    caller: string,
    collectionsPath: string,
    id: string,
    p: MintConfigParams,
): AminoMsg {
    return msgCall(caller, collectionsPath, "SetMintConfig", [
        id,
        String(p.mintPrice),
        p.payDenom,
        String(p.maxSupply),
        String(p.maxPerWallet),
        String(p.mintStartBlock),
        String(p.mintCooldownBlocks),
    ])
}

// ── Mints ──────────────────────────────────────────────────────────────────

/** Mint(id,to,tokenURI) — admin, no payment. */
export function buildAdminMintMsg(
    caller: string,
    collectionsPath: string,
    id: string,
    to: string,
    tokenURI: string,
): AminoMsg {
    return msgCall(caller, collectionsPath, "Mint", [id, to, tokenURI])
}

/**
 * MintPublic(id,tokenURI). Attach `nativePriceUgnot` ugnot for a native-priced
 * mint; pass 0 for a GRC20-priced mint (the minter must pre-Approve the realm,
 * and attaching ugnot is rejected on-chain).
 */
export function buildMintPublicMsg(
    caller: string,
    collectionsPath: string,
    id: string,
    tokenURI: string,
    nativePriceUgnot: number,
): AminoMsg {
    return msgCall(caller, collectionsPath, "MintPublic", [id, tokenURI], ugnotSend(nativePriceUgnot))
}

/**
 * MintAllowlist(id,proof,maxQty,tokenURI). `proof` is joined to a comma-separated
 * hex string (the ABI cannot take a []string). Attach native price as for MintPublic.
 */
export function buildMintAllowlistMsg(
    caller: string,
    collectionsPath: string,
    id: string,
    proof: string[],
    maxQty: number,
    tokenURI: string,
    nativePriceUgnot: number,
): AminoMsg {
    return msgCall(
        caller,
        collectionsPath,
        "MintAllowlist",
        [id, joinProof(proof), String(maxQty), tokenURI],
        ugnotSend(nativePriceUgnot),
    )
}

// ── Royalty + proceeds (admin) ───────────────────────────────────────────────

/** SetRoyalty(id,recip,bps). */
export function buildSetRoyaltyMsg(
    caller: string,
    collectionsPath: string,
    id: string,
    recip: string,
    bps: number,
): AminoMsg {
    return msgCall(caller, collectionsPath, "SetRoyalty", [id, recip, String(bps)])
}

/** WithdrawProceeds(id,denom) — sends accrued proceeds to mintCustody. */
export function buildWithdrawProceedsMsg(
    caller: string,
    collectionsPath: string,
    id: string,
    denom: string,
): AminoMsg {
    return msgCall(caller, collectionsPath, "WithdrawProceeds", [id, denom])
}

// ── Verified badge (Phase 1, platformAdmin-only curation) ────────────────────

/** SetCollectionMeta(id,key,value) — extensible per-collection flag (platformAdmin). */
export function buildSetCollectionMetaMsg(
    caller: string,
    collectionsPath: string,
    id: string,
    key: string,
    value: string,
): AminoMsg {
    return msgCall(caller, collectionsPath, "SetCollectionMeta", [id, key, value])
}

/** Set ("true") or revoke ("") the team/DAO-curated verified badge on a collection. */
export function buildSetVerifiedMsg(
    caller: string,
    collectionsPath: string,
    id: string,
    verified: boolean,
): AminoMsg {
    return buildSetCollectionMetaMsg(caller, collectionsPath, id, META_VERIFIED_KEY, verified ? "true" : "")
}

// ── Render parsers ───────────────────────────────────────────────────────────

export interface CollectionListRow {
    name: string
    id: string // "creator/slug"
    creator: string
    slug: string
    phase: number
    minted: number
}

const LIST_ROW_RE = /^- \*\*(.+?)\*\* \((.+?)\) — phase (\d+), minted (\d+)/gm

/** Parse Render("") — the paginated collection list. */
export function parseCollectionList(markdown: string): CollectionListRow[] {
    const rows: CollectionListRow[] = []
    for (const m of markdown.matchAll(LIST_ROW_RE)) {
        const id = m[2]
        const slash = id.indexOf("/")
        rows.push({
            name: m[1],
            id,
            creator: slash >= 0 ? id.slice(0, slash) : "",
            slug: slash >= 0 ? id.slice(slash + 1) : id,
            phase: parseInt(m[3], 10),
            minted: parseInt(m[4], 10),
        })
    }
    return rows
}

export interface CollectionDetail {
    name: string
    symbol: string
    id: string
    creator: string
    admin: string
    royaltyBps: number
    royaltyRecip: string
    phase: number
    mintPrice: number
    payDenom: string
    minted: number
    maxSupply: number // 0 = unlimited
    paused: boolean
}

/** Parse Render("collection/<id>") — a single collection detail page. */
export function parseCollectionDetail(markdown: string): CollectionDetail | null {
    if (/^# Not found/m.test(markdown)) return null
    const title = markdown.match(/^# (.+?) \((.+?)\)/m)
    const id = markdown.match(/- ID: `(.+?)`/)
    if (!title || !id) return null

    const grab = (re: RegExp): string => markdown.match(re)?.[1] ?? ""
    const royalty = markdown.match(/- Royalty: (\d+) bps → (\S+)/)
    const price = markdown.match(/- Mint price: (\d+) (\S+)/)
    const supply = markdown.match(/- Supply: (\d+)(?: \/ (\d+))?/)

    return {
        name: title[1],
        symbol: title[2],
        id: id[1],
        creator: grab(/- Creator: (\S+)/),
        admin: grab(/- Admin: (\S+)/),
        royaltyBps: royalty ? parseInt(royalty[1], 10) : 0,
        royaltyRecip: royalty ? royalty[2] : "",
        phase: parseInt(grab(/- Phase: (\d+)/) || "0", 10),
        mintPrice: price ? parseInt(price[1], 10) : 0,
        payDenom: price ? price[2] : "ugnot",
        minted: supply ? parseInt(supply[1], 10) : 0,
        maxSupply: supply && supply[2] ? parseInt(supply[2], 10) : 0,
        paused: /- ⚠️ Paused/.test(markdown),
    }
}

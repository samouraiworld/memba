/** Structured reads of the Token Launchpad sales realm, `r/samcrew/launchpad/sales/v1`:
 * a token's launch state, a fair-sale buyer and a vesting record, schema `launchpad-sales-v1`.
 */
import { sha256 } from "@noble/hashes/sha2.js"
import { isValidGnoAddressChecksum } from "./dao/address"
import { bech32Encode } from "./dao/realmAddress"
import { ACTIVE_NETWORK_KEY } from "./config"
import { parseLaunchpadToken, readLaunchpadJSON, TokenLaunchpadReadError, type LaunchpadToken } from "./tokenLaunchpadClient"

export const TOKEN_LAUNCHPAD_SALES_PATH = "gno.land/r/samcrew/launchpad/sales/v1"
/** The sales realm's address: it holds launch tokens, so no allocation or airdrop leaf may pay it. */
export const TOKEN_LAUNCHPAD_SALES_ADDRESS = bech32Encode("g", sha256(new TextEncoder().encode(`pkgPath:${TOKEN_LAUNCHPAD_SALES_PATH}`)).slice(0, 20))
const MAX_INT64 = 9223372036854775807n

function invalid(message: string): never {
    throw new TokenLaunchpadReadError("invalid_response", `Launchpad sales response: ${message}`)
}

function object(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("expected an object")
    return value as Record<string, unknown>
}

function string(row: Record<string, unknown>, key: string, empty = false): string {
    const value = row[key]
    if (typeof value !== "string" || (!empty && value.length === 0)) invalid(`invalid ${key}`)
    return value as string
}

function amount(row: Record<string, unknown>, key: string): bigint {
    const value = string(row, key)
    if (value.length > 19 || !/^(0|[1-9][0-9]*)$/.test(value)) invalid(`invalid ${key}`)
    const parsed = BigInt(value)
    if (parsed > MAX_INT64) invalid(`${key} exceeds int64`)
    return parsed
}

function address(row: Record<string, unknown>, key: string, empty = false): string {
    const value = string(row, key, empty)
    if (value && !isValidGnoAddressChecksum(value)) invalid(`invalid ${key}`)
    return value
}

function bool(row: Record<string, unknown>, key: string): boolean {
    if (typeof row[key] !== "boolean") invalid(`invalid ${key}`)
    return row[key] as boolean
}

function count(row: Record<string, unknown>, key: string): number {
    const value = row[key]
    if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`invalid ${key}`)
    return value as number
}

function tokenId(id: string): void {
    if (!/^T[1-9][0-9]{0,9}$/.test(id)) invalid("invalid token id")
}

export interface FairSaleView {
    creator: string
    quoteCurrency: string
    configVersion: bigint
    primaryFeeBps: bigint
    allocation: bigint
    lotSize: bigint
    walletCapLots: bigint
    hardCapLots: bigint
    softCapQuote: bigint
    start: bigint
    end: bigint
    startPrice: bigint
    floorPrice: bigint
    decrement: bigint
    intervalSeconds: bigint
    allowlistRoot: string
    holdingGates: string
    totalLots: bigint
    totalDeposits: bigint
    hardClosedAt: bigint
    cancelled: boolean
    settled: boolean
    succeeded: boolean
    closeAt: bigint
    closePrice: bigint
    soldTokens: bigint
    grossQuote: bigint
    /** What was raised minus the creator's share, once settled. */
    primaryFeeQuote: bigint
    creatorQuote: bigint
    proceedsReleased: boolean
    refundQuote: bigint
    unsoldTokens: bigint
}

export interface AirdropView { root: string; total: bigint; claimed: bigint }

/** What a launch costs now (`TermsJSON`). A fee of null means the currency has no terms. */
export interface LaunchTermsView {
    version: bigint
    currency: string
    directCreationFee: bigint | null
    fairSaleCreationFee: bigint | null
    fairSaleRaiseCap: bigint
    primaryFeeBps: bigint | null
}

export interface LaunchView {
    token: LaunchpadToken
    /** Tokens the sales realm still owes in this token: vesting, airdrop and sale claims. */
    tokenLiability: bigint
    vestingCount: number
    fairSale: FairSaleView | null
    airdrop: AirdropView | null
}

export interface FairBuyerView {
    buyer: string
    lots: bigint
    deposit: bigint
    /** What ClaimFair pays now; both are 0 until the sale is settled. */
    claimableTokens: bigint
    claimableRefund: bigint
    settled: boolean
    claimed: boolean
}

export interface VestingView {
    index: number
    beneficiary: string
    pendingBeneficiary: string
    total: bigint
    claimed: bigint
    start: bigint
    cliff: bigint
    duration: bigint
    revocable: boolean
    revoked: boolean
    revokedVested: bigint
}

function parseFairSale(r: Record<string, unknown>, token: LaunchpadToken): FairSaleView {
    const sale: FairSaleView = {
        creator: address(r, "creator"), quoteCurrency: string(r, "quoteCurrency"),
        configVersion: amount(r, "configVersion"), primaryFeeBps: amount(r, "primaryFeeBps"),
        allocation: amount(r, "allocation"), lotSize: amount(r, "lotSize"),
        walletCapLots: amount(r, "walletCapLots"), hardCapLots: amount(r, "hardCapLots"),
        softCapQuote: amount(r, "softCapQuote"), start: amount(r, "start"), end: amount(r, "end"),
        startPrice: amount(r, "startPrice"), floorPrice: amount(r, "floorPrice"),
        decrement: amount(r, "decrement"), intervalSeconds: amount(r, "intervalSeconds"),
        allowlistRoot: string(r, "allowlistRoot", true), holdingGates: string(r, "holdingGates", true),
        totalLots: amount(r, "totalLots"), totalDeposits: amount(r, "totalDeposits"),
        hardClosedAt: amount(r, "hardClosedAt"), cancelled: bool(r, "cancelled"),
        settled: bool(r, "settled"), succeeded: bool(r, "succeeded"),
        closeAt: amount(r, "closeAt"), closePrice: amount(r, "closePrice"),
        soldTokens: amount(r, "soldTokens"), grossQuote: amount(r, "grossQuote"),
        primaryFeeQuote: amount(r, "primaryFeeQuote"), creatorQuote: amount(r, "creatorQuote"),
        proceedsReleased: bool(r, "proceedsReleased"), refundQuote: amount(r, "refundQuote"),
        unsoldTokens: amount(r, "unsoldTokens"),
    }
    // A sale belongs to the token's creator; a fair-sale token's own sale was
    // created under the token's config version, in its currency.
    if (sale.creator !== token.creator || sale.primaryFeeBps > 500n || sale.soldTokens > sale.allocation ||
        sale.totalLots > sale.hardCapLots ||
        (token.mode === "fairsale" && (sale.configVersion !== token.configVersion || sale.quoteCurrency !== token.currencyKey))) {
        invalid("inconsistent fair sale")
    }
    if (sale.settled && (sale.grossQuote + sale.refundQuote !== sale.totalDeposits ||
        sale.soldTokens + sale.unsoldTokens !== sale.allocation ||
        sale.primaryFeeQuote + sale.creatorQuote !== sale.grossQuote)) invalid("unbalanced settled fair sale")
    if (!sale.settled && (sale.grossQuote !== 0n || sale.primaryFeeQuote !== 0n || sale.creatorQuote !== 0n)) invalid("proceeds before settlement")
    if (sale.proceedsReleased && !(sale.settled && sale.succeeded)) invalid("released proceeds of an unsettled or failed sale")
    return sale
}

/** An int64 the realm writes as -1 when the currency has no terms. */
function fee(row: Record<string, unknown>, key: string): bigint | null {
    return row[key] === "-1" ? null : amount(row, key)
}

// Keys the schema does not name are ignored, so the realm can add fields.
export function parseTerms(value: unknown, currency: string): LaunchTermsView {
    const row = object(value)
    if (row.schema !== "launchpad-sales-terms-v1") invalid("unknown terms schema")
    if (row.currency !== currency) invalid("terms for another currency")
    const terms = {
        version: amount(row, "version"), currency,
        directCreationFee: fee(row, "directCreationFee"), fairSaleCreationFee: fee(row, "fairSaleCreationFee"),
        fairSaleRaiseCap: amount(row, "fairSaleRaiseCap"), primaryFeeBps: fee(row, "primaryFeeBps"),
    }
    if (terms.version === 0n || (terms.primaryFeeBps !== null && terms.primaryFeeBps > 500n)) invalid("inconsistent terms")
    return terms
}

// Keys the schema does not name are ignored, so the realm can add fields.
export function parseLaunch(value: unknown): LaunchView {
    const row = object(value)
    if (row.schema !== "launchpad-sales-v1") invalid("unknown schema")
    const token = parseLaunchpadToken(row.token)
    const fairSale = row.fairSale === null ? null : parseFairSale(object(row.fairSale), token)
    let airdrop: AirdropView | null = null
    if (row.airdrop !== null) {
        const r = object(row.airdrop)
        airdrop = { root: string(r, "root"), total: amount(r, "total"), claimed: amount(r, "claimed") }
        if (!/^[0-9a-f]{64}$/.test(airdrop.root) || airdrop.total === 0n || airdrop.claimed > airdrop.total) invalid("inconsistent airdrop")
    }
    return { token, tokenLiability: amount(row, "tokenLiability"), vestingCount: count(row, "vestingCount"), fairSale, airdrop }
}

export function parseFairBuyer(value: unknown): FairBuyerView {
    const row = object(value)
    const buyer: FairBuyerView = {
        buyer: address(row, "buyer"), lots: amount(row, "lots"), deposit: amount(row, "deposit"),
        claimableTokens: amount(row, "claimableTokens"), claimableRefund: amount(row, "claimableRefund"),
        settled: bool(row, "settled"), claimed: bool(row, "claimed"),
    }
    if ((buyer.claimed || !buyer.settled) && (buyer.claimableTokens !== 0n || buyer.claimableRefund !== 0n)) invalid("claimable funds that cannot be claimed")
    if (buyer.claimableRefund > buyer.deposit) invalid("refund above the deposit")
    return buyer
}

export function parseVesting(value: unknown): VestingView {
    const row = object(value)
    const vesting: VestingView = {
        index: count(row, "index"), beneficiary: address(row, "beneficiary"),
        pendingBeneficiary: address(row, "pendingBeneficiary", true),
        total: amount(row, "total"), claimed: amount(row, "claimed"),
        start: amount(row, "start"), cliff: amount(row, "cliff"), duration: amount(row, "duration"),
        revocable: bool(row, "revocable"), revoked: bool(row, "revoked"),
        revokedVested: amount(row, "revokedVested"),
    }
    if (vesting.claimed > vesting.total || vesting.revokedVested > vesting.total) invalid("inconsistent vesting")
    return vesting
}

/** Every read reaches the chain: no cache, so a network switch is always detected. */
export class TokenLaunchpadSalesClient {
    constructor(readonly networkKey: string = ACTIVE_NETWORK_KEY) {}

    private read(expression: string): Promise<unknown> {
        return readLaunchpadJSON(this.networkKey, TOKEN_LAUNCHPAD_SALES_PATH, expression)
    }

    async terms(currency: string): Promise<LaunchTermsView> {
        if (currency.length === 0 || currency.length > 200) invalid("invalid currency")
        return parseTerms(await this.read(`TermsJSON(${JSON.stringify(currency)})`), currency)
    }

    async launch(id: string): Promise<LaunchView> {
        tokenId(id)
        const launch = parseLaunch(await this.read(`LaunchJSON(${JSON.stringify(id)})`))
        if (launch.token.id !== id) invalid("token id mismatch")
        return launch
    }

    async fairBuyer(id: string, buyer: string): Promise<FairBuyerView> {
        tokenId(id)
        if (!isValidGnoAddressChecksum(buyer)) invalid("invalid buyer")
        const view = parseFairBuyer(await this.read(`FairBuyerJSON(${JSON.stringify(id)}, address(${JSON.stringify(buyer)}))`))
        if (view.buyer !== buyer) invalid("buyer mismatch")
        return view
    }

    async vesting(id: string, index: number): Promise<VestingView> {
        tokenId(id)
        if (!Number.isSafeInteger(index) || index < 0) invalid("invalid vesting index")
        const view = parseVesting(await this.read(`VestingJSON(${JSON.stringify(id)}, ${index})`))
        if (view.index !== index) invalid("vesting index mismatch")
        return view
    }
}

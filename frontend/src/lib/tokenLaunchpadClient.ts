/** Structured reads for the unpublished samcrew Launchpad token realm.
 * No caller should infer deployment or enable writes from this source client.
 */
import { isValidGnoAddressChecksum } from "./dao/address"
import { queryEval, parseQevalJSON } from "./dao/shared"
import { ACTIVE_NETWORK_KEY, currentNetworkKey, GNO_RPC_URL } from "./config"
import { decodeGoQuoted } from "./goQuote"
import { AbciQueryError } from "./rpcFallback"

export const TOKEN_LAUNCHPAD_PATH = "gno.land/r/samcrew/launchpad/tokens/v1"
const MAX_INT64 = 9223372036854775807n
export type TokenLaunchMode = "curve" | "direct_fixed" | "direct_capped" | "fairsale"
export type TokenLaunchpadReadErrorCode = "network_changed" | "realm_error" | "rpc_error" | "unavailable" | "invalid_response"

export class TokenLaunchpadReadError extends Error {
    constructor(readonly code: TokenLaunchpadReadErrorCode, message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = "TokenLaunchpadReadError"
    }
}

export interface LaunchpadToken {
    id: string
    registryKey: string
    grc20Id: string
    creator: string
    mode: TokenLaunchMode
    name: string
    ticker: string
    decimals: number
    initialSupply: bigint
    maxSupply: bigint
    totalSupply: bigint
    configVersion: bigint
    currencyKey: string
    description: string
    image: string
    website: string
    xHandle: string
    telegram: string
    metadataFrozen: boolean
    mintAuthority: string
    pendingMintAuthority: string
    mintRenounced: boolean
}

function invalid(message: string): never {
    throw new TokenLaunchpadReadError("invalid_response", `Launchpad token response: ${message}`)
}

function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("expected an object")
    return value as Record<string, unknown>
}

function stringField(row: Record<string, unknown>, key: string, allowEmpty = false): string {
    const value = row[key]
    if (typeof value !== "string" || (!allowEmpty && value.length === 0)) invalid(`invalid ${key}`)
    return value as string
}

function decimalField(row: Record<string, unknown>, key: string): bigint {
    const raw = stringField(row, key)
    if (!/^(0|[1-9][0-9]*)$/.test(raw)) invalid(`invalid ${key}`)
    const value = BigInt(raw)
    if (value > MAX_INT64) invalid(`${key} exceeds int64`)
    return value
}

function addressField(row: Record<string, unknown>, key: string, allowEmpty = false): string {
    const value = stringField(row, key, allowEmpty)
    if (value !== "" && !isValidGnoAddressChecksum(value)) invalid(`invalid ${key}`)
    return value
}

function booleanField(row: Record<string, unknown>, key: string): boolean {
    if (typeof row[key] !== "boolean") invalid(`invalid ${key}`)
    return row[key] as boolean
}

/** Decode the exact TokenJSON/ListTokensJSON schema. Amounts must be decimal strings. */
export function parseLaunchpadToken(value: unknown): LaunchpadToken {
    const row = record(value)
    const id = stringField(row, "id")
    if (!/^T[1-9][0-9]{0,9}$/.test(id)) invalid("invalid id")
    const mode = stringField(row, "mode")
    if (mode !== "curve" && mode !== "direct_fixed" && mode !== "direct_capped" && mode !== "fairsale") invalid("invalid mode")
    const decimals = row.decimals
    if (!Number.isInteger(decimals) || (decimals as number) < 0 || (decimals as number) > 12) invalid("invalid decimals")
    const initialSupply = decimalField(row, "initialSupply")
    const maxSupply = decimalField(row, "maxSupply")
    const totalSupply = decimalField(row, "totalSupply")
    const configVersion = decimalField(row, "configVersion")
    if (initialSupply === 0n || maxSupply < initialSupply || totalSupply > maxSupply || configVersion === 0n) invalid("inconsistent supply or version")
    const mintAuthority = addressField(row, "mintAuthority", true)
    const pendingMintAuthority = addressField(row, "pendingMintAuthority", true)
    const mintRenounced = booleanField(row, "mintRenounced")
    if (mintRenounced && (mintAuthority !== "" || pendingMintAuthority !== "")) invalid("renounced mint authority is still set")
    return {
        id,
        registryKey: stringField(row, "registryKey"),
        grc20Id: stringField(row, "grc20Id"),
        creator: addressField(row, "creator"),
        mode,
        name: stringField(row, "name"),
        ticker: stringField(row, "ticker"),
        decimals: decimals as number,
        initialSupply, maxSupply, totalSupply, configVersion,
        currencyKey: stringField(row, "currencyKey"),
        description: stringField(row, "description", true),
        image: stringField(row, "image", true),
        website: stringField(row, "website", true),
        xHandle: stringField(row, "xHandle", true),
        telegram: stringField(row, "telegram", true),
        metadataFrozen: booleanField(row, "metadataFrozen"),
        mintAuthority, pendingMintAuthority, mintRenounced,
    }
}

function parseTokenPage(value: unknown, size: number): LaunchpadToken[] {
    if (!Array.isArray(value) || value.length > size) invalid("invalid token page")
    return value.map(parseLaunchpadToken)
}

function parseQevalInt64(raw: string): bigint {
    const match = raw.match(/^\(\s*(0|[1-9][0-9]*)\s+int64\s*\)\s*$/)
    if (!match) invalid("invalid int64 result")
    const value = BigInt(match[1])
    if (value > MAX_INT64) invalid("int64 result out of range")
    return value
}

function parseQevalString(raw: string): string {
    const match = raw.match(/^\(\s*("[\s\S]*")\s+string\s*\)\s*$/)
    if (!match) invalid("invalid string result")
    try { return decodeGoQuoted(match[1]) } catch { return invalid("invalid quoted string") }
}

export interface TokenPageBatch {
    tokens: LaunchpadToken[]
    /** The next zero-based page when the request budget ends on a full page. */
    nextPage: number | null
}

/** No persistent cache: every call reads the active chain and detects network switches. */
export class TokenLaunchpadClient {
    constructor(
        readonly networkKey: string = ACTIVE_NETWORK_KEY,
        readonly realmPath: string = TOKEN_LAUNCHPAD_PATH,
    ) {}

    private assertNetwork(): void {
        // queryEval's RPC failover is tied to the app's active network. A client
        // captured before navigation must never read a different chain as its own.
        if (this.networkKey !== ACTIVE_NETWORK_KEY || currentNetworkKey() !== this.networkKey) {
            throw new TokenLaunchpadReadError("network_changed", "Launchpad network changed during read")
        }
    }

    private async read(expression: string): Promise<string> {
        this.assertNetwork()
        let raw: string | null
        try {
            raw = await queryEval(GNO_RPC_URL, this.realmPath, expression, true)
        } catch (error) {
            this.assertNetwork()
            if (error instanceof AbciQueryError) throw new TokenLaunchpadReadError("realm_error", "Launchpad realm rejected the read", { cause: error })
            throw new TokenLaunchpadReadError("rpc_error", "Launchpad RPC read failed", { cause: error })
        }
        this.assertNetwork()
        if (raw === null || raw === "") throw new TokenLaunchpadReadError("unavailable", "Launchpad realm returned no data")
        return raw
    }

    private async json(expression: string): Promise<unknown> {
        const parsed = parseQevalJSON(await this.read(expression))
        if (parsed === null) invalid("malformed JSON return")
        return parsed
    }

    async token(id: string): Promise<LaunchpadToken> {
        if (!/^T[1-9][0-9]{0,9}$/.test(id)) invalid("invalid requested id")
        const token = parseLaunchpadToken(await this.json(`TokenJSON(${JSON.stringify(id)})`))
        if (token.id !== id) invalid("token id mismatch")
        return token
    }

    async listPage(page: number, size = 100): Promise<LaunchpadToken[]> {
        if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 100) invalid("invalid page request")
        if (BigInt(page) * BigInt(size) > MAX_INT64) invalid("page exceeds int64")
        const tokens = parseTokenPage(await this.json(`ListTokensJSON(${page}, ${size})`), size)
        const start = BigInt(page) * BigInt(size)
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].id !== `T${start + BigInt(i) + 1n}`) invalid("token page has a gap or duplicate")
        }
        return tokens
    }

    async list(startPage = 0, pageSize = 100, maxPages = 3): Promise<TokenPageBatch> {
        if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10) invalid("invalid page budget")
        if (!Number.isSafeInteger(startPage) || startPage < 0 || !Number.isSafeInteger(startPage + maxPages)) invalid("invalid start page")
        const tokens: LaunchpadToken[] = []
        for (let offset = 0; offset < maxPages; offset++) {
            const page = startPage + offset
            if (!Number.isSafeInteger(page)) invalid("page overflow")
            const part = await this.listPage(page, pageSize)
            tokens.push(...part)
            if (part.length < pageSize) return { tokens, nextPage: null }
        }
        return { tokens, nextPage: startPage + maxPages }
    }

    async balanceOf(id: string, owner: string): Promise<bigint> {
        if (!/^T[1-9][0-9]{0,9}$/.test(id) || !isValidGnoAddressChecksum(owner)) invalid("invalid balance arguments")
        return parseQevalInt64(await this.read(`BalanceOf(${JSON.stringify(id)}, ${JSON.stringify(owner)})`))
    }

    /** Separate count read; ListTokensJSON deliberately returns no total. */
    async count(): Promise<bigint> {
        return parseQevalInt64(await this.read("Count()"))
    }

    async totalSupply(id: string): Promise<bigint> {
        if (!/^T[1-9][0-9]{0,9}$/.test(id)) invalid("invalid supply id")
        return parseQevalInt64(await this.read(`TotalSupply(${JSON.stringify(id)})`))
    }

    async registryKeyOf(id: string): Promise<string> {
        if (!/^T[1-9][0-9]{0,9}$/.test(id)) invalid("invalid registry id")
        const key = parseQevalString(await this.read(`RegistryKeyOf(${JSON.stringify(id)})`))
        if (key === "") invalid("empty registry key")
        return key
    }
}

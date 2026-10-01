/** Structured reads of the Token Launchpad ledger, `r/samcrew/launchpad/tokens/v1`.
 * Reads fail closed: off every network whose allowlist names the realm, and on a network switch.
 */
import { isValidGnoAddressChecksum } from "./dao/address"
import { queryEval, parseQevalJSON } from "./dao/shared"
import { ACTIVE_NETWORK_KEY, currentNetworkKey, GNO_RPC_URL, isRealmValidOn } from "./config"
import { AbciQueryError } from "./rpcFallback"

export const TOKEN_LAUNCHPAD_PATH = "gno.land/r/samcrew/launchpad/tokens/v1"
const MAX_INT64 = 9223372036854775807n
const CFORD32 = "0123456789abcdefghjkmnpqrstvwxyz"
export type TokenLaunchMode = "direct_fixed" | "direct_capped" | "fairsale"
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
    /** The realm that created the token and alone may mint it: the sales realm in release 1. */
    issuer: string
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
    if (raw.length > 19 || !/^(0|[1-9][0-9]*)$/.test(raw)) invalid(`invalid ${key}`)
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

// seqid.ID(n).String() uses cford32's seven-character compact encoding for
// every Launchpad public ID (T1..T9999999999, all below 2^34).
function registeredLedgerId(id: string): string {
    let n = BigInt(id.slice(1))
    const suffix = Array<string>(7)
    for (let i = 6; i >= 0; i--) {
        suffix[i] = CFORD32[Number(n & 31n)]
        n >>= 5n
    }
    return `${TOKEN_LAUNCHPAD_PATH}.${id}.${suffix.join("")}`
}

// Keys the schema does not name are ignored, so the realm can add fields.
/** Decode the exact TokenJSON/ListTokensJSON schema. Amounts must be decimal strings. */
export function parseLaunchpadToken(value: unknown): LaunchpadToken {
    const row = record(value)
    const id = stringField(row, "id")
    if (!/^T[1-9][0-9]{0,9}$/.test(id)) invalid("invalid id")
    const registryKey = stringField(row, "registryKey")
    const grc20Id = stringField(row, "grc20Id")
    if (registryKey !== `${TOKEN_LAUNCHPAD_PATH}.${id}` || grc20Id !== registeredLedgerId(id)) invalid("token registry identity mismatch")
    const mode = stringField(row, "mode")
    if (mode !== "direct_fixed" && mode !== "direct_capped" && mode !== "fairsale") invalid("invalid mode")
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
        registryKey,
        grc20Id,
        issuer: addressField(row, "issuer"),
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
    if (!match || match[1].length > 19) invalid("invalid int64 result")
    const value = BigInt(match[1])
    if (value > MAX_INT64) invalid("int64 result out of range")
    return value
}

/**
 * Reads one expression from a Launchpad realm on the network the caller was
 * built for. A read on another network than the app's, or of a realm the
 * network's allowlist does not name, fails before and after the RPC call.
 */
export async function readLaunchpad(networkKey: string, realmPath: string, expression: string): Promise<string> {
    const assertNetwork = () => {
        // queryEval's RPC failover is tied to the app's active network. A client
        // captured before navigation must never read a different chain as its own.
        if (networkKey !== ACTIVE_NETWORK_KEY || currentNetworkKey() !== networkKey) {
            throw new TokenLaunchpadReadError("network_changed", "Launchpad network changed during read")
        }
        if (!isRealmValidOn(networkKey, realmPath)) {
            throw new TokenLaunchpadReadError("unavailable", `${realmPath} is not enabled on this network`)
        }
    }
    assertNetwork()
    let raw: string | null
    try {
        raw = await queryEval(GNO_RPC_URL, realmPath, expression, true)
    } catch (error) {
        assertNetwork()
        if (error instanceof AbciQueryError) throw new TokenLaunchpadReadError("realm_error", `${realmPath} rejected the read`, { cause: error })
        throw new TokenLaunchpadReadError("rpc_error", "Launchpad RPC read failed", { cause: error })
    }
    assertNetwork()
    if (raw === null || raw === "") throw new TokenLaunchpadReadError("unavailable", `${realmPath} returned no data`)
    return raw
}

/** Reads a JSON view; the realm returns it as a Go string. */
export async function readLaunchpadJSON(networkKey: string, realmPath: string, expression: string): Promise<unknown> {
    const parsed = parseQevalJSON(await readLaunchpad(networkKey, realmPath, expression))
    if (parsed === null) throw new TokenLaunchpadReadError("invalid_response", `${realmPath} returned malformed JSON`)
    return parsed
}

/** Every read reaches the chain: no cache, so a network switch is always detected. */
export class TokenLaunchpadClient {
    constructor(readonly networkKey: string = ACTIVE_NETWORK_KEY) {}

    async listPage(page: number, size = 100): Promise<LaunchpadToken[]> {
        if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 100) invalid("invalid page request")
        if (BigInt(page) * BigInt(size) > MAX_INT64) invalid("page exceeds int64")
        const tokens = parseTokenPage(await readLaunchpadJSON(this.networkKey, TOKEN_LAUNCHPAD_PATH, `ListTokensJSON(${page}, ${size})`), size)
        const start = BigInt(page) * BigInt(size)
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].id !== `T${start + BigInt(i) + 1n}`) invalid("token page has a gap or duplicate")
        }
        return tokens
    }

    /** The number of tokens created; the next one is T<count + 1>. */
    async count(): Promise<bigint> {
        return parseQevalInt64(await readLaunchpad(this.networkKey, TOKEN_LAUNCHPAD_PATH, "Count()"))
    }

    async balanceOf(id: string, owner: string): Promise<bigint> {
        if (!/^T[1-9][0-9]{0,9}$/.test(id) || !isValidGnoAddressChecksum(owner)) invalid("invalid balance arguments")
        return parseQevalInt64(await readLaunchpad(this.networkKey, TOKEN_LAUNCHPAD_PATH, `BalanceOf(${JSON.stringify(id)}, address(${JSON.stringify(owner)}))`))
    }
}

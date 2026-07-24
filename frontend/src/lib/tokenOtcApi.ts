import { queryEval } from "./dao/shared"
import { MEMBA_DAO, GNO_RPC_URL } from "./config"
import { decodeOtcCsv, type OtcListing } from "./marketplace/codec"

// OtcListing now lives with the codec that validates it; re-export for existing consumers.
export type { OtcListing }

export async function fetchOtcListings(): Promise<OtcListing[]> {
    const raw = await queryEval(GNO_RPC_URL, MEMBA_DAO.tokenOtcPath, "GetListingsCSV()")
    if (!raw) return []
    // Validated decode — a malformed row is dropped rather than throwing into render.
    const decoded = decodeOtcCsv(raw)
    return decoded.ok ? decoded.value : []
}

export async function getTokenAllowance(symbol: string, owner: string, spender: string): Promise<bigint> {
    const expr = `Allowance("${symbol}", "${owner}", "${spender}")`
    const raw = await queryEval(GNO_RPC_URL, "gno.land/r/samcrew/tokenfactory_v2", expr)
    if (!raw) return 0n
    const match = raw.match(/\((\d+)\s+int64\)/)
    return match ? BigInt(match[1]) : 0n
}

// The OTC realm's Approve/Allowance calls need the engine's actual on-chain
// address, not its package path (WAVE1 TR-P0-4): the frontend was passing
// MEMBA_DAO.tokenOtcPath as the `spender` — a path string like
// "gno.land/r/samcrew/memba_token_otc_v2" — but the realm checks allowance
// against its own resolved address (`cur.Address()`), which the path is not.
// Approval never matched, and both List and Fill reverted. EngineAddress()
// (exposed by the realm precisely so callers don't have to hardcode the
// derived address) resolves the real spender. Cached module-level: this
// address is fixed for the lifetime of a given deployed realm instance,
// and (like GNO_RPC_URL/MEMBA_DAO) the module reloads on network switch.
let cachedEngineAddress: string | null = null

/** Test-only: clears the module-level engine-address cache. */
export function __resetOtcEngineAddressCache(): void {
    cachedEngineAddress = null
}

export async function getOtcEngineAddress(): Promise<string> {
    if (cachedEngineAddress) return cachedEngineAddress
    const raw = await queryEval(GNO_RPC_URL, MEMBA_DAO.tokenOtcPath, "EngineAddress()")
    const match = raw?.match(/"(g1[a-z0-9]+)"/)
    if (!match) throw new Error("Could not resolve the OTC engine address")
    cachedEngineAddress = match[1]
    return cachedEngineAddress
}

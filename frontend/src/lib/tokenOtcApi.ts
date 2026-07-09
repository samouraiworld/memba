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

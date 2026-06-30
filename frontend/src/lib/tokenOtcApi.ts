import { queryEval } from "./dao/shared"
import { MEMBA_DAO, GNO_RPC_URL } from "./config"

export interface OtcListing {
    id: string
    seller: string
    symbol: string
    expectedUnitPrice: bigint
    amountAvailable: bigint
}

export async function fetchOtcListings(): Promise<OtcListing[]> {
    const raw = await queryEval(GNO_RPC_URL, MEMBA_DAO.tokenOtcPath, "GetListingsCSV()")
    if (!raw) return []
    // Expected format: "ID|Seller|Symbol|Price|Amount,ID2|..."
    // Clean up quotes from the Amino string evaluation.
    const cleanRaw = raw.replace(/^"|"$/g, "")
    if (!cleanRaw) return []
    const parts = cleanRaw.split(",")
    const listings: OtcListing[] = []
    for (const part of parts) {
        if (!part) continue
        const [id, seller, symbol, expectedUnitPriceStr, amountAvailableStr] = part.split("|")
        listings.push({
            id,
            seller,
            symbol,
            expectedUnitPrice: BigInt(expectedUnitPriceStr),
            amountAvailable: BigInt(amountAvailableStr),
        })
    }
    return listings
}

export async function getTokenAllowance(symbol: string, owner: string, spender: string): Promise<bigint> {
    const expr = `Allowance("${symbol}", "${owner}", "${spender}")`
    const raw = await queryEval(GNO_RPC_URL, "gno.land/r/samcrew/tokenfactory_v2", expr)
    if (!raw) return 0n
    const match = raw.match(/\((\d+)\s+int64\)/)
    return match ? BigInt(match[1]) : 0n
}

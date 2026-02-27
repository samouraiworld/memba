/**
 * Account helpers — ABCI queries for on-chain account state.
 *
 * Uses JSON-RPC POST to prevent ABCI query injection via address.
 */

import { GNO_RPC_URL } from "./config"

/**
 * Fetch account number and sequence from the Gno chain.
 * Returns defaults (0, 0) on any error — callers should handle
 * the case where the account does not exist on-chain.
 */
export async function fetchAccountInfo(
    address: string,
): Promise<{ accountNumber: number; sequence: number }> {
    // Validate address format before querying to prevent injection
    if (!/^g(no)?1[a-z0-9]{38,}$/.test(address)) {
        return { accountNumber: 0, sequence: 0 }
    }

    try {
        const res = await fetch(GNO_RPC_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "memba",
                method: "abci_query",
                params: { path: `auth/accounts/${address}`, data: "" },
            }),
        })
        const json = await res.json()
        const rawValue = json?.result?.response?.ResponseBase?.Value
        if (!rawValue) return { accountNumber: 0, sequence: 0 }
        const decoded = atob(rawValue)
        const parsed = JSON.parse(decoded)
        const inner = parsed?.BaseAccount || parsed
        return {
            accountNumber: parseInt(inner?.account_number || "0", 10),
            sequence: parseInt(inner?.sequence || "0", 10),
        }
    } catch {
        return { accountNumber: 0, sequence: 0 }
    }
}

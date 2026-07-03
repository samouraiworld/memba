/**
 * Account helpers — ABCI queries for on-chain account state.
 *
 * Uses JSON-RPC POST to prevent ABCI query injection via address.
 */

import { resilientFetch, AbciQueryError, abciErrorPresent } from "./rpcFallback"

/**
 * Fetch account number and sequence from the Gno chain.
 *
 * FAILS LOUD (W2.2, R2-CHN-G): a transport failure, an ABCI-level error or an
 * unparseable response THROWS — it never silently returns `{0,0}`. The old
 * behavior fed `sequence: 0` into multisig sign-docs whenever the RPC was
 * down, producing txs that die on-chain with a sequence mismatch, and made
 * "RPC unreachable" indistinguishable from "account not on-chain".
 *
 * `{accountNumber: 0, sequence: 0}` is returned ONLY for the one case where
 * zeros are the truth: the chain answered and the account has no on-chain
 * record yet (never transacted).
 */
export async function fetchAccountInfo(
    address: string,
): Promise<{ accountNumber: number; sequence: number }> {
    // Validate address format before querying to prevent injection
    if (!/^g(no)?1[a-z0-9]{38,}$/.test(address)) {
        throw new Error(`fetchAccountInfo: not a valid gno address: ${JSON.stringify(address)}`)
    }

    // Transport failure (all endpoints down / non-JSON body) throws — with a
    // message the multisig sign flows can surface to the user as-is.
    let json: { result?: { response?: { ResponseBase?: { Error?: unknown; Log?: unknown; Value?: string } } } }
    try {
        const res = await resilientFetch((rpcUrl) => ({
            url: rpcUrl,
            init: {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: "memba",
                    method: "abci_query",
                    params: { path: `auth/accounts/${address}`, data: "" },
                }),
            },
        }))
        json = await res.json()
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
            `Could not read on-chain account state (${msg}). ` +
            `Check your connection and try again — signing without it would produce an invalid transaction.`,
        )
    }
    const base = json?.result?.response?.ResponseBase
    const rawValue = base?.Value
    // The chain answers "no on-chain record for this address" (never-transacted)
    // either as a clean empty OR as an ABCI error object like
    // {"@type":"/std.UnknownAddressError"} with no Value — the live chain does
    // the latter (see backend render_proxy.go + its live tests). Both are the
    // one truthful-zeros case, NOT a failure. An error WITH a Value is an
    // anomaly worth raising.
    if (abciErrorPresent(base?.Error) && rawValue) {
        throw new AbciQueryError(
            `auth/accounts/${address}`,
            base?.Error,
            typeof base?.Log === "string" ? base.Log : "",
        )
    }
    if (!rawValue) return { accountNumber: 0, sequence: 0 }
    const decoded = atob(rawValue)
    const parsed = JSON.parse(decoded)
    const inner = parsed?.BaseAccount || parsed
    return {
        accountNumber: parseInt(inner?.account_number || "0", 10),
        sequence: parseInt(inner?.sequence || "0", 10),
    }
}

/**
 * Account helpers — ABCI queries for on-chain account state.
 *
 * Uses JSON-RPC POST to prevent ABCI query injection via address.
 */

import { resilientFetch, AbciQueryError, abciErrorPresent, getRpcUrlsInOrder } from "./rpcFallback"
import { GNO_CHAIN_ID, GNO_RPC_URL } from "./config"
import { abciQueryText, ChainAnswerError } from "./dao/packageStatus"

/** A public key as the chain records it: its amino type and base64 value. */
export interface ChainPublicKey { "@type": string; value: string }

/**
 * The public key the chain holds for `address`, or null while the address has
 * never signed a transaction there (the chain learns a key from its first one),
 * and for text that is not an address. Read from a node that serves `chainId`,
 * which decides what a valid spelling is; throws when none answers.
 */
export async function chainPublicKey(address: string, chainId: string = GNO_CHAIN_ID): Promise<ChainPublicKey | null> {
    // Only the shape is checked here (it goes into the query path), in either case: the chain refuses a bad checksum.
    if (!/^g1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/i.test(address)) return null
    let text: string
    try {
        text = await abciQueryText({ rpcUrl: GNO_RPC_URL, rpcUrls: getRpcUrlsInOrder(), chainId }, `auth/accounts/${address}`, "")
    } catch (err) {
        // The chain answered and has no account there (or refused the address): nothing has signed from it.
        if (err instanceof ChainAnswerError) return null
        throw err
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any = JSON.parse(text)
    const account = parsed?.BaseAccount || parsed?.value?.BaseAccount || parsed?.value || parsed
    const key = account?.pub_key || account?.PubKey || account?.public_key
    return typeof key?.["@type"] === "string" && key["@type"] ? { "@type": key["@type"], value: typeof key.value === "string" ? key.value : "" } : null
}

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
    let json: { error?: unknown; result?: { response?: { Value?: string | null; ResponseBase?: { Error?: unknown; Log?: unknown; Data?: string | null; Value?: string | null } } } }
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
    const response = json?.result?.response
    const base = response?.ResponseBase
    if (json?.error || !base) throw new Error("Could not read on-chain account state: malformed or failed RPC response")
    // Native auth/accounts writes ResponseBase.Data (not ResponseQuery.Value).
    // Retain Value-shaped proxy/legacy replies without confusing absent data
    // with a genuine zero account number/sequence.
    const payloads = [base.Data, base.Value, response?.Value].filter((v): v is string => typeof v === "string" && !!v)
    if (new Set(payloads).size > 1) throw new Error("Conflicting account data in RPC response")
    const rawValue = payloads[0]
    // Preserve the explicit legacy unknown-address encoding. Other errors are
    // failures, even without data: they must never manufacture zero counters.
    if (abciErrorPresent(base.Error)) {
        const errorType = base.Error && typeof base.Error === "object" && "@type" in base.Error ? base.Error["@type"] : ""
        if (errorType === "/std.UnknownAddressError" && !rawValue) return { accountNumber: 0, sequence: 0 }
        throw new AbciQueryError(
            `auth/accounts/${address}`,
            base?.Error,
            typeof base?.Log === "string" ? base.Log : "",
        )
    }
    if (!rawValue) {
        // Explicit clean-empty legacy response, not arbitrary proxy garbage.
        if (("Value" in base && base.Value == null) || base.Value === "") return { accountNumber: 0, sequence: 0 }
        throw new Error("Could not read on-chain account state: missing account data")
    }
    const decoded = atob(rawValue)
    const parsed = JSON.parse(decoded)
    // The native account keeper encodes a nonexistent account as JSON null.
    if (parsed === null) return { accountNumber: 0, sequence: 0 }
    const inner = parsed?.BaseAccount || parsed?.value?.BaseAccount || parsed?.value || parsed
    if (inner?.address && inner.address !== address) throw new Error("RPC returned a different account")
    const counter = (value: unknown): number => {
        if ((typeof value !== "string" && typeof value !== "number") || !/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error("Malformed account number or sequence")
        const number = Number(value)
        if (!Number.isSafeInteger(number) || number > 0xffffffff) throw new Error("Account number or sequence exceeds the supported transaction API range")
        return number
    }
    return {
        accountNumber: counter(inner?.account_number),
        sequence: counter(inner?.sequence),
    }
}

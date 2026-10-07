/**
 * What a transaction signed for an account changes on chain: the sequence of
 * the key that signed, or at least the coins that paid the fee (a session key
 * has its own sequence; the fee is taken from the master account).
 *
 * The account is read at an exact block height, so the read itself does not
 * depend on which node answers. The height to read at does: it comes from one
 * node's `status`, and a node can be behind the network without saying so
 * (`catching_up` is only its fast-sync switch). A head is therefore accepted
 * only while its block time is recent by this device's clock, and one block of
 * lag is allowed for by waiting one block more.
 *
 * None of this proves that nothing was sent: a transaction the node accepted
 * has no deadline to be included. It is an observation, and is worded as one.
 *
 * @module os/sign/accountMark
 */
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"

const READ_MS = 5000
const POLL_MS = 2000
/**
 * Measured on gnoland-1 and onyx-1 (30 September 2026, twelve `status` reads
 * each against a synchronised clock): a block is committed about every 3.4 s,
 * and a block's time is that of the commit before it, so the head's block time
 * is already 3.4 to 6.8 s old. One block behind it is 6.8 to 10 s old, two
 * blocks behind more than 10 s. A limit of two intervals would refuse healthy
 * heads at the top of their range; ten seconds always refuses a node two
 * blocks behind and admits one that is a single block behind.
 */
const STALE_HEAD_MS = 10_000
/**
 * Read three blocks after the reported head: two blocks after the network's
 * real head when the node was the one block behind that STALE_HEAD_MS admits.
 * A transaction sent just before the wallet's reply is normally in one of
 * those two blocks.
 */
const SETTLE_BLOCKS = 3
/** How long the chain gets to commit them. A last read can end up to 5 s later: 35 s at worst. */
const SETTLE_WITHIN_MS = 30_000

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {})

async function rpc(method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await fetch(GNO_RPC_URL, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(READ_MS),
        body: JSON.stringify({ jsonrpc: "2.0", id: "memba", method, params }),
    })
    if (!res.ok) throw new Error(`RPC answered ${res.status}`)
    const json = record(await res.json())
    if (json.error) throw new Error("RPC error")
    return record(json.result)
}

/** The last block a node of this network has, refused when that block is not recent. */
async function chainHead(): Promise<number> {
    const status = await rpc("status", {})
    const sync = record(status.sync_info)
    const height = Number(sync.latest_block_height)
    if (record(status.node_info).network !== GNO_CHAIN_ID || sync.catching_up !== false || !Number.isSafeInteger(height) || height <= 0) {
        throw new Error("The node is on another network or not in sync")
    }
    // A block from the future means this device's clock is behind: its age cannot be judged either.
    // The node gives nanoseconds; not every browser parses more than milliseconds.
    const age = Date.now() - Date.parse(String(sync.latest_block_time).replace(/(\.\d{3})\d+/, "$1"))
    if (!(age >= 0 && age <= STALE_HEAD_MS)) throw new Error("The node's last block is not recent")
    return height
}

/**
 * Sequence and coins of `address` as one comparable value, after block
 * `height` (when omitted, the head of a node that is on this network and
 * recent: an RPC pool can hand the read to another chain). Rejects while the
 * node does not have that block, and for an account it does not know: a
 * missing account is not something to compare.
 */
export async function accountMark(address: string, height?: number): Promise<string> {
    if (!/^g1[a-z0-9]{38}$/.test(address)) throw new Error("Not a gno.land address")
    const at = height ?? await chainHead()
    const result = await rpc("abci_query", { path: `auth/accounts/${address}`, data: "", height: String(at) })
    const base = record(record(result.response).ResponseBase)
    if (base.Error || typeof base.Data !== "string" || !base.Data) throw new Error("The account could not be read")
    const account = record(record(JSON.parse(atob(base.Data))).BaseAccount)
    if (account.address !== address || typeof account.sequence !== "string" || typeof account.coins !== "string") throw new Error("The account could not be read")
    return `${account.sequence} ${account.coins}`
}

/**
 * The account a few blocks after the moment of the call (see SETTLE_BLOCKS).
 * Counts blocks, not seconds: a slow round or a halt makes it wait, and it
 * rejects when the chain has not got there in time, or when `stop` fires.
 */
export async function accountMarkAfterBlocks(address: string, stop?: AbortSignal): Promise<string> {
    const deadline = Date.now() + SETTLE_WITHIN_MS
    const target = (await chainHead()) + SETTLE_BLOCKS
    for (;;) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        if (stop?.aborted) throw new Error("No longer needed")
        try { return await accountMark(address, target) } catch { /* that block is not committed yet, or the read failed */ }
        if (Date.now() + POLL_MS > deadline) throw new Error("The chain did not commit the next blocks in time")
    }
}

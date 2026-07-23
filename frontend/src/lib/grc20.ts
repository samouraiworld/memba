/**
 * GRC20 Token helpers for the gno.land/r/samcrew/tokenfactory realm.
 *
 * - ABCI query helpers (list tokens, get info, balance)
 * - MsgCall builder for factory functions
 * - Platform fee constants (2.5% to Samouraï Coop)
 * - v2.1a: $MEMBA/$MEMBATEST token helpers
 */

import { GRC20_FACTORY_PATH as _FACTORY_PATH, MEMBA_TOKEN, GNO_CHAIN_ID, API_BASE_URL } from "./config"
import { getGasConfig } from "./gasConfig"
import * as Sentry from "@sentry/react"

// ── Platform Fee ──────────────────────────────────────────────

/** 2.5% platform fee on every mint (v2.1a: reduced from 5%). */
export const PLATFORM_FEE_RATE = 0.025

/** Samouraï Coop multisig — fee recipient on all networks. */
export const FEE_RECIPIENT = "g1pavqfezrge9kgkrkrahqm982yhw5j45v0zw27v"

/**
 * grc20factory realm path.
 * @deprecated Import from `config.ts` instead: `import { GRC20_FACTORY_PATH } from "./config"`
 */
export const GRC20_FACTORY_PATH = _FACTORY_PATH

// ── Types ─────────────────────────────────────────────────────

export interface TokenInfo {
    name: string
    symbol: string
    decimals: number
    totalSupply: string
    admin: string
    /** Accounts known to the token's balance ledger (the GRC20 "Known accounts"
     *  Render field) ≈ holder count. Undefined when the render omits it. */
    knownAccounts?: number
}

export interface AminoMsg {
    type: string
    value: Record<string, unknown>
}

// ── Adena DoContract Helpers ──────────────────────────────────

/**
 * Convert Amino messages to the shape Adena's DoContract expects.
 *
 * - vm/MsgCall is converted to /vm.m_call.
 * - /vm.m_addpkg (realm deploys built by templates/prologue) and bank/MsgSend
 *   (wallet activation self-send) are already wire-shaped — passed through so
 *   deploys and sends can ride the SAME guarded broadcaster (W2.1).
 * - Anything else throws: an unknown type must never reach the wallet.
 *
 * NOTE: MsgRun (/vm.m_run) was tested but can't modify external realm state,
 *       so all DAO calls must use MsgCall with crossing() functions.
 */
export function toAdenaMessages(msgs: AminoMsg[]) {
    return msgs.map((m) => {
        if (m.type === "vm/MsgCall") {
            return {
                type: "/vm.m_call",
                value: {
                    caller: m.value.caller as string,
                    send: (m.value.send as string) || "",
                    pkg_path: m.value.pkg_path as string,
                    func: m.value.func as string,
                    args: m.value.args as string[],
                },
            }
        }
        if (m.type === "/vm.m_addpkg" || m.type === "bank/MsgSend") {
            return m
        }
        throw new Error(`toAdenaMessages: unsupported message type: ${m.type}`)
    })
}

// ── Wallet RPC Security Guard ─────────────────────────────────

/**
 * Module-level state set by useAdena on connect/network-change.
 * Used to block DoContract calls through untrusted Adena RPCs.
 */
let _walletRpcUrl: string | null = null
let _walletRpcTrusted = false
let _walletChainId: string | null = null

/** Called by useAdena to sync the wallet's active RPC validation state +
 *  the wallet's active chainId (used to block wrong-chain broadcasts). */
export function setWalletRpcContext(url: string | null, trusted: boolean, chainId: string | null = null) {
    _walletRpcUrl = url
    _walletRpcTrusted = trusted
    _walletChainId = chainId
}

/** Read current wallet RPC context (for UI components). */
export function getWalletRpcContext(): { url: string | null; trusted: boolean } {
    return { url: _walletRpcUrl, trusted: _walletRpcTrusted }
}

/**
 * Sentinel chainId meaning "the wallet just switched networks and the new
 * chain could not be verified" (GetAccount failed right after changedNetwork).
 * It can never match a real chain, so the wrong-chain guard FAILS CLOSED until
 * the next successful account read or reconnect — the alternative (null)
 * silently disables the guard, which is exactly the R2-CHN-E bug.
 */
export const UNVERIFIED_CHAIN_ID = "__unverified__"

/**
 * Run the RPC-trust + wrong-chain guards without broadcasting; throws a
 * user-facing error when signing/broadcasting must be blocked. Split out of
 * doContractBroadcast so flows with their own transport (multisig
 * BroadcastMultisigTransaction) can apply the SAME safety checks (W2.1).
 */
export function assertWalletBroadcastSafe(): void {
    // SECURITY: Block transactions through untrusted or unverifiable RPC
    if (!_walletRpcTrusted) {
        const detail = _walletRpcUrl
            ? `Your wallet is using an untrusted RPC: ${_walletRpcUrl}`
            : "Unable to verify your wallet's RPC URL"
        throw new Error(
            `🛡️ Transaction blocked — ${detail}. ` +
            `Open Adena → Settings → Networks → switch to a trusted *.gno.land RPC.`
        )
    }

    // SECURITY (defense-in-depth): never sign for the wrong chain. The wallet's
    // active chainId must match Memba's active network, or the user could
    // broadcast a Memba-built tx onto a different chain (e.g. during the
    // test12↔test13 window). chainId is the on-wire value (e.g. "test-13").
    if (_walletChainId && _walletChainId !== GNO_CHAIN_ID) {
        if (_walletChainId === UNVERIFIED_CHAIN_ID) {
            throw new Error(
                `🛡️ Transaction blocked — your wallet's network changed and the new chain could not be verified. ` +
                `Reconnect your wallet (or switch Adena back to "${GNO_CHAIN_ID}") before signing.`
            )
        }
        throw new Error(
            `🛡️ Transaction blocked — your wallet is on chain "${_walletChainId}" but Memba is on "${GNO_CHAIN_ID}". ` +
            `Switch your wallet's network in Adena to match before signing.`
        )
    }
}
// ── A6: Transaction Confirmation Gate ─────────────────────────

/**
 * Module-level confirmation callback, registered by TxConfirmationProvider.
 * When set, doContractBroadcast will call this before broadcasting and
 * block until the user confirms or cancels. Returns true to proceed.
 *
 * @see components/ui/TxConfirmation.tsx
 */
type TxConfirmCallback = (msgs: AminoMsg[], memo: string) => Promise<boolean>
let _txConfirmCallback: TxConfirmCallback | null = null

/**
 * Register the confirmation callback. Called by TxConfirmationProvider on mount.
 * Pass null to unregister (e.g., on unmount or in tests).
 */
export function setTxConfirmationCallback(cb: TxConfirmCallback | null) {
    _txConfirmCallback = cb
}

/**
 * Sign + broadcast via Adena DoContract.
 * Returns { hash, error } — throws if Adena is unavailable.
 *
 * SECURITY: Blocks all transactions if the wallet's RPC URL is untrusted.
 * The wallet RPC is validated by useAdena via Adena's GetNetwork() API.
 *
 * A6: Blocks with a user confirmation modal before broadcasting.
 * The modal shows a summary of the transaction effects (action, recipients,
 * amounts, message count). If cancelled, throws with a user-friendly message.
 *
 * RESILIENCE: Retries transient network failures (timeout, fetch) up to 2 times
 * with exponential backoff. User-initiated cancellations are never retried.
 */
export async function doContractBroadcast(
    msgs: AminoMsg[],
    memo: string,
    opts?: { gas?: "call" | "deploy" },
): Promise<{ hash: string }> {
    // A6: Confirmation gate — ask user before broadcasting
    if (_txConfirmCallback) {
        const confirmed = await _txConfirmCallback(msgs, memo)
        if (!confirmed) {
            throw new Error("Transaction cancelled by user")
        }
    }

    // SECURITY: RPC-trust + wrong-chain guards (shared with multisig broadcast)
    assertWalletBroadcastSafe()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adena = (window as any).adena
    if (!adena?.DoContract) {
        throw new Error("Adena wallet not available — please install or refresh the page")
    }

    const gas = getGasConfig()
    // Realm deploys (/vm.m_addpkg) need the elevated deploy budget — and must
    // NEVER auto-retry: a lost response after a landed deploy would re-prompt
    // the wallet sign UI just to fail with "package already exists".
    const isDeploy = opts?.gas === "deploy"
    const gasWanted = isDeploy ? gas.deployWanted : gas.wanted
    const maxRetries = isDeploy ? 0 : 2
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await adena.DoContract({
                messages: toAdenaMessages(msgs),
                gasFee: gas.fee,
                gasWanted,
                memo,
            })

            if (res.status === "failure") {
                const errMsg = res.message || res.data?.message || "Transaction failed"
                // Don't retry user cancellations or wallet rejections
                if (/user (rejected|denied)|cancelled/i.test(errMsg)) {
                    throw new Error(errMsg)
                }
                // Don't retry deterministic chain errors
                if (/insufficient funds|unauthorized|not a member|already voted|out of gas|package already exists/i.test(errMsg)) {
                    throw new Error(errMsg)
                }
                lastError = new Error(errMsg)
            } else {
                return { hash: res.data?.hash || "" }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            // Don't retry user cancellations
            if (/user (rejected|denied)|cancelled/i.test(msg)) throw err
            // Don't retry deterministic errors
            if (/insufficient funds|unauthorized|not a member|already voted|out of gas|package already exists/i.test(msg)) throw err
            lastError = err instanceof Error ? err : new Error(msg)
        }

        // Exponential backoff: 1s, 2s
        if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        }
    }

    // W6.5 money-path visibility: reaching here means every retry was
    // exhausted on an INFRASTRUCTURE failure (user rejections and domain
    // errors — insufficient funds, not a member, … — threw earlier and are
    // deliberately not reported). Addresses/JWTs are scrubbed by the global
    // beforeSend; no-op when Sentry.init didn't run.
    const terminal = lastError || new Error("Transaction failed after retries")
    Sentry.captureException(terminal, { tags: { memba_path: "tx-broadcast" } })
    throw terminal
}

// ── ABCI Queries ──────────────────────────────────────────────

/**
 * Query Render("") on grc20factory to list all tokens.
 * Returns markdown like: "# GRC20 Tokens (2)\n- [Foo ($FOO)](/r/demo/grc20factory:FOO)"
 */
export async function listFactoryTokens(rpcUrl: string): Promise<TokenInfo[]> {
    const data = await queryRender(rpcUrl, GRC20_FACTORY_PATH, "")
    if (!data) return []

    const tokens: TokenInfo[] = []
    // Parse markdown list items: "- [Name \($SYMBOL\)](link)" (factory escapes parens)
    const re = /\[(.+?)\s+\\?\(\$([A-Z0-9]+)\\?\)\]/g
    let match
    while ((match = re.exec(data)) !== null) {
        tokens.push({
            name: match[1],
            symbol: match[2],
            decimals: 0, // filled by individual query
            totalSupply: "0",
            admin: "",
        })
    }

    return tokens
}

/**
 * Query Render("SYMBOL") on grc20factory for a specific token's details.
 * Returns markdown like: "# Foo ($FOO)\n\n* **Decimals**: 4\n* **Total supply**: 10000\n* **Admin**: g1..."
 */
export async function getTokenInfo(rpcUrl: string, symbol: string): Promise<TokenInfo | null> {
    const data = await queryRender(rpcUrl, GRC20_FACTORY_PATH, symbol)
    if (!data) return null

    const nameMatch = data.match(/^#\s+(.+?)\s+\(\$([A-Z0-9]+)\)/m)
    const decimalsMatch = data.match(/\*\*Decimals\*\*:\s*(\d+)/)
    const supplyMatch = data.match(/\*\*Total supply\*\*:\s*(\d+)/)
    const adminMatch = data.match(/\*\*Admin\*\*:\s*(g\S+)/)
    const accountsMatch = data.match(/\*\*Known accounts\*\*:\s*(\d+)/)

    return {
        name: nameMatch?.[1] || symbol,
        symbol: nameMatch?.[2] || symbol,
        decimals: decimalsMatch ? parseInt(decimalsMatch[1], 10) : 6,
        totalSupply: supplyMatch?.[1] || "0",
        admin: adminMatch?.[1] || "",
        knownAccounts: accountsMatch ? parseInt(accountsMatch[1], 10) : undefined,
    }
}

// Module-level cache: a token's decimals are immutable once created (New/
// NewWithAdmin have no setter), so caching per-symbol avoids a Render fetch on
// every amount conversion. Reloads on network switch (module re-evaluates),
// same lifetime as tokenOtcApi's cachedEngineAddress.
const decimalsCache = new Map<string, number>()

/**
 * Cached decimals lookup for a tokenfactory_v2 symbol. Falls back to
 * getTokenInfo's own default (6) if the token can't be found/parsed — never
 * throws, so a lookup failure degrades to "assume 6" rather than blocking the
 * caller; callers that move funds should gate on knowing decimals loaded
 * successfully rather than trust the fallback silently.
 */
export async function getTokenDecimals(rpcUrl: string, symbol: string): Promise<number> {
    const cached = decimalsCache.get(symbol)
    if (cached !== undefined) return cached
    const info = await getTokenInfo(rpcUrl, symbol)
    const decimals = info?.decimals ?? 6
    decimalsCache.set(symbol, decimals)
    return decimals
}

/** Test-only: clears the module-level decimals cache. */
export function __resetTokenDecimalsCache(): void {
    decimalsCache.clear()
}

/**
 * Fetch the server-computed {symbol: launchedAtISO} map of token creation times.
 * The realm stores no creation time; the backend resolves it from the tx-indexer
 * (too slow for the browser — exceeds the indexer-proxy timeout) and caches it.
 * Best-effort: returns {} on any failure, so callers simply omit launch dates
 * (honesty — never fabricated). The map may be empty until the backend's first
 * background scan completes.
 */
export async function fetchTokenLaunchDates(signal?: AbortSignal): Promise<Record<string, string>> {
    try {
        const res = await fetch(`${API_BASE_URL}/api/token-launches`, { signal })
        if (!res.ok) return {}
        const data = (await res.json()) as Record<string, string>
        return data && typeof data === "object" ? data : {}
    } catch {
        return {}
    }
}

/**
 * Query token balance for an address via vm/qeval.
 * Calls: grc20factory.BalanceOf("SYMBOL", "g1address")
 */
export async function getTokenBalance(
    rpcUrl: string,
    symbol: string,
    address: string,
): Promise<bigint> {
    // qeval format: pkgpath.Expression() — dot after last path segment
    const expr = `BalanceOf("${sanitize(symbol)}", "${sanitize(address)}")`
    const data = await queryEval(rpcUrl, GRC20_FACTORY_PATH, expr)
    if (!data) return 0n

    // qeval returns: "(1000 int64)\n"
    const match = data.match(/\((\d+)\s+int64\)/)
    return match ? BigInt(match[1]) : 0n
}

// ── MsgCall Builders ──────────────────────────────────────────

/**
 * Build MsgCall for grc20factory.New() — creates token with caller as admin.
 *
 * A4: The tokenfactory realm applies a 2.5% fee on-chain via `applyFee`.
 * The client-side Transfer to FEE_RECIPIENT was removed to stop double-charging.
 */
export function buildCreateTokenMsgs(
    callerAddress: string,
    name: string,
    symbol: string,
    decimals: number,
    initialMint: bigint,
    faucetAmount: bigint,
): AminoMsg[] {
    return [
        buildMsgCall("New", [
            name,
            symbol,
            String(decimals),
            String(initialMint),
            String(faucetAmount),
        ], callerAddress),
    ]
}

/**
 * Build MsgCall for grc20factory.NewWithAdmin() — creates token with specified admin (e.g. multisig).
 *
 * A4: The tokenfactory realm applies a 2.5% fee on-chain via `applyFee`.
 * The client-side Transfer to FEE_RECIPIENT was removed to stop double-charging.
 */
export function buildCreateTokenWithAdminMsgs(
    callerAddress: string,
    name: string,
    symbol: string,
    decimals: number,
    initialMint: bigint,
    faucetAmount: bigint,
    adminAddress: string,
): AminoMsg[] {
    return [
        buildMsgCall("NewWithAdmin", [
            name,
            symbol,
            String(decimals),
            String(initialMint),
            String(faucetAmount),
            adminAddress,
        ], callerAddress),
    ]
}

/**
 * Build MsgCall for grc20factory.Mint() — mints tokens (admin only).
 *
 * A4: The tokenfactory realm applies a 2.5% fee on-chain via `applyFee`.
 * The client-side Transfer to FEE_RECIPIENT was removed to stop double-charging.
 * This also fixes the side-bug where minting to a third party reverted when the
 * caller held no tokens (the fee Transfer drew from the caller's balance).
 */
export function buildMintMsgs(
    callerAddress: string,
    symbol: string,
    to: string,
    amount: bigint,
): AminoMsg[] {
    return [
        buildMsgCall("Mint", [symbol, to, String(amount)], callerAddress),
    ]
}

/**
 * Build single MsgCall for simple operations (Transfer, Burn, Approve).
 */
export function buildTransferMsg(caller: string, symbol: string, to: string, amount: string): AminoMsg {
    return buildMsgCall("Transfer", [symbol, to, amount], caller)
}

export function buildBurnMsg(caller: string, symbol: string, from: string, amount: string): AminoMsg {
    return buildMsgCall("Burn", [symbol, from, amount], caller)
}

export function buildApproveMsg(caller: string, symbol: string, spender: string, amount: string): AminoMsg {
    return buildMsgCall("Approve", [symbol, spender, amount], caller)
}

export function buildFaucetMsg(caller: string, symbol: string): AminoMsg {
    return buildMsgCall("Faucet", [symbol], caller)
}

// ── Supply Bounds & Amount Parsing ────────────────────────────

/**
 * Largest value the on-chain tokenfactory can hold. Token amounts (initial
 * mint, faucet, per-account balances, total supply) are Gno `int64`, so any
 * argument above this overflows at the VM's argument-decoding step and the tx
 * fails with `strconv.ParseInt: value out of range` before the realm even runs.
 * The browser uses unbounded BigInt, so this ceiling MUST be enforced here.
 */
export const MAX_INT64 = 9223372036854775807n

/**
 * Parse a human-entered token amount (in whole tokens, optionally with a
 * decimal point) into base units — the integer the contract actually stores.
 *
 * e.g. parseTokenAmount("1000000", 6)  → 1000000000000n  (1M tokens)
 *      parseTokenAmount("1.5", 6)      → 1500000n        (1.5 tokens)
 *      parseTokenAmount("", 6)         → 0n
 *
 * Throws an Error with a user-facing message on malformed input or more
 * fractional digits than the token's `decimals` allow.
 */
export function parseTokenAmount(input: string, decimals: number): bigint {
    const s = input.trim()
    if (!s) return 0n
    if (!/^\d+(\.\d+)?$/.test(s)) {
        throw new Error("Enter a plain number like 1000000 or 1.5 — no commas, units, or scientific notation")
    }
    const [whole, frac = ""] = s.split(".")
    if (frac.length > decimals) {
        throw new Error(`Too many decimal places — this token supports at most ${decimals}`)
    }
    return BigInt(whole + frac.padEnd(decimals, "0"))
}

/**
 * Largest whole-token supply that fits the int64 ceiling at a given decimals,
 * as a grouped display string (e.g. 6 decimals → "9,223,372,036,854"). Used to
 * tell the user the cap in the units they typed in.
 */
export function maxWholeTokens(decimals: number): string {
    const whole = (MAX_INT64 / 10n ** BigInt(decimals)).toString()
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

// ── Fee Calculation ───────────────────────────────────────────

/** Calculate 2.5% platform fee. Rounds down. */
export function calculateFee(amount: bigint): bigint {
    return amount * 25n / 1000n
}

/** Format fee disclosure text. */
export function feeDisclosure(amount: bigint, symbol: string): string {
    const fee = calculateFee(amount)
    return `A 2.5% platform fee (${fee} ${symbol}) supports Samouraï Coop development & maintenance.`
}

// ── v2.1a: $MEMBA Token Helpers ───────────────────────────────

/**
 * Build MsgCalls to create the $MEMBA/$MEMBATEST token.
 * Uses config-driven symbol/name/decimals.
 */
export function buildCreateMembaTokenMsgs(
    callerAddress: string,
    initialMint: bigint = BigInt(MEMBA_TOKEN.totalSupply),
): AminoMsg[] {
    return buildCreateTokenMsgs(
        callerAddress,
        MEMBA_TOKEN.name,
        MEMBA_TOKEN.symbol,
        MEMBA_TOKEN.decimals,
        initialMint,
        0n, // no faucet
    )
}

/**
 * Convenience: get $MEMBA/$MEMBATEST balance for an address.
 */
export async function getMembaBalance(rpcUrl: string, address: string): Promise<bigint> {
    return getTokenBalance(rpcUrl, MEMBA_TOKEN.symbol, address)
}

/**
 * Format a token amount with decimals for display.
 * Trailing zeros are stripped for readability.
 * Example: formatTokenAmount(1000000n, 6) → "1"
 * Example: formatTokenAmount(1500000n, 6) → "1.5"
 */
export function formatTokenAmount(amount: bigint, decimals: number = MEMBA_TOKEN.decimals): string {
    const divisor = 10n ** BigInt(decimals)
    const whole = amount / divisor
    const frac = amount % divisor
    if (frac === 0n) return whole.toString()
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "")
    return `${whole}.${fracStr}`
}

/**
 * Format a raw total-supply string (base units, as parsed from the token Render)
 * for compact display on the home cards: decimal-scaled and thousands-grouped.
 * Returns `null` for a zero/unparsable supply so callers OMIT it (honesty — never
 * render a misleading "0"). e.g. ("102500100", 6) → "102.5001".
 */
export function formatSupply(rawSupply: string, decimals: number): string | null {
    if (!/^\d+$/.test(rawSupply)) return null
    let amount: bigint
    try {
        amount = BigInt(rawSupply)
    } catch {
        return null
    }
    if (amount === 0n) return null
    const scaled = formatTokenAmount(amount, decimals) // "102.5001" / "1000000"
    const [whole, frac] = scaled.split(".")
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    return frac ? `${grouped}.${frac}` : grouped
}

// ── Internal Helpers ──────────────────────────────────────────

/** Build Amino MsgCall for grc20factory. */
function buildMsgCall(func: string, args: string[], caller: string): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: GRC20_FACTORY_PATH,
            func,
            args,
        },
    }
}

/**
 * Query vm/qrender for a realm's Render(path) output.
 * Data format: "pkgpath:renderpath" (colon separator).
 * Response: ResponseBase.Data (base64).
 */
async function queryRender(rpcUrl: string, pkgPath: string, renderPath: string): Promise<string | null> {
    return abciQuery(rpcUrl, "vm/qrender", `${pkgPath}:${renderPath}`)
}

/**
 * Query vm/qeval for evaluating an expression in a realm.
 * Data format: "pkgpath.Expression()" (dot after last path segment).
 * Response: ResponseBase.Data (base64).
 */
async function queryEval(rpcUrl: string, pkgPath: string, expr: string): Promise<string | null> {
    return abciQuery(rpcUrl, "vm/qeval", `${pkgPath}.${expr}`)
}

/** Low-level ABCI query via JSON-RPC POST. Returns decoded string or null. */
async function abciQuery(rpcUrl: string, path: string, data: string): Promise<string | null> {
    try {
        const b64Data = btoa(data)
        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "memba",
                method: "abci_query",
                params: { path, data: b64Data },
            }),
        })
        const json = await res.json()
        // VM queries return data in ResponseBase.Data (not Value)
        const value = json?.result?.response?.ResponseBase?.Data
        if (!value) return null
        return atob(value)
    } catch {
        return null
    }
}

/** Sanitize string for ABCI query (prevent injection). */
function sanitize(str: string): string {
    return str.replace(/[^a-zA-Z0-9_.#-]/g, "")
}

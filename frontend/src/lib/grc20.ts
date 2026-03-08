/**
 * GRC20 Token helpers for the gno.land/r/demo/defi/grc20factory realm.
 *
 * - ABCI query helpers (list tokens, get info, balance)
 * - MsgCall builder for factory functions
 * - Platform fee constants (2.5% to Samouraï Coop)
 * - v2.1a: $MEMBA/$MEMBATEST token helpers
 */

import { GRC20_FACTORY_PATH as _FACTORY_PATH, MEMBA_TOKEN } from "./config"

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
}

export interface AminoMsg {
    type: string
    value: Record<string, unknown>
}

// ── Adena DoContract Helpers ──────────────────────────────────

/**
 * Convert Amino MsgCall array to Adena's /vm.m_call format.
 *
 * ⚠️ Only handles vm/MsgCall messages. MsgAddPackage (/vm.m_addpkg)
 * must be converted separately (see channelTemplate.buildDeployChannelMsg).
 *
 * NOTE: MsgRun (/vm.m_run) was tested but can't modify external realm state,
 *       so all DAO calls must use MsgCall with crossing() functions.
 */
export function toAdenaMessages(msgs: AminoMsg[]) {
    return msgs.map((m) => {
        if (m.type !== "vm/MsgCall") {
            throw new Error(`toAdenaMessages only supports vm/MsgCall, got: ${m.type}`)
        }
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
    })
}

// ── Wallet RPC Security Guard ─────────────────────────────────

/**
 * Module-level state set by useAdena on connect/network-change.
 * Used to block DoContract calls through untrusted Adena RPCs.
 */
let _walletRpcUrl: string | null = null
let _walletRpcTrusted = false

/** Called by useAdena to sync the wallet's active RPC validation state. */
export function setWalletRpcContext(url: string | null, trusted: boolean) {
    _walletRpcUrl = url
    _walletRpcTrusted = trusted
}

/** Read current wallet RPC context (for UI components). */
export function getWalletRpcContext(): { url: string | null; trusted: boolean } {
    return { url: _walletRpcUrl, trusted: _walletRpcTrusted }
}

/**
 * Sign + broadcast via Adena DoContract.
 * Returns { hash, error } — throws if Adena is unavailable.
 *
 * SECURITY: Blocks all transactions if the wallet's RPC URL is untrusted.
 * The wallet RPC is validated by useAdena via Adena's GetNetwork() API.
 */
export async function doContractBroadcast(
    msgs: AminoMsg[],
    memo: string,
): Promise<{ hash: string }> {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adena = (window as any).adena
    if (!adena?.DoContract) {
        throw new Error("Adena wallet not available — please install or refresh the page")
    }

    const res = await adena.DoContract({
        messages: toAdenaMessages(msgs),
        gasFee: 1,
        gasWanted: 10000000,
        memo,
    })

    if (res.status === "failure") {
        const errMsg = res.message || res.data?.message || "Transaction failed"
        throw new Error(errMsg)
    }

    return { hash: res.data?.hash || "" }
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

    return {
        name: nameMatch?.[1] || symbol,
        symbol: nameMatch?.[2] || symbol,
        decimals: decimalsMatch ? parseInt(decimalsMatch[1], 10) : 6,
        totalSupply: supplyMatch?.[1] || "0",
        admin: adminMatch?.[1] || "",
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
 * Returns TWO messages if initialMint > 0 (create + fee transfer).
 */
export function buildCreateTokenMsgs(
    callerAddress: string,
    name: string,
    symbol: string,
    decimals: number,
    initialMint: bigint,
    faucetAmount: bigint,
): AminoMsg[] {
    const msgs: AminoMsg[] = [
        buildMsgCall("New", [
            name,
            symbol,
            String(decimals),
            String(initialMint),
            String(faucetAmount),
        ], callerAddress),
    ]

    // Add fee transfer if minting > 0
    if (initialMint > 0n) {
        const fee = calculateFee(initialMint)
        if (fee > 0n) {
            msgs.push(
                buildMsgCall("Transfer", [
                    symbol,
                    FEE_RECIPIENT,
                    String(fee),
                ], callerAddress),
            )
        }
    }

    return msgs
}

/**
 * Build MsgCall for grc20factory.NewWithAdmin() — creates token with specified admin (e.g. multisig).
 * Returns TWO messages if initialMint > 0 (create + fee transfer from admin).
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
    const msgs: AminoMsg[] = [
        buildMsgCall("NewWithAdmin", [
            name,
            symbol,
            String(decimals),
            String(initialMint),
            String(faucetAmount),
            adminAddress,
        ], callerAddress),
    ]

    // Add fee transfer if minting > 0
    if (initialMint > 0n) {
        const fee = calculateFee(initialMint)
        if (fee > 0n) {
            msgs.push(
                buildMsgCall("Transfer", [
                    symbol,
                    FEE_RECIPIENT,
                    String(fee),
                ], callerAddress),
            )
        }
    }

    return msgs
}

/**
 * Build MsgCall for grc20factory.Mint() — mints tokens (admin only).
 * Returns TWO messages: mint + 5% fee transfer.
 */
export function buildMintMsgs(
    callerAddress: string,
    symbol: string,
    to: string,
    amount: bigint,
): AminoMsg[] {
    const msgs: AminoMsg[] = [
        buildMsgCall("Mint", [symbol, to, String(amount)], callerAddress),
    ]

    if (amount > 0n) {
        const fee = calculateFee(amount)
        if (fee > 0n) {
            msgs.push(
                buildMsgCall("Transfer", [symbol, FEE_RECIPIENT, String(fee)], callerAddress),
            )
        }
    }

    return msgs
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

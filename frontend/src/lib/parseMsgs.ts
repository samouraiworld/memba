/** Parse Gno/Cosmos msgs_json into human-readable display data. */

export interface ParsedMsg {
    type: string
    label: string
    fields: { key: string; value: string; accent?: boolean }[]
    reviewError?: string
}

/** Display options for parseMsgs. */
export interface ParseMsgsOpts {
    /**
     * W2.4 (multisig confirmation rigor): render addresses in FULL. The
     * review-before-sign card must show the complete recipient — a truncated
     * `g1abc…xxyyzzxx` hides exactly the middle bytes an address-poisoning
     * attack forges.
     */
    full?: boolean
}

export interface ParsedFee {
    gas: string
    amount: string
    reviewError?: string
}

/**
 * Parse msgs_json string into structured display data.
 * Supports: bank/MsgSend, vm/MsgCall, vm/MsgAddPackage.
 * Unknown types fall back to raw JSON display.
 */
export function parseMsgs(msgsJson: string, opts?: ParseMsgsOpts): ParsedMsg[] {
    try {
        const msgs = JSON.parse(msgsJson)
        if (!Array.isArray(msgs)) return [fallback(msgsJson, opts?.full)]
        return msgs.map((m) => parseSingleMsg(m, opts?.full ? identity : truncate))
    } catch {
        return [fallback(msgsJson, opts?.full)]
    }
}

const identity = (addr: string): string => addr

function parseSingleMsg(msg: Record<string, unknown>, truncate: (addr: string) => string): ParsedMsg {
    const type = (msg.type as string) || (msg["@type"] as string) || "unknown"
    const value = (msg.value as Record<string, unknown>) || msg

    // ── bank/MsgSend ──────────────────────────────────────────
    if (type.includes("MsgSend") || type.includes("bank")) {
        const to = (value.to_address as string) || (value.toAddress as string) || "—"
        if (value.amount == null) throw new Error("Missing transfer amount")
        const coins = parseCoins(value.amount)
        return {
            type: "Send",
            label: `Send ${coins}`,
            fields: [
                { key: "Recipient", value: truncate(to) },
                { key: "Amount", value: coins, accent: true },
                ...(value.from_address ? [{ key: "From", value: truncate(value.from_address as string) }] : []),
            ],
        }
    }

    // ── vm/MsgCall ────────────────────────────────────────────
    if (type.includes("MsgCall") || type.includes("vm/m_call")) {
        const pkg = (value.pkg_path as string) || (value.pkgPath as string) || "—"
        const func = (value.func as string) || "—"
        const args = (value.args as string[]) || []
        const send = parseCoins(value.send)
        return {
            type: "Contract Call",
            label: `Call ${func}`,
            fields: [
                { key: "Package", value: pkg },
                { key: "Function", value: func, accent: true },
                ...(args.length > 0 ? [{ key: "Arguments", value: args.join(", ") }] : []),
                ...(send && send !== "—" ? [{ key: "Send", value: send, accent: true }] : []),
            ],
        }
    }

    // ── vm/MsgAddPackage ──────────────────────────────────────
    if (isAddPackage(type)) {
        const { path, depositCap } = readDeploy(value)
        const deposit = depositCap === null ? parseCoins(value.deposit) : "—"
        return {
            type: "Deploy Package",
            label: `Deploy realm ${path}`,
            fields: [
                { key: "Path", value: path },
                ...(depositCap !== null ? [{ key: "Storage deposit cap", value: depositCap, accent: true }] : []),
                ...(deposit && deposit !== "—" ? [{ key: "Deposit", value: deposit, accent: true }] : []),
            ],
        }
    }

    // ── Fallback ──────────────────────────────────────────────
    return {
        type: type.split("/").pop() || type,
        label: type,
        fields: [{ key: "Raw", value: JSON.stringify(value, null, 2) }],
    }
}

/** Deploy message types: `/vm.m_addpkg` (sent by the app), `vm/m_addpkg`, `vm/MsgAddPackage`. */
function isAddPackage(type: string): boolean {
    return type.includes("MsgAddPackage") || /(^|[/.])m_addpkg$/.test(type)
}

function readDeploy(value: Record<string, unknown>): { path: string; depositCap: string | null } {
    const pkg = value.package as Record<string, unknown> | undefined
    const path = (pkg?.path as string) || (value.pkg_path as string) || "—"
    const cap = value.max_deposit
    return { path, depositCap: cap == null || cap === "" ? null : parseCoins(cap) }
}

/** Path and storage deposit cap of a realm deploy message, or null for any other message. */
export function deployEffect(msg: { type?: unknown; value?: unknown }): { path: string; depositCap: string | null } | null {
    if (typeof msg.type !== "string" || !isAddPackage(msg.type)) return null
    try {
        return readDeploy((msg.value as Record<string, unknown>) ?? {})
    } catch {
        return { path: "—", depositCap: null }
    }
}

/** Parse fee_json string. */
export function parseFee(feeJson: string): ParsedFee {
    try {
        const fee = JSON.parse(feeJson)
        const gas = fee.gas || fee.gas_wanted || "—"
        // Never choose one of two conflicting monetary representations.
        if (fee.gas_fee !== undefined && fee.amount !== undefined) throw new Error("Ambiguous fee")
        const coins = fee.gas_fee !== undefined ? fee.gas_fee : fee.amount
        if (coins == null) throw new Error("Missing fee")
        const amount = parseCoins(coins)
        return { gas: String(gas), amount }
    } catch {
        return { gas: "—", amount: "—", reviewError: "Cannot safely display the transaction fee. Inspect the original transaction before signing." }
    }
}

/** Native coin strings and legacy arrays, without floating-point rounding. */
function parseCoins(coins: unknown): string {
    if (coins == null) return "—" // absent optional VM send/deposit
    if (coins === "") return "0" // canonical native empty Coins
    if (typeof coins === "string") {
        return coins.split(",").map(coin => {
            const match = /^([0-9]+)([a-z/][a-z0-9_.:/-]{2,})$/.exec(coin)
            if (!match) throw new Error("Unsupported native coin")
            return formatCoin(match[1], match[2])
        }).join(" + ")
    }
    if (!Array.isArray(coins)) throw new Error("Unsupported coin representation")
    if (coins.length === 0) return "0"

    return coins
        .map((c: { amount?: unknown; denom?: unknown }) => formatCoin(c.amount, c.denom))
        .join(" + ")
}

function formatCoin(amount: unknown, denomination: unknown): string {
    if (typeof amount !== "string" || !/^[0-9]+$/.test(amount) || typeof denomination !== "string" || !/^[a-zA-Z/][a-zA-Z0-9_.:/-]{2,}$/.test(denomination)) throw new Error("Unsupported coin")
    const raw = amount.replace(/^0+(?=\d)/, "")
    if (denomination === "ugnot") {
        const padded = raw.padStart(7, "0")
        const whole = padded.slice(0, -6)
        const frac = padded.slice(-6).replace(/0+$/, "")
        return `${whole}${frac ? `.${frac}` : ""} GNOT`
    }
    // Preserve non-native denomination identity and every integer digit.
    return `${raw.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${denomination}`
}

function truncate(addr: string): string {
    return addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-8)}` : addr
}

function fallback(raw: string, full = false): ParsedMsg {
    return {
        type: "Unknown",
        label: "Transaction",
        fields: [{ key: "Raw Data", value: full ? raw : raw.slice(0, 500) }],
        reviewError: "Cannot safely display transaction amounts. Inspect the original transaction before signing.",
    }
}

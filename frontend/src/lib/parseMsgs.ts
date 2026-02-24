/** Parse Gno/Cosmos msgs_json into human-readable display data. */

export interface ParsedMsg {
    type: string
    label: string
    fields: { key: string; value: string; accent?: boolean }[]
}

export interface ParsedFee {
    gas: string
    amount: string
}

/**
 * Parse msgs_json string into structured display data.
 * Supports: bank/MsgSend, vm/MsgCall, vm/MsgAddPackage.
 * Unknown types fall back to raw JSON display.
 */
export function parseMsgs(msgsJson: string): ParsedMsg[] {
    try {
        const msgs = JSON.parse(msgsJson)
        if (!Array.isArray(msgs)) return [fallback(msgsJson)]
        return msgs.map(parseSingleMsg)
    } catch {
        return [fallback(msgsJson)]
    }
}

function parseSingleMsg(msg: Record<string, unknown>): ParsedMsg {
    const type = (msg.type as string) || (msg["@type"] as string) || "unknown"
    const value = (msg.value as Record<string, unknown>) || msg

    // ── bank/MsgSend ──────────────────────────────────────────
    if (type.includes("MsgSend") || type.includes("bank")) {
        const to = (value.to_address as string) || (value.toAddress as string) || "—"
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
    if (type.includes("MsgAddPackage") || type.includes("vm/m_addpkg")) {
        const pkg = (value.package as Record<string, unknown>)
        const path = pkg?.path as string || (value.pkg_path as string) || "—"
        const deposit = parseCoins(value.deposit)
        return {
            type: "Deploy Package",
            label: `Deploy ${path.split("/").pop() || path}`,
            fields: [
                { key: "Path", value: path },
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

/** Parse fee_json string. */
export function parseFee(feeJson: string): ParsedFee {
    try {
        const fee = JSON.parse(feeJson)
        const gas = fee.gas || fee.gas_wanted || "—"
        const amount = parseCoins(fee.amount)
        return { gas: String(gas), amount }
    } catch {
        return { gas: "—", amount: "—" }
    }
}

/** Parse Cosmos coin array → "1.5 GNOT" or "1,000,000 ugnot". */
function parseCoins(coins: unknown): string {
    if (!coins) return "—"
    if (!Array.isArray(coins)) return "—"
    if (coins.length === 0) return "0"

    return coins
        .map((c: { amount?: string; denom?: string }) => {
            const raw = c.amount || "0"
            const denom = (c.denom || "").toUpperCase()

            // Convert micro-units to display units.
            if (denom === "UGNOT" && raw.length >= 6) {
                const whole = raw.slice(0, -6) || "0"
                const frac = raw.slice(-6).replace(/0+$/, "")
                return frac ? `${whole}.${frac} GNOT` : `${whole} GNOT`
            }

            return `${Number(raw).toLocaleString()} ${denom || "units"}`
        })
        .join(" + ")
}

function truncate(addr: string): string {
    return addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-8)}` : addr
}

function fallback(raw: string): ParsedMsg {
    return {
        type: "Unknown",
        label: "Transaction",
        fields: [{ key: "Raw Data", value: raw.slice(0, 500) }],
    }
}

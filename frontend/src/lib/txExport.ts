/**
 * TX History CSV Export — client-side CSV generation and download.
 *
 * Converts transaction data from the Transactions RPC into a downloadable CSV file.
 * No backend changes needed — reuses existing RPC responses.
 */

// Minimal transaction shape (matches proto response)
export interface ExportableTransaction {
    id: number
    createdAt: string
    type: string
    multisigAddress: string
    creatorAddress: string
    memo: string
    finalHash: string
    threshold: number
    signatures: { userAddress: string }[]
    msgsJson: string
}

/**
 * Escape a CSV cell value — handles commas, quotes, and formula injection.
 * OWASP: prefix dangerous characters (=, +, -, @, \t, \r) with a single quote.
 */
function escapeCSV(value: string): string {
    const s = String(value ?? "")
    // Formula injection prevention
    if (/^[=+\-@\t\r]/.test(s)) {
        return `"'${s.replace(/"/g, '""')}"`
    }
    // Escape if contains comma, quote, or newline
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`
    }
    return s
}

/**
 * Parse msgs_json into a human-readable summary.
 * E.g. "MsgSend: 100000ugnot → g1abc..." or "MsgCall: realm.Function"
 */
function summarizeMessages(msgsJson: string): string {
    try {
        const msgs = JSON.parse(msgsJson)
        if (!Array.isArray(msgs)) return msgsJson
        return msgs.map((msg: Record<string, unknown>) => {
            const type = String(msg["@type"] || msg.type || "unknown")
            const shortType = type.split(".").pop() || type
            if (shortType === "MsgSend" || shortType === "bank.MsgSend") {
                return `Send ${msg.amount || ""} → ${msg.to_address || ""}`
            }
            if (shortType === "MsgCall" || shortType === "vm.MsgCall") {
                return `Call ${msg.pkg_path || ""}:${msg.func || ""}`
            }
            if (shortType === "MsgAddPackage" || shortType === "vm.MsgAddPackage") {
                return `Deploy ${(msg.package as Record<string, unknown>)?.path || ""}`
            }
            return shortType
        }).join("; ")
    } catch {
        return ""
    }
}

const CSV_HEADERS = [
    "ID",
    "Date",
    "Type",
    "Status",
    "Multisig",
    "Creator",
    "Memo",
    "Signatures",
    "TX Hash",
    "Messages",
]

/**
 * Generate and download a CSV file from transaction data.
 * Uses Blob + invisible <a> click for browser-native download.
 */
export function exportTransactionsCSV(
    txs: ExportableTransaction[],
    multisigShort?: string,
): void {
    if (txs.length === 0) return

    const rows = txs.map((tx) => [
        escapeCSV(String(tx.id)),
        escapeCSV(tx.createdAt),
        escapeCSV(tx.type || "send"),
        escapeCSV(tx.finalHash ? "Executed" : "Pending"),
        escapeCSV(tx.multisigAddress),
        escapeCSV(tx.creatorAddress),
        escapeCSV(tx.memo),
        escapeCSV(`${tx.signatures.length}/${tx.threshold}`),
        escapeCSV(tx.finalHash || ""),
        escapeCSV(summarizeMessages(tx.msgsJson)),
    ])

    const csv = [
        CSV_HEADERS.join(","),
        ...rows.map((row) => row.join(",")),
    ].join("\n")

    // Download via Blob
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const addr = multisigShort || "all"
    const filename = `memba_tx_${addr}_${date}.csv`

    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.style.display = "none"
    document.body.appendChild(a)
    a.click()

    // Cleanup
    setTimeout(() => {
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }, 100)
}

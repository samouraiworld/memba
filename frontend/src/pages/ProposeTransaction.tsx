import { useState } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import { GNO_CHAIN_ID, GNO_RPC_URL, UGNOT_PER_GNOT } from "../lib/config"
import type { LayoutContext } from "../types/layout"

type TxType = "send" | "call"

export function ProposeTransaction() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNavigate()
    const { auth } = useOutletContext<LayoutContext>()
    const [txType, setTxType] = useState<TxType>("send")

    // Send fields
    const [recipient, setRecipient] = useState("")
    const [amount, setAmount] = useState("")

    // Call fields
    const [pkgPath, setPkgPath] = useState("")
    const [funcName, setFuncName] = useState("")
    const [args, setArgs] = useState("")
    const [sendAmount, setSendAmount] = useState("")

    // Common fields
    const [memo, setMemo] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handlePropose = async () => {
        if (!address) return
        if (!auth.isAuthenticated || !auth.token) {
            setError("Connect your wallet first")
            return
        }

        let msgsJson: string
        let type: string

        if (txType === "send") {
            const trimmedRecipient = recipient.trim()
            if (!trimmedRecipient || !amount.trim()) {
                setError("Recipient and amount are required")
                return
            }
            if (!/^g(no)?1[a-z0-9]{38,}$/.test(trimmedRecipient)) {
                setError("Invalid recipient address format")
                return
            }
            const gnotAmount = parseFloat(amount)
            if (isNaN(gnotAmount) || gnotAmount <= 0) {
                setError("Amount must be greater than 0")
                return
            }
            const ugnotAmount = Math.round(gnotAmount * UGNOT_PER_GNOT)
            if (ugnotAmount <= 0) {
                setError("Amount too small")
                return
            }

            msgsJson = JSON.stringify([{
                type: "bank/MsgSend",
                value: {
                    from_address: address,
                    to_address: trimmedRecipient,
                    amount: [{ denom: "ugnot", amount: String(ugnotAmount) }],
                },
            }])
            type = "send"
        } else {
            const trimmedPkg = pkgPath.trim()
            const trimmedFunc = funcName.trim()
            if (!trimmedPkg || !trimmedFunc) {
                setError("Package path and function name are required")
                return
            }
            if (!trimmedPkg.startsWith("gno.land/")) {
                setError("Package path must start with gno.land/")
                return
            }

            // Parse args (comma-separated)
            const argsArray = args.trim()
                ? args.split(",").map(a => a.trim()).filter(Boolean)
                : []

            // Parse send amount (optional GNOT to send with call)
            let sendCoins: string | undefined
            if (sendAmount.trim()) {
                const sendGnot = parseFloat(sendAmount)
                if (isNaN(sendGnot) || sendGnot < 0) {
                    setError("Invalid send amount")
                    return
                }
                if (sendGnot > 0) {
                    sendCoins = `${Math.round(sendGnot * UGNOT_PER_GNOT)}ugnot`
                }
            }

            msgsJson = JSON.stringify([{
                type: "vm/MsgCall",
                value: {
                    caller: address,
                    send: sendCoins || "",
                    pkg_path: trimmedPkg,
                    func: trimmedFunc,
                    args: argsArray,
                },
            }])
            type = "call"
        }

        setLoading(true)
        setError(null)

        try {
            const accountInfo = await fetchAccountInfo(address)

            const feeJson = JSON.stringify({
                amount: [{ denom: "ugnot", amount: "10000" }],
                gas: txType === "call" ? "2000000" : "100000",
            })

            const res = await api.createTransaction({
                authToken: auth.token,
                multisigAddress: address,
                chainId: GNO_CHAIN_ID,
                msgsJson,
                feeJson,
                accountNumber: accountInfo.accountNumber,
                sequence: accountInfo.sequence,
                memo: memo.trim(),
                type,
            })

            navigate(`/tx/${res.transactionId}?ms=${address}&chain=${GNO_CHAIN_ID}`)
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to create transaction"
            setError(msg)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <div>
                <button onClick={() => navigate(`/multisig/${address}`)} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back to Multisig
                </button>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Propose Transaction</h2>
                <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace", wordBreak: "break-all" }}>
                    From: {address}
                </p>
            </div>

            {!auth.isAuthenticated && (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 32, textAlign: "center" }}>
                    <p style={{ color: "#666", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        Connect your wallet to propose a transaction
                    </p>
                </div>
            )}

            {/* TX Type tabs */}
            <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #222" }}>
                <button
                    onClick={() => setTxType("send")}
                    style={{
                        padding: "10px 20px", background: "none", border: "none",
                        borderBottom: txType === "send" ? "2px solid #00d4aa" : "2px solid transparent",
                        color: txType === "send" ? "#00d4aa" : "#666",
                        fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                        cursor: "pointer", transition: "all 0.15s",
                    }}
                >
                    Send GNOT
                </button>
                <button
                    onClick={() => setTxType("call")}
                    style={{
                        padding: "10px 20px", background: "none", border: "none",
                        borderBottom: txType === "call" ? "2px solid #00d4aa" : "2px solid transparent",
                        color: txType === "call" ? "#00d4aa" : "#666",
                        fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                        cursor: "pointer", transition: "all 0.15s",
                    }}
                >
                    Contract Call
                </button>
            </div>

            {/* Send GNOT form */}
            {txType === "send" && (
                <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <label className="k-label">Recipient Address</label>
                    <input
                        type="text"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        placeholder="g1recipient..."
                        disabled={loading}
                        style={formInputStyle(loading)}
                    />
                    <label className="k-label">Amount (GNOT)</label>
                    <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="1.0"
                        min="0"
                        step="0.000001"
                        disabled={loading}
                        style={formInputStyle(loading)}
                    />
                </div>
            )}

            {/* Contract Call form */}
            {txType === "call" && (
                <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <label className="k-label">Package Path</label>
                    <input
                        type="text"
                        value={pkgPath}
                        onChange={(e) => setPkgPath(e.target.value)}
                        placeholder="gno.land/r/demo/boards"
                        disabled={loading}
                        style={formInputStyle(loading)}
                    />
                    <label className="k-label">Function Name</label>
                    <input
                        type="text"
                        value={funcName}
                        onChange={(e) => setFuncName(e.target.value)}
                        placeholder="CreateThread"
                        disabled={loading}
                        style={formInputStyle(loading)}
                    />
                    <label className="k-label">Arguments (comma-separated)</label>
                    <input
                        type="text"
                        value={args}
                        onChange={(e) => setArgs(e.target.value)}
                        placeholder="arg1, arg2, arg3"
                        disabled={loading}
                        style={formInputStyle(loading)}
                    />
                    <label className="k-label">Send Amount (optional GNOT)</label>
                    <input
                        type="number"
                        value={sendAmount}
                        onChange={(e) => setSendAmount(e.target.value)}
                        placeholder="0"
                        min="0"
                        step="0.000001"
                        disabled={loading}
                        style={formInputStyle(loading)}
                    />
                    <p style={{ color: "#555", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                        Optional GNOT to send with the contract call (e.g. for paid functions)
                    </p>
                </div>
            )}

            {/* Memo */}
            <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <label className="k-label">Memo (optional)</label>
                <input
                    type="text"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="Optional memo..."
                    maxLength={256}
                    disabled={loading}
                    style={formInputStyle(loading)}
                />
            </div>

            {/* Submit */}
            <div style={{ display: "flex", gap: 12 }}>
                <button
                    className="k-btn-primary"
                    onClick={handlePropose}
                    disabled={loading || !auth.isAuthenticated}
                    style={{ opacity: !loading && auth.isAuthenticated ? 1 : 0.5 }}
                >
                    {loading ? "Proposing..." : txType === "send" ? "Propose Send" : "Propose Call"}
                </button>
                <button className="k-btn-secondary" onClick={() => navigate(`/multisig/${address}`)}>
                    Cancel
                </button>
            </div>

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Helpers ────────────────────────────────────────────────

function formInputStyle(loading: boolean): React.CSSProperties {
    return {
        width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
        background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
        fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
        opacity: loading ? 0.5 : 1,
    }
}

async function fetchAccountInfo(address: string): Promise<{ accountNumber: number; sequence: number }> {
    // S3: Validate address format before ABCI query to prevent URL injection
    if (!/^g(no)?1[a-z0-9]{38,}$/.test(address)) {
        return { accountNumber: 0, sequence: 0 }
    }
    try {
        const url = `${GNO_RPC_URL}/abci_query?path=%22auth/accounts/${address}%22`
        const res = await fetch(url)
        const json = await res.json()

        const rawValue = json?.result?.response?.ResponseBase?.Value
        if (!rawValue) return { accountNumber: 0, sequence: 0 }

        const decoded = atob(rawValue)
        const data = JSON.parse(decoded)

        const account = data?.value || data
        return {
            accountNumber: parseInt(account.account_number || account.AccountNumber || "0", 10),
            sequence: parseInt(account.sequence || account.Sequence || "0", 10),
        }
    } catch {
        return { accountNumber: 0, sequence: 0 }
    }
}

import { useState } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import type { LayoutContext } from "../types/layout"

const GNO_CHAIN_ID = import.meta.env.VITE_GNO_CHAIN_ID || "test11"
const GNO_RPC_URL = import.meta.env.VITE_GNO_RPC_URL || "https://rpc.test11.testnets.gno.land:443"
const UGNOT_PER_GNOT = 1_000_000

export function ProposeTransaction() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNavigate()
    const { auth } = useOutletContext<LayoutContext>()
    const [recipient, setRecipient] = useState("")
    const [amount, setAmount] = useState("")
    const [memo, setMemo] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handlePropose = async () => {
        if (!recipient.trim() || !amount.trim() || !address) return
        if (!auth.isAuthenticated || !auth.token) {
            setError("Connect your wallet first")
            return
        }

        // Validate recipient address
        const trimmedRecipient = recipient.trim()
        if (!/^g(no)?1[a-z0-9]{38,}$/.test(trimmedRecipient)) {
            setError("Invalid recipient address format")
            return
        }

        // Validate amount
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

        setLoading(true)
        setError(null)

        try {
            // Fetch account number + sequence from chain
            const accountInfo = await fetchAccountInfo(address)

            // Build MsgSend
            const msgsJson = JSON.stringify([{
                type: "bank/MsgSend",
                value: {
                    from_address: address,
                    to_address: trimmedRecipient,
                    amount: [{ denom: "ugnot", amount: String(ugnotAmount) }],
                },
            }])

            // Build fee
            const feeJson = JSON.stringify({
                amount: [{ denom: "ugnot", amount: "1000000" }],
                gas: "100000",
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
                type: "send",
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

            <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                    <label className="k-label" style={{ display: "block", marginBottom: 8 }}>Recipient Address</label>
                    <input
                        type="text"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        placeholder="g1recipient..."
                        disabled={loading}
                        style={{
                            width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
                            background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                            fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
                            opacity: loading ? 0.5 : 1,
                        }}
                    />
                </div>
                <div>
                    <label className="k-label" style={{ display: "block", marginBottom: 8 }}>Amount (GNOT)</label>
                    <input
                        type="number"
                        step="0.000001"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.0"
                        disabled={loading}
                        style={{
                            width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
                            background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                            fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
                            opacity: loading ? 0.5 : 1,
                        }}
                    />
                </div>
                <div>
                    <label className="k-label" style={{ display: "block", marginBottom: 8 }}>Memo (optional)</label>
                    <input
                        type="text"
                        value={memo}
                        onChange={(e) => setMemo(e.target.value)}
                        placeholder="Payment for..."
                        disabled={loading}
                        maxLength={256}
                        style={{
                            width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
                            background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                            fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
                            opacity: loading ? 0.5 : 1,
                        }}
                    />
                </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
                <button
                    className="k-btn-primary"
                    onClick={handlePropose}
                    disabled={!recipient.trim() || !amount.trim() || loading || !auth.isAuthenticated}
                    style={{ opacity: recipient.trim() && amount.trim() && auth.isAuthenticated && !loading ? 1 : 0.5 }}
                >
                    {loading ? "Submitting..." : "Submit Proposal"}
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

async function fetchAccountInfo(address: string): Promise<{ accountNumber: number; sequence: number }> {
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
        // If we can't fetch, use defaults — backend will still accept
        return { accountNumber: 0, sequence: 0 }
    }
}

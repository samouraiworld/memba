import { useState } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import type { LayoutContext } from "../types/layout"

const GNO_CHAIN_ID = import.meta.env.VITE_GNO_CHAIN_ID || "test11"

export function ImportMultisig() {
    const navigate = useNavigate()
    const { auth } = useOutletContext<LayoutContext>()
    const [address, setAddress] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleImport = async () => {
        const trimmed = address.trim()
        if (!trimmed) return
        if (!auth.isAuthenticated || !auth.token) {
            setError("Connect your wallet first")
            return
        }

        // Validate address format
        if (!/^g(no)?1[a-z0-9]{38,}$/.test(trimmed)) {
            setError("Invalid address format. Expected: g1... or gno1...")
            return
        }

        setLoading(true)
        setError(null)

        try {
            // Step 1: Verify multisig exists and get its pubkey
            const infoRes = await api.multisigInfo({
                authToken: auth.token,
                multisigAddress: trimmed,
                chainId: GNO_CHAIN_ID,
            })

            const multisig = infoRes.multisig
            if (!multisig || !multisig.pubkeyJson) {
                setError("Multisig found but missing pubkey data")
                return
            }

            // Step 2: Join the multisig
            const joinRes = await api.createOrJoinMultisig({
                authToken: auth.token,
                chainId: GNO_CHAIN_ID,
                multisigPubkeyJson: multisig.pubkeyJson,
                name: "",
                bech32Prefix: "g",
            })

            if (joinRes.joined || joinRes.created) {
                navigate(`/multisig/${joinRes.multisigAddress}`)
            } else {
                // Already a member — navigate anyway
                navigate(`/multisig/${trimmed}`)
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Import failed"
            if (msg.includes("not_found") || msg.includes("NOT_FOUND") || msg.includes("not found")) {
                setError("Multisig not found. It must be registered by a member first.")
            } else if (msg.includes("permission_denied") || msg.includes("PERMISSION_DENIED")) {
                setError("You are not a member of this multisig.")
            } else {
                setError(msg)
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <div>
                <button onClick={() => navigate("/")} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back to Dashboard
                </button>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Import Multisig</h2>
                <p style={{ color: "#999", fontSize: 14, marginTop: 4 }}>
                    Import an existing multisig wallet by its on-chain address
                </p>
            </div>

            {!auth.isAuthenticated && (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 32, textAlign: "center" }}>
                    <p style={{ color: "#666", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        Connect your wallet to import a multisig
                    </p>
                </div>
            )}

            <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <label className="k-label">Multisig Address</label>
                <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="g1abc123..."
                    disabled={loading}
                    style={{
                        width: "100%", height: 44, padding: "0 16px", borderRadius: 8,
                        background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                        fontFamily: "JetBrains Mono, monospace", fontSize: 14, outline: "none",
                        opacity: loading ? 0.5 : 1,
                    }}
                />
                <p style={{ color: "#666", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    Paste the multisig wallet address from the Gno chain
                </p>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
                <button
                    className="k-btn-primary"
                    onClick={handleImport}
                    disabled={!address.trim() || loading || !auth.isAuthenticated}
                    style={{ opacity: address.trim() && auth.isAuthenticated && !loading ? 1 : 0.5 }}
                >
                    {loading ? "Importing..." : "Import & Join"}
                </button>
                <button className="k-btn-secondary" onClick={() => navigate("/")}>
                    Cancel
                </button>
            </div>

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}


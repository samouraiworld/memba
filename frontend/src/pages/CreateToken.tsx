import { useState, useEffect } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import { GNO_CHAIN_ID } from "../lib/config"
import { fetchAccountInfo } from "../lib/account"
import {
    buildCreateTokenMsgs,
    buildCreateTokenWithAdminMsgs,
    calculateFee,
    feeDisclosure,
    doContractBroadcast,
    GRC20_FACTORY_PATH,
} from "../lib/grc20"
import type { LayoutContext } from "../types/layout"

type AdminMode = "self" | "multisig"

export function CreateToken() {
    const navigate = useNavigate()
    const { auth, adena } = useOutletContext<LayoutContext>()

    // Form fields
    const [name, setName] = useState("")
    const [symbol, setSymbol] = useState("")
    const [decimals, setDecimals] = useState("6")
    const [initialMint, setInitialMint] = useState("")
    const [faucetAmount, setFaucetAmount] = useState("0")
    const [adminMode, setAdminMode] = useState<AdminMode>("self")
    const [selectedMultisig, setSelectedMultisig] = useState("")
    const [multisigs, setMultisigs] = useState<{ address: string; name: string }[]>([])
    const [memo, setMemo] = useState("")

    // State
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [txHash, setTxHash] = useState<string | null>(null)
    const [createdSymbol, setCreatedSymbol] = useState<string | null>(null)

    // Fetch user multisigs for admin selector
    useEffect(() => {
        if (!auth.isAuthenticated || !auth.token) return
            ; (async () => {
                try {
                    const res = await api.multisigs({ authToken: auth.token ?? undefined, chainId: GNO_CHAIN_ID })
                    setMultisigs(
                        res.multisigs.map((m) => ({
                            address: m.address,
                            name: m.name || m.address,
                        })),
                    )
                } catch { /* ignore */ }
            })()
    }, [auth.isAuthenticated, auth.token])

    const parsedMint = initialMint.trim() ? BigInt(initialMint.trim()) : 0n
    const fee = parsedMint > 0n ? calculateFee(parsedMint) : 0n

    const handleCreate = async () => {
        if (!auth.isAuthenticated || !auth.token) {
            setError("Connect your wallet first")
            return
        }

        // Validation
        const trimName = name.trim()
        const trimSymbol = symbol.trim().toUpperCase()
        if (!trimName) { setError("Token name is required"); return }
        if (trimName.length > 64) { setError("Token name must be 64 characters or less"); return }
        if (!trimSymbol) { setError("Symbol is required"); return }
        if (!/^[A-Z0-9]{1,10}$/.test(trimSymbol)) { setError("Symbol must be 1-10 uppercase letters/digits"); return }
        const dec = parseInt(decimals, 10)
        if (isNaN(dec) || dec < 0 || dec > 18) { setError("Decimals must be 0-18"); return }
        if (parsedMint < 0n) { setError("Initial mint must be ≥ 0"); return }
        const faucet = BigInt(faucetAmount.trim() || "0")
        if (faucet < 0n) { setError("Faucet amount must be ≥ 0"); return }

        if (adminMode === "multisig" && !selectedMultisig) {
            setError("Select a multisig wallet")
            return
        }

        setLoading(true)
        setError(null)
        setSuccess(null)

        try {
            const callerAddress = adena.address || ""

            if (adminMode === "multisig") {
                // ── Multisig admin: create TX proposal ──
                const msgs = buildCreateTokenWithAdminMsgs(
                    callerAddress, trimName, trimSymbol, dec,
                    parsedMint, faucet, selectedMultisig,
                )

                // Fetch account info for multisig
                const acctInfo = await fetchAccountInfo(selectedMultisig)

                await api.createTransaction({
                    authToken: auth.token ?? undefined,
                    multisigAddress: selectedMultisig,
                    chainId: GNO_CHAIN_ID,
                    msgsJson: JSON.stringify(msgs),
                    feeJson: JSON.stringify({ gas_wanted: "200000", gas_fee: "10000ugnot" }),
                    memo: memo || `Create GRC20: ${trimSymbol}`,
                    accountNumber: acctInfo.accountNumber,
                    sequence: acctInfo.sequence,
                    type: "call",
                })

                setSuccess(`Token proposal created! Requires multisig approval.`)
                setTimeout(() => navigate(`/multisig/${selectedMultisig}`), 2000)
            } else {
                // ── Single user: sign + broadcast via Adena DoContract ──
                const msgs = buildCreateTokenMsgs(
                    callerAddress, trimName, trimSymbol, dec,
                    parsedMint, faucet,
                )

                const { hash } = await doContractBroadcast(
                    msgs,
                    memo || `Create GRC20: ${trimSymbol}`,
                )

                setTxHash(hash)
                setCreatedSymbol(trimSymbol)
                setSuccess(`Token ${trimSymbol} created successfully!`)
                window.scrollTo({ top: 0, behavior: "smooth" })
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create token")
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
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Create a Token</h2>
                <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                    Deploy a GRC20 token on {GNO_CHAIN_ID} via grc20factory
                </p>
            </div>

            {!auth.isAuthenticated && (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 32, textAlign: "center" }}>
                    <p style={{ color: "#666", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        Connect your wallet to create a token
                    </p>
                </div>
            )}

            {success && txHash && createdSymbol && (
                <div className="k-card" style={{ padding: 32, textAlign: "center", borderColor: "rgba(0,212,170,0.2)" }}>
                    {/* Animated checkmark */}
                    <div style={{
                        width: 64, height: 64, borderRadius: "50%",
                        background: "rgba(0,212,170,0.1)", border: "2px solid #00d4aa",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        margin: "0 auto 16px", animation: "scaleIn 0.3s ease-out",
                    }}>
                        <span style={{ fontSize: 28, color: "#00d4aa" }}>✓</span>
                    </div>
                    <h2 style={{ fontSize: 20, fontWeight: 700, color: "#00d4aa", marginBottom: 8 }}>
                        {success}
                    </h2>
                    <p style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace", marginBottom: 20 }}>
                        TX: <a
                            href={`https://gnoscan.io/tx/${txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#00d4aa", textDecoration: "none" }}
                        >
                            {txHash.slice(0, 20)}...
                        </a>
                    </p>
                    <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                        <button
                            className="k-btn-primary"
                            onClick={() => navigate(`/tokens/${createdSymbol}`)}
                            style={{ padding: "10px 20px", fontSize: 12 }}
                        >
                            🪙 View Token →
                        </button>
                        <button
                            className="k-btn-secondary"
                            onClick={() => {
                                setSuccess(null); setTxHash(null); setCreatedSymbol(null)
                                setName(""); setSymbol(""); setInitialMint(""); setFaucetAmount("0"); setMemo("")
                            }}
                            style={{ padding: "10px 20px", fontSize: 12 }}
                        >
                            ← Create Another
                        </button>
                    </div>
                    <style>{`@keyframes scaleIn { from { transform: scale(0); opacity: 0 } to { transform: scale(1); opacity: 1 } }`}</style>
                </div>
            )}

            {success && !txHash && (
                <div style={{ padding: "12px 16px", background: "rgba(0,212,170,0.08)", borderRadius: 8, border: "1px solid rgba(0,212,170,0.2)", color: "#00d4aa", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                    ✓ {success}
                </div>
            )}

            {/* Admin mode tabs */}
            <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #222" }}>
                <button
                    onClick={() => setAdminMode("self")}
                    style={{
                        padding: "10px 20px", background: "none", border: "none",
                        borderBottom: adminMode === "self" ? "2px solid #00d4aa" : "2px solid transparent",
                        color: adminMode === "self" ? "#00d4aa" : "#666",
                        fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                        cursor: "pointer", transition: "all 0.15s",
                    }}
                >
                    My Wallet
                </button>
                <button
                    onClick={() => setAdminMode("multisig")}
                    style={{
                        padding: "10px 20px", background: "none", border: "none",
                        borderBottom: adminMode === "multisig" ? "2px solid #00d4aa" : "2px solid transparent",
                        color: adminMode === "multisig" ? "#00d4aa" : "#666",
                        fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                        cursor: "pointer", transition: "all 0.15s",
                    }}
                >
                    Multisig Admin
                </button>
            </div>

            {/* Form */}
            <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 20, padding: 24 }}>
                {/* Token Name */}
                <div>
                    <label style={labelStyle}>Token Name</label>
                    <input
                        type="text" value={name} onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Your Token Name" maxLength={64}
                        style={inputStyle(loading)} disabled={loading}
                    />
                </div>

                {/* Symbol */}
                <div>
                    <label style={labelStyle}>Symbol</label>
                    <input
                        type="text" value={symbol}
                        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                        placeholder="e.g. $YTK" maxLength={10}
                        style={inputStyle(loading)} disabled={loading}
                    />
                    <p style={hintStyle}>1-10 uppercase letters/digits. Must be unique on-chain.</p>
                </div>

                {/* Decimals */}
                <div>
                    <label style={labelStyle}>Decimals</label>
                    <input
                        type="number" value={decimals}
                        onChange={(e) => setDecimals(e.target.value)}
                        min={0} max={18}
                        style={inputStyle(loading)} disabled={loading}
                    />
                    <p style={hintStyle}>Precision (6 = 1 token = 1,000,000 smallest unit)</p>
                </div>

                {/* Initial Mint */}
                <div>
                    <label style={labelStyle}>Initial Mint (smallest unit)</label>
                    <input
                        type="text" value={initialMint}
                        onChange={(e) => setInitialMint(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="e.g. 1000000 (optional)"
                        style={inputStyle(loading)} disabled={loading}
                    />
                    <p style={hintStyle}>Tokens minted to the admin on creation. Leave empty for 0.</p>
                </div>

                {/* Faucet Amount */}
                <div>
                    <label style={labelStyle}>Faucet Amount (per request)</label>
                    <input
                        type="text" value={faucetAmount}
                        onChange={(e) => setFaucetAmount(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="0 = disabled"
                        style={inputStyle(loading)} disabled={loading}
                    />
                    <p style={hintStyle}>Public faucet amount. 0 = faucet disabled.</p>
                </div>

                {/* Multisig selector */}
                {adminMode === "multisig" && (
                    <div>
                        <label style={labelStyle}>Multisig Wallet (admin)</label>
                        {multisigs.length === 0 ? (
                            <p style={{ ...hintStyle, color: "#f5a623" }}>
                                No multisigs found. Import or create one first.
                            </p>
                        ) : (
                            <select
                                value={selectedMultisig}
                                onChange={(e) => setSelectedMultisig(e.target.value)}
                                style={{ ...inputStyle(loading), cursor: "pointer" }}
                                disabled={loading}
                            >
                                <option value="">Select multisig...</option>
                                {multisigs.map((m) => (
                                    <option key={m.address} value={m.address}>
                                        {m.name} ({m.address.slice(0, 10)}...{m.address.slice(-6)})
                                    </option>
                                ))}
                            </select>
                        )}
                        <p style={hintStyle}>
                            The multisig will be the token admin. Mint/Burn will require multisig approval.
                        </p>
                    </div>
                )}

                {/* Memo */}
                <div>
                    <label style={labelStyle}>Memo (optional)</label>
                    <input
                        type="text" value={memo}
                        onChange={(e) => setMemo(e.target.value)}
                        placeholder="Optional memo" maxLength={256}
                        style={inputStyle(loading)} disabled={loading}
                    />
                </div>
            </div>

            {/* Fee disclosure */}
            {parsedMint > 0n && (
                <div style={{
                    padding: "14px 18px", borderRadius: 8,
                    background: "rgba(245,166,35,0.06)", border: "1px solid rgba(245,166,35,0.15)",
                    fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#f5a623",
                }}>
                    💰 {feeDisclosure(parsedMint, symbol.trim().toUpperCase() || "TOKEN")}
                </div>
            )}

            {/* Summary */}
            <div className="k-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "#666" }}>Factory</span>
                    <span style={{ color: "#aaa" }}>{GRC20_FACTORY_PATH}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "#666" }}>Admin</span>
                    <span style={{ color: "#aaa" }}>{adminMode === "multisig" ? (selectedMultisig || "—") : (adena.address || "—")}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "#666" }}>Messages</span>
                    <span style={{ color: "#aaa" }}>{parsedMint > 0n ? "2 (create + fee)" : "1 (create)"}</span>
                </div>
                {fee > 0n && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                        <span style={{ color: "#666" }}>Platform fee (5%)</span>
                        <span style={{ color: "#f5a623" }}>{String(fee)} {symbol.trim().toUpperCase() || "TOKEN"}</span>
                    </div>
                )}
            </div>

            {/* Submit */}
            <button
                onClick={handleCreate}
                disabled={loading || !auth.isAuthenticated || !name.trim() || !symbol.trim()}
                style={{
                    width: "100%", height: 44, borderRadius: 8,
                    background: loading ? "#222" : "#00d4aa",
                    color: loading ? "#666" : "#000",
                    fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 600,
                    border: "none", cursor: loading ? "not-allowed" : "pointer",
                    transition: "all 0.15s", letterSpacing: "-0.01em",
                    opacity: (!auth.isAuthenticated || !name.trim() || !symbol.trim()) ? 0.4 : 1,
                }}
            >
                {loading ? "Creating..." : adminMode === "multisig" ? "Propose Token Creation" : "Create Token"}
            </button>

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Styles ─────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
    display: "block", marginBottom: 6, fontSize: 11,
    fontFamily: "JetBrains Mono, monospace", color: "#888",
    textTransform: "uppercase", letterSpacing: "0.05em",
}

const hintStyle: React.CSSProperties = {
    marginTop: 4, fontSize: 11,
    fontFamily: "JetBrains Mono, monospace", color: "#555",
}

function inputStyle(loading: boolean): React.CSSProperties {
    return {
        width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
        background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
        fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
        opacity: loading ? 0.5 : 1,
    }
}




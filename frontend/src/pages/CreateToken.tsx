import { useState, useEffect } from "react"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import { DeploymentPipeline, type DeployStep, type DeploymentResult } from "../components/ui/DeploymentPipeline"
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
    const navigate = useNetworkNav()
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
    const [deployStep, setDeployStep] = useState<DeployStep>("idle")
    const [deployResult, setDeployResult] = useState<DeploymentResult | undefined>()
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

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
        setDeployStep("preparing")
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

                setDeployStep("signing")

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

                setDeployStep("broadcasting")

                setDeployResult({
                    entityPath: `/multisig/${selectedMultisig}`,
                    entityLabel: "Token Proposal",
                    entityName: `${trimSymbol} (multisig approval required)`,
                })
                setDeployStep("complete")
            } else {
                // ── Single user: sign + broadcast via Adena DoContract ──
                const msgs = buildCreateTokenMsgs(
                    callerAddress, trimName, trimSymbol, dec,
                    parsedMint, faucet,
                )

                setDeployStep("signing")

                const { hash } = await doContractBroadcast(
                    msgs,
                    memo || `Create GRC20: ${trimSymbol}`,
                )

                setDeployStep("broadcasting")

                setDeployResult({
                    txHash: hash,
                    entityPath: `/tokens/${trimSymbol}`,
                    entityLabel: "Token",
                    entityName: `${trimName} (${trimSymbol})`,
                })
                setDeployStep("complete")
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create token")
            setDeployStep("error")
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

            {success && !deployResult && (
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
                        <span style={{ color: "#666" }}>Platform fee (2.5%)</span>
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

            {/* Deployment Pipeline */}
            <DeploymentPipeline
                active={deployStep !== "idle"}
                currentStep={deployStep}
                result={deployResult}
                error={error ?? undefined}
                onNavigate={() => deployResult?.entityPath && navigate(deployResult.entityPath)}
                onRetry={() => { setDeployStep("idle"); setError(null) }}
                onClose={() => { setDeployStep("idle"); setError(null) }}
            />

            <ErrorToast message={deployStep === "idle" ? error : null} onDismiss={() => setError(null)} />
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




import { useState, useEffect } from "react"
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom"
import { LinkSimple } from "@phosphor-icons/react"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import { GNO_CHAIN_ID, GNO_BECH32_PREFIX } from "../lib/config"
import type { LayoutContext } from "../types/layout"

type ImportMode = "address" | "pubkey"

export function ImportMultisig() {
    const navigate = useNavigate()
    const { auth } = useOutletContext<LayoutContext>()
    const [mode, setMode] = useState<ImportMode>("address")
    const [address, setAddress] = useState("")
    const [pubkeyJson, setPubkeyJson] = useState("")
    const [walletName, setWalletName] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchParams] = useSearchParams()
    const [sharedImport, setSharedImport] = useState<{ pubkeyJson: string; name: string } | null>(null)

    // ── Auto-fill from shareable link (?pubkey=<base64>&name=<name>) ──
    useEffect(() => {
        const encoded = searchParams.get("pubkey")
        const name = searchParams.get("name") || ""
        if (!encoded) return
        try {
            const decoded = atob(encoded)
            // Verify it's valid multisig pubkey JSON
            const parsed = JSON.parse(decoded)
            if (parsed.type === "tendermint/PubKeyMultisigThreshold" && parsed.value?.pubkeys) {
                setSharedImport({ pubkeyJson: decoded, name })
                setPubkeyJson(decoded)
                setWalletName(name)
                setMode("pubkey")
            }
        } catch { /* invalid base64 or JSON — ignore */ }
    }, [searchParams])

    const handleImportByAddress = async () => {
        const trimmed = address.trim()
        if (!trimmed) return
        if (!auth.isAuthenticated || !auth.token) {
            setError("Connect your wallet first")
            return
        }

        if (!/^g(no)?1[a-z0-9]{38,}$/.test(trimmed)) {
            setError("Invalid address format. Expected: g1... or gno1...")
            return
        }

        setLoading(true)
        setError(null)

        try {
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

            const joinRes = await api.createOrJoinMultisig({
                authToken: auth.token,
                chainId: GNO_CHAIN_ID,
                multisigPubkeyJson: multisig.pubkeyJson,
                name: "",
                bech32Prefix: GNO_BECH32_PREFIX,
            })

            if (joinRes.joined || joinRes.created) {
                navigate(`/multisig/${joinRes.multisigAddress}`)
            } else {
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

    const handleImportByPubkey = async () => {
        const trimmedJson = pubkeyJson.trim()
        if (!trimmedJson) return
        if (!auth.isAuthenticated || !auth.token) {
            setError("Connect your wallet first")
            return
        }

        // Validate it's valid JSON
        try {
            const parsed = JSON.parse(trimmedJson)
            if (!parsed.type || !parsed.value) {
                setError("Invalid pubkey JSON. Expected Amino format: { type: \"tendermint/PubKeyMultisigThreshold\", value: {...} }")
                return
            }
            if (parsed.type !== "tendermint/PubKeyMultisigThreshold") {
                setError("Expected type: tendermint/PubKeyMultisigThreshold")
                return
            }
            if (!parsed.value.threshold || !parsed.value.pubkeys || !Array.isArray(parsed.value.pubkeys)) {
                setError("Missing threshold or pubkeys in value object")
                return
            }
            // Validate each pubkey entry
            for (let i = 0; i < parsed.value.pubkeys.length; i++) {
                const pk = parsed.value.pubkeys[i]
                if (!pk.type || !pk.value) {
                    setError(`Pubkey #${i + 1} missing type or value field`)
                    return
                }
            }
        } catch {
            setError("Invalid JSON. Paste the full Amino-encoded multisig pubkey object.")
            return
        }

        setLoading(true)
        setError(null)

        try {
            const res = await api.createOrJoinMultisig({
                authToken: auth.token,
                chainId: GNO_CHAIN_ID,
                multisigPubkeyJson: trimmedJson,
                name: walletName.trim(),
                bech32Prefix: GNO_BECH32_PREFIX,
            })

            navigate(`/multisig/${res.multisigAddress}`)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Import failed")
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
                    Import an existing multisig wallet
                </p>
            </div>

            {/* ── Shareable link banner ──────────────────────────── */}
            {sharedImport && (() => {
                let threshold = "?", members = "?"
                try {
                    const parsed = JSON.parse(sharedImport.pubkeyJson)
                    threshold = parsed.value?.threshold || "?"
                    members = parsed.value?.pubkeys?.length?.toString() || "?"
                } catch { /* ignore */ }
                return (
                    <div className="k-card" style={{ borderColor: "rgba(0,212,170,0.2)", display: "flex", flexDirection: "column", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 16, display: 'flex' }}><LinkSimple size={16} /></span>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>You've been invited to join a multisig</span>
                        </div>
                        <div style={{ display: "flex", gap: 16, fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#888" }}>
                            {sharedImport.name && <span>Name: <span style={{ color: "#ccc" }}>{sharedImport.name}</span></span>}
                            <span>Threshold: <span style={{ color: "#ccc" }}>{threshold}/{members}</span></span>
                        </div>
                        {auth.isAuthenticated ? (
                            <button
                                className="k-btn-primary"
                                disabled={loading}
                                onClick={handleImportByPubkey}
                                style={{ alignSelf: "flex-start", opacity: loading ? 0.5 : 1 }}
                            >
                                {loading ? "Importing..." : "✓ Import This Multisig"}
                            </button>
                        ) : (
                            <p style={{ color: "#f59e0b", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                                ⚠ Connect your wallet first to import
                            </p>
                        )}
                    </div>
                )
            })()}

            {!auth.isAuthenticated && (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 32, textAlign: "center" }}>
                    <p style={{ color: "#666", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        Connect your wallet to import a multisig
                    </p>
                </div>
            )}

            {/* Mode tabs */}
            <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #222" }}>
                <button
                    onClick={() => setMode("address")}
                    style={{
                        padding: "10px 20px", background: "none", border: "none",
                        borderBottom: mode === "address" ? "2px solid #00d4aa" : "2px solid transparent",
                        color: mode === "address" ? "#00d4aa" : "#666",
                        fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                        cursor: "pointer", transition: "all 0.15s",
                    }}
                >
                    By Address
                </button>
                <button
                    onClick={() => setMode("pubkey")}
                    style={{
                        padding: "10px 20px", background: "none", border: "none",
                        borderBottom: mode === "pubkey" ? "2px solid #00d4aa" : "2px solid transparent",
                        color: mode === "pubkey" ? "#00d4aa" : "#666",
                        fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                        cursor: "pointer", transition: "all 0.15s",
                    }}
                >
                    By Pubkey JSON
                </button>
            </div>

            {/* Address mode */}
            {mode === "address" && (
                <>
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
                            onClick={handleImportByAddress}
                            disabled={!address.trim() || loading || !auth.isAuthenticated}
                            style={{ opacity: address.trim() && auth.isAuthenticated && !loading ? 1 : 0.5 }}
                        >
                            {loading ? "Importing..." : "Import & Join"}
                        </button>
                        <button className="k-btn-secondary" onClick={() => navigate("/")}>
                            Cancel
                        </button>
                    </div>
                </>
            )}

            {/* Pubkey JSON mode */}
            {mode === "pubkey" && (
                <>
                    <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <label className="k-label">Wallet Name (optional)</label>
                        <input
                            type="text"
                            value={walletName}
                            onChange={(e) => setWalletName(e.target.value)}
                            placeholder="e.g. our-super-cool-dao"
                            maxLength={256}
                            disabled={loading}
                            style={{
                                width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
                                background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                                fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
                            }}
                        />
                    </div>
                    <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <label className="k-label">Amino Multisig Pubkey JSON</label>
                        <textarea
                            value={pubkeyJson}
                            onChange={(e) => setPubkeyJson(e.target.value)}
                            placeholder={`{
  "type": "tendermint/PubKeyMultisigThreshold",
  "value": {
    "threshold": "2",
    "pubkeys": [
      { "type": "tendermint/PubKeySecp256k1", "value": "..." },
      { "type": "tendermint/PubKeySecp256k1", "value": "..." }
    ]
  }
}`}
                            disabled={loading}
                            rows={10}
                            style={{
                                width: "100%", padding: "12px", borderRadius: 8,
                                background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                                fontFamily: "JetBrains Mono, monospace", fontSize: 12, outline: "none",
                                resize: "vertical", lineHeight: 1.6, opacity: loading ? 0.5 : 1,
                            }}
                        />
                        <p style={{ color: "#666", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                            Paste the full Amino-encoded multisig public key JSON. You can get this from gnokey or from another Memba user.
                        </p>
                    </div>
                    <div style={{ display: "flex", gap: 12 }}>
                        <button
                            className="k-btn-primary"
                            onClick={handleImportByPubkey}
                            disabled={!pubkeyJson.trim() || loading || !auth.isAuthenticated}
                            style={{ opacity: pubkeyJson.trim() && auth.isAuthenticated && !loading ? 1 : 0.5 }}
                        >
                            {loading ? "Importing..." : "Import via Pubkey"}
                        </button>
                        <button className="k-btn-secondary" onClick={() => navigate("/")}>
                            Cancel
                        </button>
                    </div>
                </>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

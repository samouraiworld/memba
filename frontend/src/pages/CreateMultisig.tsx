import { useState, useCallback } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import { GNO_CHAIN_ID, GNO_RPC_URL, GNO_BECH32_PREFIX } from "../lib/config"
import type { LayoutContext } from "../types/layout"

interface MemberEntry {
    address: string
    pubkeyValue: string    // base64 secp256k1 pubkey
    manualPubkey: boolean  // if true, user pasted it manually
    fetchError: string     // error from on-chain fetch
    fetching: boolean
}

export function CreateMultisig() {
    const navigate = useNavigate()
    const { auth } = useOutletContext<LayoutContext>()
    const [name, setName] = useState("")
    const [threshold, setThreshold] = useState(2)
    const [members, setMembers] = useState<MemberEntry[]>([
        emptyMember(), emptyMember(), emptyMember(),
    ])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const addMember = () => setMembers([...members, emptyMember()])
    const removeMember = (i: number) => {
        if (members.length <= 2) return
        const next = members.filter((_, idx) => idx !== i)
        setMembers(next)
        if (threshold > next.length) setThreshold(next.length)
    }
    const updateAddress = (i: number, val: string) => {
        const copy = [...members]
        copy[i] = { ...copy[i], address: val, pubkeyValue: "", fetchError: "", manualPubkey: false }
        setMembers(copy)
    }
    const updatePubkey = (i: number, val: string) => {
        const copy = [...members]
        copy[i] = { ...copy[i], pubkeyValue: val.trim(), manualPubkey: true, fetchError: "" }
        setMembers(copy)
    }

    // Fetch pubkey from chain for a single member
    const fetchPubkey = useCallback(async (i: number, currentMembers: MemberEntry[]) => {
        const m = currentMembers[i]
        if (!m.address.trim()) return

        const addr = m.address.trim()
        if (!/^g(no)?1[a-z0-9]{38,}$/.test(addr)) {
            setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], fetchError: "Invalid address format" }; return c })
            return
        }

        setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], fetching: true, fetchError: "" }; return c })

        try {
            const url = `${GNO_RPC_URL}/abci_query?path=%22auth/accounts/${addr}%22`
            const res = await fetch(url)
            const json = await res.json()

            const rawValue = json?.result?.response?.ResponseBase?.Value
            if (!rawValue) {
                setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], fetching: false, fetchError: "Account not found on chain" }; return c })
                return
            }

            const decoded = atob(rawValue)
            const data = JSON.parse(decoded)
            const account = data?.value || data
            const pubkey = account?.pub_key || account?.PubKey || account?.public_key

            if (!pubkey || !pubkey.value) {
                setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], fetching: false, fetchError: "No pubkey on chain — member must send 1 TX first, or paste pubkey manually" }; return c })
                return
            }

            setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], pubkeyValue: pubkey.value, fetching: false, fetchError: "", manualPubkey: false }; return c })
        } catch {
            setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], fetching: false, fetchError: "Failed to fetch from chain" }; return c })
        }
    }, [])

    const handleCreate = async () => {
        if (!auth.isAuthenticated || !auth.token) {
            setError("Connect your wallet first")
            return
        }
        if (!name.trim()) {
            setError("Enter a wallet name")
            return
        }

        // Validate all members have pubkeys
        const missing = members.filter(m => !m.pubkeyValue)
        if (missing.length > 0) {
            setError(`${missing.length} member(s) missing pubkey — fetch from chain or paste manually`)
            return
        }

        // Check for duplicate addresses
        const addrs = members.map(m => m.address.trim())
        if (new Set(addrs).size !== addrs.length) {
            setError("Duplicate member addresses found")
            return
        }

        setLoading(true)
        setError(null)

        try {
            // Build Amino multisig pubkey JSON
            const pubkeys = members.map(m => ({
                type: "tendermint/PubKeySecp256k1",
                value: m.pubkeyValue,
            }))

            const multisigPubkeyJson = JSON.stringify({
                type: "tendermint/PubKeyMultisigThreshold",
                value: {
                    threshold: String(threshold),
                    pubkeys,
                },
            })

            const res = await api.createOrJoinMultisig({
                authToken: auth.token,
                chainId: GNO_CHAIN_ID,
                multisigPubkeyJson,
                name: name.trim(),
                bech32Prefix: GNO_BECH32_PREFIX,
            })

            navigate(`/multisig/${res.multisigAddress}`)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create multisig")
        } finally {
            setLoading(false)
        }
    }

    const allHavePubkeys = members.every(m => !!m.pubkeyValue)
    const canSubmit = auth.isAuthenticated && name.trim() && allHavePubkeys && !loading

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <div>
                <button onClick={() => navigate("/")} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back to Dashboard
                </button>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Create Multisig</h2>
                <p style={{ color: "#999", fontSize: 14, marginTop: 4 }}>
                    Set up a new multisig wallet with your team
                </p>
            </div>

            {!auth.isAuthenticated && (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 32, textAlign: "center" }}>
                    <p style={{ color: "#666", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        Connect your wallet to create a multisig
                    </p>
                </div>
            )}

            {/* Name */}
            <div className="k-card">
                <label className="k-label" style={{ display: "block", marginBottom: 8 }}>Wallet Name</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. samourai-crew"
                    maxLength={256}
                    style={{
                        width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
                        background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                        fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
                    }}
                />
            </div>

            {/* Members */}
            <div className="k-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <label className="k-label">Members ({members.length})</label>
                    <button onClick={addMember} style={{ color: "#00d4aa", fontSize: 12, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace" }}>
                        + Add Member
                    </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {members.map((m, i) => (
                        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{ display: "flex", gap: 8 }}>
                                <input
                                    type="text"
                                    value={m.address}
                                    onChange={(e) => updateAddress(i, e.target.value)}
                                    placeholder={`g1member${i + 1}...`}
                                    style={{
                                        flex: 1, height: 36, padding: "0 12px", borderRadius: 6,
                                        background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                                        fontFamily: "JetBrains Mono, monospace", fontSize: 12, outline: "none",
                                    }}
                                />
                                <button
                                    onClick={() => fetchPubkey(i, members)}
                                    disabled={m.fetching || !m.address.trim()}
                                    style={{
                                        padding: "0 12px", height: 36, borderRadius: 6,
                                        background: m.pubkeyValue && !m.manualPubkey ? "rgba(0,212,170,0.08)" : "none",
                                        border: `1px solid ${m.pubkeyValue ? "#00d4aa33" : "#222"}`,
                                        color: m.pubkeyValue ? "#00d4aa" : "#666",
                                        cursor: m.fetching || !m.address.trim() ? "not-allowed" : "pointer",
                                        fontFamily: "JetBrains Mono, monospace", fontSize: 11,
                                        opacity: m.fetching ? 0.5 : 1,
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {m.fetching ? "..." : m.pubkeyValue && !m.manualPubkey ? "✓ Key" : "Fetch Key"}
                                </button>
                                {members.length > 2 && (
                                    <button onClick={() => removeMember(i)} style={{ width: 36, height: 36, borderRadius: 6, background: "none", border: "1px solid #222", color: "#666", cursor: "pointer", fontSize: 14 }}>
                                        ×
                                    </button>
                                )}
                            </div>
                            {/* Error or manual paste */}
                            {m.fetchError && (
                                <div style={{ fontSize: 11, color: "#f59e0b", fontFamily: "JetBrains Mono, monospace", paddingLeft: 4 }}>
                                    ⚠ {m.fetchError}
                                    {m.fetchError.includes("paste") && (
                                        <input
                                            type="text"
                                            value={m.manualPubkey ? m.pubkeyValue : ""}
                                            onChange={(e) => updatePubkey(i, e.target.value)}
                                            placeholder="Paste base64 secp256k1 pubkey..."
                                            style={{
                                                display: "block", marginTop: 4,
                                                width: "100%", height: 32, padding: "0 8px", borderRadius: 4,
                                                background: "#0c0c0c", border: "1px solid #333", color: "#f0f0f0",
                                                fontFamily: "JetBrains Mono, monospace", fontSize: 11, outline: "none",
                                            }}
                                        />
                                    )}
                                </div>
                            )}
                            {/* Show pubkey if fetched or pasted */}
                            {m.pubkeyValue && !m.fetchError && (
                                <span style={{ fontSize: 10, color: "#555", fontFamily: "JetBrains Mono, monospace", paddingLeft: 4 }}>
                                    🔑 {m.pubkeyValue.slice(0, 16)}…{m.manualPubkey ? " (manual)" : ""}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Threshold */}
            <div className="k-card">
                <label className="k-label" style={{ display: "block", marginBottom: 8 }}>
                    Threshold — {threshold} of {members.length}
                </label>
                <input
                    type="range"
                    min={1}
                    max={members.length}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "#00d4aa" }}
                />
                <p style={{ color: "#666", fontSize: 12, marginTop: 8, fontFamily: "JetBrains Mono, monospace" }}>
                    {threshold} signature{threshold > 1 ? "s" : ""} required to execute a transaction
                </p>
            </div>

            {/* Submit */}
            <div style={{ display: "flex", gap: 12 }}>
                <button
                    className="k-btn-primary"
                    onClick={handleCreate}
                    disabled={!canSubmit}
                    style={{ opacity: canSubmit ? 1 : 0.5 }}
                >
                    {loading ? "Creating..." : "Create Multisig"}
                </button>
                <button className="k-btn-secondary" onClick={() => navigate("/")}>
                    Cancel
                </button>
            </div>

            {/* P1: Validation hint — explain why submit is disabled */}
            {!canSubmit && name.trim() && auth.isAuthenticated && !allHavePubkeys && !loading && (
                <div style={{
                    padding: "12px 16px", borderRadius: 8,
                    background: "rgba(245,166,35,0.06)",
                    border: "1px solid rgba(245,166,35,0.12)",
                    color: "#f5a623", fontSize: 11,
                    fontFamily: "JetBrains Mono, monospace",
                    lineHeight: 1.6,
                }}>
                    ⚠ Each member needs a <strong>public key</strong> to build the multisig.
                    Click &quot;Fetch Key&quot; next to each member address to retrieve their key from the chain.
                    If a member hasn&apos;t made any on-chain transaction yet, paste their base64 secp256k1 public key manually.
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

function emptyMember(): MemberEntry {
    return { address: "", pubkeyValue: "", manualPubkey: false, fetchError: "", fetching: false }
}

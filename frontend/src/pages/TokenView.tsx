import { useState, useEffect, useCallback } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { GNO_RPC_URL, GNO_CHAIN_ID } from "../lib/config"
import {
    getTokenInfo, getTokenBalance, buildTransferMsg, buildFaucetMsg,
    buildMintMsgs, buildBurnMsg, calculateFee, feeDisclosure,
    type TokenInfo, type AminoMsg,
} from "../lib/grc20"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { ErrorToast } from "../components/ui/ErrorToast"
import type { LayoutContext } from "../types/layout"

type ActionTab = "transfer" | "mint" | "burn" | "faucet"

export function TokenView() {
    const { symbol } = useParams<{ symbol: string }>()
    const navigate = useNavigate()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const [token, setToken] = useState<TokenInfo | null>(null)
    const [balance, setBalance] = useState(0n)
    const [loading, setLoading] = useState(true)
    const [actionTab, setActionTab] = useState<ActionTab>("transfer")
    const [txLoading, setTxLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    // Action form fields
    const [toAddress, setToAddress] = useState("")
    const [amount, setAmount] = useState("")

    const fetchData = useCallback(async () => {
        if (!symbol) return
        setLoading(true)
        try {
            const info = await getTokenInfo(GNO_RPC_URL, symbol)
            setToken(info)
            if (adena.connected && adena.address) {
                const bal = await getTokenBalance(GNO_RPC_URL, symbol, adena.address)
                setBalance(bal)
            }
        } catch (err) {
            console.error("Failed to fetch token:", err)
        } finally {
            setLoading(false)
        }
    }, [symbol, adena.connected, adena.address])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    const isAdmin = auth.isAuthenticated && token?.admin === adena.address

    const handleAction = async () => {
        if (!auth.isAuthenticated || !symbol) return
        setTxLoading(true)
        setError(null)
        setSuccess(null)

        try {
            const caller = adena.address
            let msgs: AminoMsg[]

            switch (actionTab) {
                case "transfer": {
                    if (!toAddress.trim() || !amount.trim()) { setError("Recipient and amount required"); return }
                    if (!/^g(no)?1[a-z0-9]{38,}$/.test(toAddress.trim())) { setError("Invalid address"); return }
                    msgs = [buildTransferMsg(caller, symbol, toAddress.trim(), amount.trim())]
                    break
                }
                case "mint": {
                    if (!toAddress.trim() || !amount.trim()) { setError("Recipient and amount required"); return }
                    const mintAmount = BigInt(amount.trim())
                    msgs = buildMintMsgs(caller, symbol, toAddress.trim(), mintAmount)
                    break
                }
                case "burn": {
                    if (!toAddress.trim() || !amount.trim()) { setError("Address and amount required"); return }
                    msgs = [buildBurnMsg(caller, symbol, toAddress.trim(), amount.trim())]
                    break
                }
                case "faucet": {
                    msgs = [buildFaucetMsg(caller, symbol)]
                    break
                }
                default: return
            }

            // Sign + broadcast via Adena DoContract
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adenaGlobal = (window as any).adena
            if (!adenaGlobal?.DoContract) {
                setError("Adena wallet not available — please install or refresh the page")
                return
            }

            // Convert Amino MsgCall to Adena's /vm.m_call format
            const adenaMessages = msgs.map((m) => ({
                type: "/vm.m_call",
                value: {
                    caller: m.value.caller,
                    send: m.value.send || "",
                    pkg_path: m.value.pkg_path,
                    func: m.value.func,
                    args: m.value.args,
                },
            }))

            const contractRes = await adenaGlobal.DoContract({
                messages: adenaMessages,
                gasFee: 1,
                gasWanted: 10000000,
                memo: `Memba: ${actionTab} ${symbol}`,
            })

            if (contractRes.status === "failure") {
                const errMsg = contractRes.message || contractRes.data?.message || "Transaction failed"
                setError(`Transaction failed: ${errMsg}`)
                return
            }

            setSuccess(`${actionTab} successful!`)
            setToAddress("")
            setAmount("")
            fetchData()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Transaction failed")
        } finally {
            setTxLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="animate-fade-in" style={{ textAlign: "center", padding: 64 }}>
                <p style={{ color: "#555", fontFamily: "JetBrains Mono, monospace" }}>Loading token...</p>
            </div>
        )
    }

    if (!token) {
        return (
            <div className="animate-fade-in" style={{ textAlign: "center", padding: 64 }}>
                <h2 style={{ fontSize: 18, marginBottom: 8 }}>Token not found</h2>
                <button onClick={() => navigate("/tokens")} style={backBtnStyle}>← Back to Tokens</button>
            </div>
        )
    }

    const mintAmount = actionTab === "mint" && amount.trim() ? BigInt(amount.trim()) : 0n
    const fee = mintAmount > 0n ? calculateFee(mintAmount) : 0n

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {/* Header */}
            <div>
                <button onClick={() => navigate("/tokens")} style={backBtnStyle}>← Back to Tokens</button>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                    <span style={{ fontSize: 28 }}>🪙</span>
                    <div>
                        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
                            {token.name} <span style={{ color: "#888", fontWeight: 400, fontSize: 16 }}>${token.symbol}</span>
                        </h2>
                    </div>
                    {isAdmin && (
                        <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa", background: "rgba(0,212,170,0.08)", padding: "3px 8px", borderRadius: 4 }}>
                            Admin
                        </span>
                    )}
                </div>
            </div>

            {/* Metadata card */}
            <div className="k-card" style={{ padding: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <MetaRow label="Symbol" value={`$${token.symbol}`} />
                    <MetaRow label="Decimals" value={String(token.decimals)} />
                    <MetaRow label="Total Supply" value={token.totalSupply} accent />
                    {token.admin && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                            <span style={{ color: "#666" }}>Admin</span>
                            <CopyableAddress address={token.admin} fontSize={12} />
                        </div>
                    )}
                    <MetaRow label="Factory" value="grc20factory" />
                    <MetaRow label="Network" value={GNO_CHAIN_ID} />
                </div>
            </div>

            {/* Your balance */}
            {adena.connected && (
                <div className="k-card" style={{ padding: 16, borderColor: "rgba(0,212,170,0.15)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#888" }}>Your Balance</span>
                        <span style={{ fontSize: 20, fontWeight: 600, color: balance > 0n ? "#00d4aa" : "#555" }}>
                            {String(balance)} <span style={{ fontSize: 12, color: "#888" }}>${token.symbol}</span>
                        </span>
                    </div>
                </div>
            )}

            {/* Actions */}
            {auth.isAuthenticated && (
                <>
                    {success && (
                        <div style={{ padding: "12px 16px", background: "rgba(0,212,170,0.08)", borderRadius: 8, border: "1px solid rgba(0,212,170,0.2)", color: "#00d4aa", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                            ✓ {success}
                        </div>
                    )}

                    {/* Action tabs */}
                    <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #222" }}>
                        {(["transfer", ...(isAdmin ? ["mint", "burn"] as const : []), "faucet"] as ActionTab[]).map(tab => (
                            <button
                                key={tab}
                                onClick={() => { setActionTab(tab); setError(null); setSuccess(null) }}
                                style={{
                                    padding: "10px 16px", background: "none", border: "none",
                                    borderBottom: actionTab === tab ? "2px solid #00d4aa" : "2px solid transparent",
                                    color: actionTab === tab ? "#00d4aa" : "#666",
                                    fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                                    cursor: "pointer", transition: "all 0.15s",
                                    textTransform: "capitalize",
                                }}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    {/* Action form */}
                    <div className="k-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                        {actionTab === "faucet" ? (
                            <p style={{ color: "#888", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                                Request free tokens from the faucet (if enabled by admin).
                            </p>
                        ) : (
                            <>
                                <div>
                                    <label style={labelStyle}>
                                        {actionTab === "burn" ? "Burn From Address" : "Recipient Address"}
                                    </label>
                                    <input
                                        type="text" value={toAddress}
                                        onChange={e => setToAddress(e.target.value)}
                                        placeholder={actionTab === "burn" ? "g1..." : "g1..."}
                                        style={inputStyle(txLoading)} disabled={txLoading}
                                    />
                                </div>
                                <div>
                                    <label style={labelStyle}>Amount (smallest unit)</label>
                                    <input
                                        type="text" value={amount}
                                        onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                                        placeholder="e.g. 1000000"
                                        style={inputStyle(txLoading)} disabled={txLoading}
                                    />
                                </div>
                            </>
                        )}

                        {/* Mint fee disclosure */}
                        {actionTab === "mint" && fee > 0n && (
                            <div style={{
                                padding: "10px 14px", borderRadius: 8,
                                background: "rgba(245,166,35,0.06)", border: "1px solid rgba(245,166,35,0.15)",
                                fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#f5a623",
                            }}>
                                💰 {feeDisclosure(mintAmount, token.symbol)}
                            </div>
                        )}

                        <button
                            onClick={handleAction}
                            disabled={txLoading}
                            style={{
                                width: "100%", height: 40, borderRadius: 8,
                                background: txLoading ? "#222" : "#00d4aa",
                                color: txLoading ? "#666" : "#000",
                                fontFamily: "JetBrains Mono, monospace", fontSize: 13, fontWeight: 600,
                                border: "none", cursor: txLoading ? "not-allowed" : "pointer",
                                transition: "all 0.15s", textTransform: "capitalize",
                            }}
                        >
                            {txLoading ? "Processing..." : actionTab}
                        </button>
                    </div>
                </>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Sub-components ────────────────────────────────────────────

function MetaRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
            <span style={{ color: "#666" }}>{label}</span>
            <span style={{ color: accent ? "#00d4aa" : "#aaa" }}>{value}</span>
        </div>
    )
}

// ── Styles ────────────────────────────────────────────────────

const backBtnStyle: React.CSSProperties = {
    color: "#00d4aa", fontSize: 13, background: "none", border: "none",
    cursor: "pointer", marginBottom: 8, fontFamily: "JetBrains Mono, monospace",
}

const labelStyle: React.CSSProperties = {
    display: "block", marginBottom: 6, fontSize: 11,
    fontFamily: "JetBrains Mono, monospace", color: "#888",
    textTransform: "uppercase", letterSpacing: "0.05em",
}

function inputStyle(loading: boolean): React.CSSProperties {
    return {
        width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
        background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
        fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
        opacity: loading ? 0.5 : 1,
    }
}

import { useState, useEffect } from "react"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import { DeploymentPipeline, type DeployStep, type DeploymentResult } from "../components/ui/DeploymentPipeline"
import { GNO_CHAIN_ID, isTokenFactoryValid } from "../lib/config"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import { fetchAccountInfo } from "../lib/account"
import {
    buildCreateTokenMsgs,
    buildCreateTokenWithAdminMsgs,
    calculateFee,
    doContractBroadcast,
    parseTokenAmount,
    maxWholeTokens,
    formatSupply,
    MAX_INT64,
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
    const [showGuide, setShowGuide] = useState(false)

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

    // The token factory realm isn't valid on every network (e.g. test13 carries
    // a stale v1 tokenfactory the interrealm-v2 VM can't run — a New() call would
    // fail with "unexpected node …:0:0"). Gate the whole page instead of letting
    // the user submit a tx that's guaranteed to fail.
    if (!isTokenFactoryValid()) {
        return (
            <ComingSoonGate
                title="Token Factory"
                icon="🪙"
                description="Token creation isn't available on this network yet. The token factory contract is live on Testnet 13 — switch networks to create tokens."
                features={["Create GRC20 tokens", "Mint, transfer & burn", "Built-in faucet & DAO treasury minting"]}
            />
        )
    }

    // Supply & faucet are entered in WHOLE tokens; the contract stores base
    // units (whole × 10^decimals). Decimals fall back to 6 for the live preview
    // until the field is validated on submit.
    const previewDec = (() => {
        const d = parseInt(decimals, 10)
        return isNaN(d) || d < 0 || d > 18 ? 6 : d
    })()

    let parsedMint = 0n
    let mintError: string | null = null
    try {
        parsedMint = parseTokenAmount(initialMint, previewDec)
    } catch (e) {
        mintError = e instanceof Error ? e.message : "Invalid amount"
    }
    const fee = parsedMint > 0n ? calculateFee(parsedMint) : 0n
    // The realm mints initialMint + fee as total supply — both must fit int64.
    const totalSupply = parsedMint + fee
    const overCap = !mintError && totalSupply > MAX_INT64
    const symUpper = symbol.trim().toUpperCase() || "TOKEN"

    // Faucet is optional whole-token input; validate it live too so a bad value
    // blocks submit up front instead of failing on the New() call.
    let faucetBase = 0n
    let faucetError: string | null = null
    try {
        faucetBase = parseTokenAmount(faucetAmount, previewDec)
    } catch (e) {
        faucetError = e instanceof Error ? e.message : "Invalid amount"
    }
    const faucetOverCap = !faucetError && faucetBase > MAX_INT64

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

        // Supply/faucet are in whole tokens → convert to base units and enforce
        // the int64 ceiling here. Above it the tx fails on-chain with an opaque
        // "strconv.ParseInt: value out of range" before the realm ever runs.
        let mint = 0n
        try {
            mint = parseTokenAmount(initialMint, dec)
        } catch (e) {
            setError(e instanceof Error ? e.message : "Invalid initial supply"); return
        }
        if (mint + calculateFee(mint) > MAX_INT64) {
            setError(`Initial supply is too large. The max at ${dec} decimals is ~${maxWholeTokens(dec)} ${trimSymbol} (the 2.5% fee is minted on top, so leave headroom).`); return
        }
        let faucet = 0n
        try {
            faucet = parseTokenAmount(faucetAmount, dec)
        } catch (e) {
            setError(e instanceof Error ? `Faucet amount: ${e.message}` : "Invalid faucet amount"); return
        }
        if (faucet > MAX_INT64) {
            setError(`Faucet amount is too large. The max at ${dec} decimals is ~${maxWholeTokens(dec)} ${trimSymbol}.`); return
        }

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
                    mint, faucet, selectedMultisig,
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
                    mint, faucet,
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
                <button onClick={() => navigate("/")} style={{ color: "var(--color-primary)", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back to Dashboard
                </button>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Create a Token</h2>
                <p style={{ color: "var(--color-text-secondary)", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                    Deploy your own GRC20 token on {GNO_CHAIN_ID} — a standard, tradeable coin with a name, supply, and holders.
                </p>
                <button
                    onClick={() => setShowGuide((v) => !v)}
                    style={{
                        marginTop: 12, background: "none", border: "1px solid var(--color-k-edge)",
                        borderRadius: 8, padding: "6px 12px", cursor: "pointer",
                        color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace", fontSize: 11,
                    }}
                >
                    {showGuide ? "▼" : "▶"} New to tokens? Read this first
                </button>
            </div>

            {/* Education / tokenomics primer */}
            {showGuide && (
                <div className="k-card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
                    <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--color-k-text)", fontFamily: "JetBrains Mono, monospace", margin: 0 }}>
                        A token is a coin you define and control. You pick its name, how many exist,
                        and who can create more. Here's what each setting means:
                    </p>
                    {[
                        ["Decimals", "How finely one token can be split. 6 (the default) means a token divides into 1,000,000 pieces — like cents in a dollar, but smaller. You almost never need to change this."],
                        ["Initial supply", "How many tokens are minted to you (the admin) the moment the token is created. This is your starting stack — use it for the team, treasury, liquidity, airdrops, or sale."],
                        ["Platform fee (2.5%)", "On every mint, an extra 2.5% is created and sent to the Samouraï Coop to fund the platform. Mint 1,000,000 → 25,000 extra go to the Coop; total supply becomes 1,025,000."],
                        ["Faucet", "Optional. If set, anyone can claim this fixed amount for free (handy for testnets or community distribution). Leave at 0 to keep it off — the tokens would be minted from thin air each claim."],
                        ["Admin", "The address allowed to mint more or burn tokens later. Your wallet by default. Choose a multisig for shared, harder-to-abuse control — or renounce admin later to lock supply forever (a credible 'fixed supply' promise)."],
                        ["Max supply", `Amounts are stored as a 64-bit integer on-chain, so the hard ceiling is ~9.2 quintillion base units. At 6 decimals that's ~${maxWholeTokens(6)} whole tokens. Go above it and the transaction fails.`],
                    ].map(([term, body]) => (
                        <div key={term} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-k-accent)", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.04em" }}>{term}</span>
                            <span style={{ fontSize: 12, lineHeight: 1.55, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>{body}</span>
                        </div>
                    ))}
                    <p style={{ fontSize: 11, lineHeight: 1.55, color: "var(--color-text-muted)", fontFamily: "JetBrains Mono, monospace", margin: 0, borderTop: "1px solid var(--color-k-edge)", paddingTop: 12 }}>
                        Tokenomics in one line: decide the total supply and who holds it, keep decimals at 6 unless you have a reason, and be deliberate about who stays admin — that's what holders will judge.
                    </p>
                </div>
            )}

            {!auth.isAuthenticated && (
                <div className="k-dashed" style={{ background: "var(--color-k-elevated)", padding: 32, textAlign: "center" }}>
                    <p style={{ color: "var(--color-text-secondary)", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        Connect your wallet to create a token
                    </p>
                </div>
            )}

            {success && !deployResult && (
                <div style={{ padding: "12px 16px", background: "var(--color-k-accent-subtle)", borderRadius: 8, border: "1px solid var(--color-k-accent-border)", color: "var(--color-primary)", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                    ✓ {success}
                </div>
            )}

            {/* Admin mode tabs */}
            <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--color-k-edge)" }}>
                <button
                    onClick={() => setAdminMode("self")}
                    style={{
                        padding: "10px 20px", background: "none", border: "none",
                        borderBottom: adminMode === "self" ? "2px solid var(--color-k-accent)" : "2px solid transparent",
                        color: adminMode === "self" ? "var(--color-k-accent)" : "var(--color-k-muted)",
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
                        borderBottom: adminMode === "multisig" ? "2px solid var(--color-k-accent)" : "2px solid transparent",
                        color: adminMode === "multisig" ? "var(--color-k-accent)" : "var(--color-k-muted)",
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
                    <p style={hintStyle}>How divisible each token is. 6 is standard (1 token = 1,000,000 units). Range 0–18.</p>
                </div>

                {/* Initial Supply */}
                <div>
                    <label style={labelStyle}>Initial Supply (whole {symUpper})</label>
                    <input
                        type="text" value={initialMint}
                        onChange={(e) => setInitialMint(e.target.value.replace(/[^0-9.]/g, ""))}
                        placeholder="e.g. 1000000 (optional)"
                        style={inputStyle(loading)} disabled={loading}
                        aria-invalid={!!mintError || overCap}
                    />
                    <p style={hintStyle}>Number of whole tokens minted to the admin now. Leave empty for 0.</p>
                    {/* Live conversion + fee/total preview */}
                    {mintError ? (
                        <p style={{ ...hintStyle, color: "var(--color-warning)" }}>⚠ {mintError}</p>
                    ) : overCap ? (
                        <p style={{ ...hintStyle, color: "var(--color-warning)" }}>
                            ⚠ Too large. Max at {previewDec} decimals is ~{maxWholeTokens(previewDec)} {symUpper}.
                        </p>
                    ) : parsedMint > 0n ? (
                        <p style={{ ...hintStyle, color: "var(--color-text-secondary)" }}>
                            = {formatSupply(String(parsedMint), previewDec)} {symUpper}
                            {" "}({String(parsedMint)} base units)
                            {" · "}+{formatSupply(String(fee), previewDec) ?? "0"} fee
                            {" → "}total supply {formatSupply(String(totalSupply), previewDec)} {symUpper}
                        </p>
                    ) : null}
                </div>

                {/* Faucet Amount */}
                <div>
                    <label style={labelStyle}>Faucet Amount (whole {symUpper} per claim)</label>
                    <input
                        type="text" value={faucetAmount}
                        onChange={(e) => setFaucetAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                        placeholder="0 = disabled"
                        style={inputStyle(loading)} disabled={loading}
                        aria-invalid={!!faucetError || faucetOverCap}
                    />
                    <p style={hintStyle}>Free tokens anyone can claim per request. 0 = faucet off (recommended for real tokens).</p>
                    {faucetError ? (
                        <p style={{ ...hintStyle, color: "var(--color-warning)" }}>⚠ {faucetError}</p>
                    ) : faucetOverCap ? (
                        <p style={{ ...hintStyle, color: "var(--color-warning)" }}>
                            ⚠ Too large. Max at {previewDec} decimals is ~{maxWholeTokens(previewDec)} {symUpper}.
                        </p>
                    ) : null}
                </div>

                {/* Multisig selector */}
                {adminMode === "multisig" && (
                    <div>
                        <label style={labelStyle}>Multisig Wallet (admin)</label>
                        {multisigs.length === 0 ? (
                            <p style={{ ...hintStyle, color: "var(--color-warning)" }}>
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
            {parsedMint > 0n && !mintError && !overCap && (
                <div style={{
                    padding: "14px 18px", borderRadius: 8,
                    background: "var(--color-k-amber-subtle)", border: "1px solid var(--color-k-amber-border)",
                    fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "var(--color-warning)",
                }}>
                    💰 A 2.5% platform fee ({formatSupply(String(fee), previewDec) ?? "0"} {symUpper}) is minted on top and supports Samouraï Coop development & maintenance.
                </div>
            )}

            {/* Summary */}
            <div className="k-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>Factory</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>{GRC20_FACTORY_PATH}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>Admin</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>{adminMode === "multisig" ? (selectedMultisig || "—") : (adena.address || "—")}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>Messages</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>1 (create)</span>
                </div>
                {fee > 0n && !mintError && !overCap && (
                    <>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                            <span style={{ color: "var(--color-text-secondary)" }}>Platform fee (2.5%)</span>
                            <span style={{ color: "var(--color-warning)" }}>{formatSupply(String(fee), previewDec)} {symUpper}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                            <span style={{ color: "var(--color-text-secondary)" }}>Total supply</span>
                            <span style={{ color: "var(--color-k-text)" }}>{formatSupply(String(totalSupply), previewDec)} {symUpper}</span>
                        </div>
                    </>
                )}
            </div>

            {/* Submit */}
            <button
                onClick={handleCreate}
                disabled={loading || !auth.isAuthenticated || !name.trim() || !symbol.trim() || !!mintError || overCap || !!faucetError || faucetOverCap}
                style={{
                    width: "100%", height: 44, borderRadius: 8,
                    background: loading ? "var(--color-k-edge)" : "var(--color-k-accent)",
                    color: loading ? "var(--color-k-muted)" : "var(--color-k-on-accent)",
                    fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 600,
                    border: "none", cursor: loading ? "not-allowed" : "pointer",
                    transition: "all 0.15s", letterSpacing: "-0.01em",
                    opacity: (!auth.isAuthenticated || !name.trim() || !symbol.trim() || !!mintError || overCap || !!faucetError || faucetOverCap) ? 0.4 : 1,
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
    fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-secondary)",
    textTransform: "uppercase", letterSpacing: "0.05em",
}

const hintStyle: React.CSSProperties = {
    marginTop: 4, fontSize: 11,
    fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-muted)",
}

function inputStyle(loading: boolean): React.CSSProperties {
    return {
        width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
        background: "var(--color-k-elevated)", border: "1px solid var(--color-k-edge)", color: "var(--color-k-text)",
        fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
        opacity: loading ? 0.5 : 1,
    }
}




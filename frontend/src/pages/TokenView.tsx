import { useState, useEffect, useCallback } from "react"
import { useParams, useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { ArrowsClockwise } from "@phosphor-icons/react"
import { GNO_RPC_URL, GNO_CHAIN_ID } from "../lib/config"
import {
    getTokenInfo, getTokenBalance, buildTransferMsg, buildFaucetMsg,
    buildMintMsgs, buildBurnMsg, calculateFee, feeDisclosure,
    doContractBroadcast,
    type TokenInfo, type AminoMsg,
} from "../lib/grc20"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { ErrorToast } from "../components/ui/ErrorToast"
import type { LayoutContext } from "../types/layout"
import "./tokenview.css"

type ActionTab = "transfer" | "mint" | "burn" | "faucet"

export function TokenView() {
    const { symbol } = useParams<{ symbol: string }>()
    const navigate = useNetworkNav()
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

    // Fetch token metadata (public data — independent of wallet connection)
    const fetchTokenInfo = useCallback(async () => {
        if (!symbol) return
        setLoading(true)
        try {
            // Retry logic: token may not be indexed immediately after creation
            let info: TokenInfo | null = null
            for (let attempt = 0; attempt < 4; attempt++) {
                info = await getTokenInfo(GNO_RPC_URL, symbol)
                if (info) break
                if (attempt < 3) await new Promise(r => setTimeout(r, 2000))
            }
            setToken(info)
        } catch (err) {
            console.error("Failed to fetch token:", err)
        } finally {
            setLoading(false)
        }
    }, [symbol])

    useEffect(() => {
        fetchTokenInfo()
    }, [fetchTokenInfo])

    // Fetch user balance (wallet-specific — runs when wallet connects or token loads)
    useEffect(() => {
        if (!symbol || !adena.connected || !adena.address || !token) return
        getTokenBalance(GNO_RPC_URL, symbol, adena.address)
            .then(setBalance)
            .catch(() => { /* non-blocking */ })
    }, [symbol, adena.connected, adena.address, token])

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
                    if (!toAddress.trim() || !amount.trim()) { setError("Recipient and amount required"); setTxLoading(false); return }
                    if (!/^g(no)?1[a-z0-9]{38,}$/.test(toAddress.trim())) { setError("Invalid address"); setTxLoading(false); return }
                    msgs = [buildTransferMsg(caller, symbol, toAddress.trim(), amount.trim())]
                    break
                }
                case "mint": {
                    if (!toAddress.trim() || !amount.trim()) { setError("Recipient and amount required"); setTxLoading(false); return }
                    let mintAmount: bigint
                    try { mintAmount = BigInt(amount.trim()) } catch { setError("Invalid amount"); setTxLoading(false); return }
                    msgs = buildMintMsgs(caller, symbol, toAddress.trim(), mintAmount)
                    break
                }
                case "burn": {
                    if (!toAddress.trim() || !amount.trim()) { setError("Address and amount required"); setTxLoading(false); return }
                    msgs = [buildBurnMsg(caller, symbol, toAddress.trim(), amount.trim())]
                    break
                }
                case "faucet": {
                    msgs = [buildFaucetMsg(caller, symbol)]
                    break
                }
                default: return
            }

            await doContractBroadcast(msgs, `Memba: ${actionTab} ${symbol}`)

            setSuccess(`${actionTab} successful!`)
            setToAddress("")
            setAmount("")
            fetchTokenInfo()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Transaction failed")
        } finally {
            setTxLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="animate-fade-in tv-loading">
                <p className="tv-loading__text">Loading token...</p>
            </div>
        )
    }

    if (!token) {
        return (
            <div className="animate-fade-in tv-empty">
                <h2 className="tv-empty__title">Token not found</h2>
                <p className="tv-empty__hint">
                    If you just created this token, it may still be indexing. Try again in a few seconds.
                </p>
                <div className="tv-empty__actions">
                    <button onClick={() => fetchTokenInfo()} className="tv-back-btn"><ArrowsClockwise size={14} /> Retry</button>
                    <button onClick={() => navigate("/tokens")} className="tv-back-btn">← Back to Tokens</button>
                </div>
            </div>
        )
    }

    let mintAmount = 0n
    try { mintAmount = actionTab === "mint" && amount.trim() ? BigInt(amount.trim()) : 0n } catch { /* invalid input */ }
    const fee = mintAmount > 0n ? calculateFee(mintAmount) : 0n

    return (
        <div className="animate-fade-in tv-page">
            {/* Header */}
            <div>
                <button onClick={() => navigate("/tokens")} className="tv-back-btn">← Back to Tokens</button>
                <div className="tv-header">
                    <span className="tv-header__icon">🪙</span>
                    <div>
                        <h2 className="tv-header__name">
                            {token.name} <span className="tv-header__symbol">${token.symbol}</span>
                        </h2>
                    </div>
                    {isAdmin && (
                        <span className="tv-admin-badge">Admin</span>
                    )}
                </div>
            </div>

            {/* Metadata card */}
            <div className="k-card tv-meta-card">
                <div className="tv-meta-card__rows">
                    <MetaRow label="Symbol" value={`$${token.symbol}`} />
                    <MetaRow label="Decimals" value={String(token.decimals)} />
                    <MetaRow label="Total Supply" value={token.totalSupply} accent />
                    {token.admin && (
                        <div className="tv-meta-row">
                            <span className="tv-meta-row__label">Admin</span>
                            <CopyableAddress address={token.admin} fontSize={12} />
                        </div>
                    )}
                    <MetaRow label="Factory" value="grc20factory" />
                    <MetaRow label="Network" value={GNO_CHAIN_ID} />
                </div>
            </div>

            {/* Your balance */}
            {adena.connected && (
                <div className="k-card tv-balance-card">
                    <div className="tv-balance-card__inner">
                        <span className="tv-balance-card__label">Your Balance</span>
                        <span className={`tv-balance-card__amount ${balance > 0n ? "tv-balance-card__amount--positive" : "tv-balance-card__amount--zero"}`}>
                            {String(balance)} <span className="tv-balance-card__symbol">${token.symbol}</span>
                        </span>
                    </div>
                </div>
            )}

            {/* Actions */}
            {auth.isAuthenticated && (
                <>
                    {success && (
                        <div className="tv-success">✓ {success}</div>
                    )}

                    {/* Action tabs */}
                    <div className="tv-action-tabs">
                        {(["transfer", ...(isAdmin ? ["mint", "burn"] as const : []), "faucet"] as ActionTab[]).map(tab => (
                            <button
                                key={tab}
                                onClick={() => { setActionTab(tab); setError(null); setSuccess(null) }}
                                className="tv-action-tab"
                                data-active={actionTab === tab}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    {/* Action form */}
                    <div className="k-card tv-action-form">
                        {actionTab === "faucet" ? (
                            <p className="tv-action-form__hint">
                                Request free tokens from the faucet (if enabled by admin).
                            </p>
                        ) : (
                            <>
                                <div>
                                    <label className="tv-label">
                                        {actionTab === "burn" ? "Burn From Address" : "Recipient Address"}
                                    </label>
                                    <input
                                        type="text" value={toAddress}
                                        onChange={e => setToAddress(e.target.value)}
                                        placeholder={actionTab === "burn" ? "g1..." : "g1..."}
                                        className="tv-input" disabled={txLoading}
                                    />
                                </div>
                                <div>
                                    <label className="tv-label">Amount (smallest unit)</label>
                                    <input
                                        type="text" value={amount}
                                        onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                                        placeholder="e.g. 1000000"
                                        className="tv-input" disabled={txLoading}
                                    />
                                </div>
                            </>
                        )}

                        {/* Mint fee disclosure */}
                        {actionTab === "mint" && fee > 0n && (
                            <div className="tv-fee-disclosure">
                                💰 {feeDisclosure(mintAmount, token.symbol)}
                            </div>
                        )}

                        <button
                            onClick={handleAction}
                            disabled={txLoading}
                            className="tv-submit-btn"
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
        <div className="tv-meta-row">
            <span className="tv-meta-row__label">{label}</span>
            <span className={accent ? "tv-meta-row__value--accent" : "tv-meta-row__value"}>{value}</span>
        </div>
    )
}

import { useState } from "react"
import { useParams, useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import { GNO_CHAIN_ID, UGNOT_PER_GNOT } from "../lib/config"
import { fetchAccountInfo } from "../lib/account"
import { buildTransferMsg, buildMintMsgs, buildBurnMsg, buildApproveMsg, feeDisclosure, calculateFee, MAX_INT64, type AminoMsg } from "../lib/grc20"
import { buildCanonicalProposePayload } from "../lib/multisigTx"
import type { LayoutContext } from "../types/layout"
import "./proposetransaction.css"

type TxType = "send" | "call" | "grc20-transfer" | "grc20-mint" | "grc20-burn" | "grc20-approve"

export function ProposeTransaction() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNetworkNav()
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

    // GRC20 fields
    const [grcSymbol, setGrcSymbol] = useState("")
    const [grcTo, setGrcTo] = useState("")
    const [grcAmount, setGrcAmount] = useState("")

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

        let msgs: AminoMsg[] = []
        let type = ""

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

            msgs = [{
                type: "bank/MsgSend",
                value: {
                    from_address: address,
                    to_address: trimmedRecipient,
                    amount: [{ denom: "ugnot", amount: String(ugnotAmount) }],
                },
            }]
            type = "send"
        } else if (txType === "call") {
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

            msgs = [{
                type: "vm/MsgCall",
                value: {
                    caller: address,
                    send: sendCoins || "",
                    pkg_path: trimmedPkg,
                    func: trimmedFunc,
                    args: argsArray,
                },
            }]
            type = "call"
        } else if (txType.startsWith("grc20-")) {
            // GRC20 token operations
            const trimSym = grcSymbol.trim().toUpperCase()
            const trimTo = grcTo.trim()
            const trimAmt = grcAmount.trim()
            if (!trimSym) { setError("Token symbol required"); return }

            if (!trimTo || !trimAmt) { setError(txType === "grc20-approve" ? "Spender and amount required" : "Address and amount required"); return }

            // Amounts are entered in the token's smallest unit and stored on-chain
            // as int64. Above that ceiling the proposed tx fails on-chain with an
            // opaque "strconv.ParseInt: value out of range", so guard it here.
            let grcAmt: bigint
            try { grcAmt = BigInt(trimAmt) } catch { setError("Invalid amount — must be a whole number"); return }
            if (grcAmt > MAX_INT64) { setError(`Amount is too large — the on-chain maximum is ${MAX_INT64} (smallest unit).`); return }

            let grcMsgs: AminoMsg[]
            switch (txType) {
                case "grc20-transfer":
                    grcMsgs = [buildTransferMsg(address, trimSym, trimTo, String(grcAmt))]
                    break
                case "grc20-mint":
                    if (grcAmt + calculateFee(grcAmt) > MAX_INT64) { setError(`Amount is too large — the 2.5% mint fee pushes total supply past the on-chain maximum (${MAX_INT64}).`); return }
                    grcMsgs = buildMintMsgs(address, trimSym, trimTo, grcAmt)
                    break
                case "grc20-burn":
                    grcMsgs = [buildBurnMsg(address, trimSym, trimTo, String(grcAmt))]
                    break
                case "grc20-approve":
                    grcMsgs = [buildApproveMsg(address, trimSym, trimTo, String(grcAmt))]
                    break
                default: return
            }
            msgs = grcMsgs
            type = "call"
        }

        setLoading(true)
        setError(null)

        try {
            const accountInfo = await fetchAccountInfo(address)

            // Store the canonical sign-doc Adena actually signs (see lib/multisigTx),
            // so the backend A3 verifier reconstructs identical sign-bytes. The old
            // cosmos-shaped {amount,gas} fee + {type,value}-wrapped msgs diverged from
            // what Adena signed → A3 verify failed → enforce would brick signing.
            // GRC20 ops are vm/MsgCall contract calls too — they need the higher
            // call gas budget, not the cheap send budget (else broadcast OOGs).
            const isContractCall = txType === "call" || txType.startsWith("grc20-")
            const { msgsJson, feeJson } = buildCanonicalProposePayload(msgs, isContractCall)

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
        <div className="animate-fade-in ptx-page">
            <div>
                <button onClick={() => navigate(`/multisig/${address}`)} className="ptx-back-btn">
                    ← Back to Multisig
                </button>
                <h2 className="ptx-title">Propose Transaction</h2>
                <p className="ptx-from-address">
                    From: {address}
                </p>
            </div>

            {!auth.isAuthenticated && (
                <div className="k-dashed ptx-connect-prompt">
                    <p>
                        Connect your wallet to propose a transaction
                    </p>
                </div>
            )}

            <div className="ptx-tabs">
                {(["send", "call", "grc20-transfer", "grc20-mint", "grc20-burn", "grc20-approve"] as TxType[]).map(tab => {
                    const labels: Record<TxType, string> = {
                        send: "Send GNOT", call: "Contract Call",
                        "grc20-transfer": "🪙 Transfer", "grc20-mint": "🪙 Mint",
                        "grc20-burn": "🪙 Burn", "grc20-approve": "🪙 Approve",
                    }
                    return (
                        <button
                            key={tab}
                            onClick={() => setTxType(tab)}
                            className={`ptx-tab${txType === tab ? " ptx-tab--active" : ""}`}
                        >
                            {labels[tab]}
                        </button>
                    )
                })}
            </div>

            {/* Send GNOT form */}
            {txType === "send" && (
                <div className="k-card ptx-form-card">
                    <label className="k-label">Recipient Address</label>
                    <input
                        type="text"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        placeholder="g1recipient..."
                        disabled={loading}
                        className="ptx-input"
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
                        className="ptx-input"
                    />
                </div>
            )}

            {/* Contract Call form */}
            {txType === "call" && (
                <div className="k-card ptx-form-card">
                    <label className="k-label">Package Path</label>
                    <input
                        type="text"
                        value={pkgPath}
                        onChange={(e) => setPkgPath(e.target.value)}
                        placeholder="gno.land/r/demo/boards"
                        disabled={loading}
                        className="ptx-input"
                    />
                    <label className="k-label">Function Name</label>
                    <input
                        type="text"
                        value={funcName}
                        onChange={(e) => setFuncName(e.target.value)}
                        placeholder="CreateThread"
                        disabled={loading}
                        className="ptx-input"
                    />
                    <label className="k-label">Arguments (comma-separated)</label>
                    <input
                        type="text"
                        value={args}
                        onChange={(e) => setArgs(e.target.value)}
                        placeholder="arg1, arg2, arg3"
                        disabled={loading}
                        className="ptx-input"
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
                        className="ptx-input"
                    />
                    <p className="ptx-hint">
                        Optional GNOT to send with the contract call (e.g. for paid functions)
                    </p>
                </div>
            )}

            {/* GRC20 Token form */}
            {txType.startsWith("grc20-") && (
                <div className="k-card ptx-form-card">
                    <label className="k-label">Token Symbol</label>
                    <input
                        type="text" value={grcSymbol}
                        onChange={e => setGrcSymbol(e.target.value.toUpperCase())}
                        placeholder="e.g. SAM" maxLength={10}
                        disabled={loading} className="ptx-input"
                    />
                    <label className="k-label">
                        {txType === "grc20-approve" ? "Spender Address" : txType === "grc20-burn" ? "Burn From Address" : "Recipient Address"}
                    </label>
                    <input
                        type="text" value={grcTo}
                        onChange={e => setGrcTo(e.target.value)}
                        placeholder="g1..." disabled={loading}
                        className="ptx-input"
                    />
                    <label className="k-label">Amount (smallest unit)</label>
                    <input
                        type="text" value={grcAmount}
                        onChange={e => setGrcAmount(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="e.g. 1000000" disabled={loading}
                        className="ptx-input"
                        aria-invalid={BigInt(grcAmount.trim() || "0") > MAX_INT64}
                    />
                    {/* int64 ceiling warning */}
                    {BigInt(grcAmount.trim() || "0") > MAX_INT64 && (
                        <div className="ptx-fee-disclosure" style={{ color: "var(--color-warning)" }}>
                            ⚠ Amount exceeds the on-chain maximum ({MAX_INT64}). This proposal would fail when executed.
                        </div>
                    )}
                    {/* Mint fee disclosure */}
                    {txType === "grc20-mint" && grcAmount.trim() && BigInt(grcAmount.trim() || "0") > 0n && BigInt(grcAmount.trim() || "0") <= MAX_INT64 && (
                        <div className="ptx-fee-disclosure">
                            💰 {feeDisclosure(BigInt(grcAmount.trim()), grcSymbol.trim() || "TOKEN")}
                        </div>
                    )}
                </div>
            )}

            {/* Memo */}
            <div className="k-card ptx-form-card">
                <label className="k-label">Memo (optional)</label>
                <input
                    type="text"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="Optional memo..."
                    maxLength={256}
                    disabled={loading}
                    className="ptx-input"
                />
            </div>

            {/* Submit */}
            <div className="ptx-submit-row">
                <button
                    className="k-btn-primary"
                    onClick={handlePropose}
                    disabled={loading || !auth.isAuthenticated}
                    style={{ opacity: !loading && auth.isAuthenticated ? 1 : 0.5 }}
                >
                    {loading ? "Proposing..." : txType === "send" ? "Propose Send" : txType.startsWith("grc20-") ? `Propose ${txType.replace("grc20-", "").replace(/^./, c => c.toUpperCase())}` : "Propose Call"}
                </button>
                <button className="k-btn-secondary" onClick={() => navigate(`/multisig/${address}`)}>
                    Cancel
                </button>
            </div>

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}




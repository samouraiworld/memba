import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useParams, useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import { GNO_CHAIN_ID, UGNOT_PER_GNOT } from "../lib/config"
import { fetchAccountInfo } from "../lib/account"
import { buildTransferMsg, buildMintMsgs, buildBurnMsg, buildApproveMsg, feeDisclosure, calculateFee, FALLBACK_GAS_PRICE, MAX_GAS_WANTED, MAX_INT64, networkGasPriceFresh, type AminoMsg, type GasPrice } from "../lib/grc20"
import { buildCanonicalProposePayload } from "../lib/multisigTx"
import type { LayoutContext } from "../types/layout"
import "./proposetransaction.css"

type TxType = "send" | "call" | "grc20-transfer" | "grc20-mint" | "grc20-burn" | "grc20-approve"

/** Parse GNOT without floating point, so the proposal contains exactly the amount reviewed. */
function parseGnotUgnot(input: string): bigint {
    const value = input.trim()
    const match = /^(\d+)(?:\.(\d+))?$/.exec(value)
    if (!match) throw new Error("Enter a plain GNOT amount without signs, separators, or units")
    const fraction = match[2] ?? ""
    if (fraction.length > 6) throw new Error("GNOT amounts support at most 6 decimal places")
    const whole = match[1].replace(/^0+/, "") || "0"
    if (whole.length > 13) throw new Error("Amount exceeds the on-chain maximum")
    const ugnot = BigInt(whole) * BigInt(UGNOT_PER_GNOT) + BigInt(fraction.padEnd(6, "0") || "0")
    if (ugnot > MAX_INT64) throw new Error("Amount exceeds the on-chain maximum")
    return ugnot
}

function parseGrc20Units(input: string): bigint {
    const value = input.trim()
    if (!/^\d+$/.test(value)) throw new Error("Invalid amount — enter a nonnegative whole number")
    if ((value.replace(/^0+/, "") || "0").length > 19) throw new Error(`Amount is too large — the on-chain maximum is ${MAX_INT64} (smallest unit).`)
    const amount = BigInt(value)
    if (amount > MAX_INT64) throw new Error(`Amount is too large — the on-chain maximum is ${MAX_INT64} (smallest unit).`)
    return amount
}

export function ProposeTransaction() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNetworkNav()
    const { auth, adena } = useOutletContext<LayoutContext>()
    const queryClient = useQueryClient()
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
    const [nativeGas, setNativeGas] = useState("10000000")
    // The fee follows the gas limit at twice a fresh network price until the member types their own;
    // clearing it returns to the priced one. A price that cannot be read falls back to the default one.
    const [typedFee, setTypedFee] = useState<string | null>(null)
    const [gasPrice, setGasPrice] = useState<GasPrice | null>(null)
    useEffect(() => {
        let active = true
        networkGasPriceFresh().then((price) => { if (active) setGasPrice(price) }, () => { if (active) setGasPrice(FALLBACK_GAS_PRICE) })
        return () => { active = false }
    }, [])
    const gasOk = /^[1-9][0-9]*$/.test(nativeGas) && Number(nativeGas) <= MAX_GAS_WANTED
    const pricedFee = gasPrice && gasOk ? String(nativeProposalFee(Number(nativeGas), gasPrice)) : ""
    const nativeFee = typedFee ?? pricedFee
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    let grcPreviewAmount: bigint | null = null
    let grcPreviewError: string | null = null
    if (grcAmount.trim()) {
        try { grcPreviewAmount = parseGrc20Units(grcAmount) }
        catch (err) { grcPreviewError = (err as Error).message }
    }

    const handlePropose = async () => {
        if (!address) return
        if (!ENABLE_NATIVE_GNO_MULTISIG) { setError("Native multisig proposals are on hold pending release approval"); return }
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
            let ugnotAmount: bigint
            try { ugnotAmount = parseGnotUgnot(amount) }
            catch (err) { setError((err as Error).message); return }
            if (ugnotAmount === 0n) {
                setError("Amount must be greater than 0")
                return
            }

            msgs = [{
                type: "bank/MsgSend",
                value: {
                    from_address: address,
                    to_address: trimmedRecipient,
                    amount: [{ denom: "ugnot", amount: ugnotAmount.toString() }],
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
                let sendUgnot: bigint
                try { sendUgnot = parseGnotUgnot(sendAmount) }
                catch (err) { setError((err as Error).message); return }
                if (sendUgnot > 0n) sendCoins = `${sendUgnot}ugnot`
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
            try { grcAmt = parseGrc20Units(trimAmt) }
            catch (err) { setError((err as Error).message); return }
            // Zero approval revokes an existing allowance; every other token operation moves or creates tokens.
            if (grcAmt === 0n && txType !== "grc20-approve") { setError("Amount must be greater than 0"); return }

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
            const info = await api.multisigInfo({ authToken: auth.token, chainId: GNO_CHAIN_ID, multisigAddress: address })
            if (!info.multisig) throw new Error("Cannot verify wallet identity")
            if (!isNativeMultisig(info.multisig.pubkeyJson)) throw new Error("Legacy multisig history cannot create executable proposals on Gno")
            const accountInfo = await fetchAccountInfo(address)

            // Store the canonical sign-doc Adena actually signs (see lib/multisigTx),
            // so the backend A3 verifier reconstructs identical sign-bytes. The old
            // cosmos-shaped {amount,gas} fee + {type,value}-wrapped msgs diverged from
            // what Adena signed → A3 verify failed → enforce would brick signing.
            // GRC20 ops are vm/MsgCall contract calls too — they need the higher
            // call gas budget, not the cheap send budget (else broadcast OOGs).
            const isContractCall = txType === "call" || txType.startsWith("grc20-")
            const { msgsJson } = buildCanonicalProposePayload(msgs, isContractCall)
            const feeJson = nativeFeeJSON(nativeGas, nativeFee)

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

            // A cache refresh failure must not report a successfully created proposal as failed.
            await queryClient.invalidateQueries({ queryKey: ["multisig"] }).catch(() => {})
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
                    <button type="button" className="k-btn-primary" onClick={() => void adena.connect()}>Connect wallet</button>
                </div>
            )}
            {!ENABLE_NATIVE_GNO_MULTISIG && <p role="status">Native multisig proposals are on hold pending release approval. Legacy accounts remain read-only history.</p>}

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
                        aria-label="Recipient address"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        placeholder="g1recipient..."
                        disabled={loading}
                        className="ptx-input"
                    />
                    <label className="k-label">Amount (GNOT)</label>
                    <input
                        type="text"
                        aria-label="Amount in GNOT"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="1.0"
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
                        aria-label="Package path"
                        value={pkgPath}
                        onChange={(e) => setPkgPath(e.target.value)}
                        placeholder="gno.land/r/demo/boards"
                        disabled={loading}
                        className="ptx-input"
                    />
                    <label className="k-label">Function Name</label>
                    <input
                        type="text"
                        aria-label="Function name"
                        value={funcName}
                        onChange={(e) => setFuncName(e.target.value)}
                        placeholder="CreateThread"
                        disabled={loading}
                        className="ptx-input"
                    />
                    <label className="k-label">Arguments (comma-separated)</label>
                    <input
                        type="text"
                        aria-label="Arguments, comma-separated"
                        value={args}
                        onChange={(e) => setArgs(e.target.value)}
                        placeholder="arg1, arg2, arg3"
                        disabled={loading}
                        className="ptx-input"
                    />
                    <label className="k-label">Send Amount (optional GNOT)</label>
                    <input
                        type="text"
                        aria-label="Optional send amount in GNOT"
                        inputMode="decimal"
                        value={sendAmount}
                        onChange={(e) => setSendAmount(e.target.value)}
                        placeholder="0"
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
                        type="text" aria-label="Token symbol" value={grcSymbol}
                        onChange={e => setGrcSymbol(e.target.value.toUpperCase())}
                        placeholder="e.g. SAM" maxLength={10}
                        disabled={loading} className="ptx-input"
                    />
                    <label className="k-label">
                        {txType === "grc20-approve" ? "Spender Address" : txType === "grc20-burn" ? "Burn From Address" : "Recipient Address"}
                    </label>
                    <input
                        type="text" aria-label={txType === "grc20-approve" ? "Spender address" : txType === "grc20-burn" ? "Burn from address" : "Recipient address"} value={grcTo}
                        onChange={e => setGrcTo(e.target.value)}
                        placeholder="g1..." disabled={loading}
                        className="ptx-input"
                    />
                    <label className="k-label">Amount (smallest unit)</label>
                    <input
                        type="text" aria-label="Token amount in smallest unit" value={grcAmount}
                        onChange={e => setGrcAmount(e.target.value)}
                        placeholder="e.g. 1000000" disabled={loading} inputMode="numeric"
                        className="ptx-input"
                        aria-invalid={Boolean(grcPreviewError) || (grcPreviewAmount === 0n && txType !== "grc20-approve")}
                    />
                    {grcPreviewError && (
                        <div className="ptx-fee-disclosure" style={{ color: "var(--color-warning)" }}>
                            ⚠ {grcPreviewError}
                        </div>
                    )}
                    {/* Mint fee disclosure */}
                    {txType === "grc20-mint" && grcPreviewAmount !== null && grcPreviewAmount > 0n && (
                        <div className="ptx-fee-disclosure">
                            💰 {feeDisclosure(grcPreviewAmount, grcSymbol.trim() || "TOKEN")}
                        </div>
                    )}
                    {txType === "grc20-approve" && <p className="ptx-hint">Set the amount to 0 to revoke a spender's allowance.</p>}
                </div>
            )}

            {/* Memo */}
            {ENABLE_NATIVE_GNO_MULTISIG && <div className="k-card ptx-form-card">
                <p>{typedFee !== null
                    ? "You set this fee. Clear it to return to the network price."
                    : gasPrice === FALLBACK_GAS_PRICE
                        ? "The network gas price couldn't be read, so this fee uses a default price. Check it."
                        : "The fee is twice the network gas price for this gas limit, so it still pays if the price rises while signatures are collected."}
                {" "}Every member signs this exact fee: it can be changed only before you press Propose.</p>
                <label>Native gas limit <input value={nativeGas} onChange={e => setNativeGas(e.target.value)} disabled={loading} /></label>
                <label>Native fee (ugnot) <input value={nativeFee} placeholder={gasPrice ? undefined : "Reading the network price…"} onChange={e => setTypedFee(e.target.value === "" ? null : e.target.value)} disabled={loading} /></label>
                {typedFee === null && gasPrice && !gasOk && <p role="status">Enter a whole gas limit up to {MAX_GAS_WANTED.toLocaleString("en-US")} to price the fee.</p>}
            </div>}
            <div className="k-card ptx-form-card">
                <label className="k-label">Memo (optional)</label>
                <input
                    type="text"
                    aria-label="Optional memo"
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
                    disabled={loading || !auth.isAuthenticated || !ENABLE_NATIVE_GNO_MULTISIG || !nativeFee}
                    style={{ opacity: !loading && auth.isAuthenticated && ENABLE_NATIVE_GNO_MULTISIG && nativeFee ? 1 : 0.5 }}
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


import { ENABLE_NATIVE_GNO_MULTISIG } from "../lib/config"
import { isNativeMultisig, nativeFeeJSON, nativeProposalFee } from "../lib/nativeMultisig"

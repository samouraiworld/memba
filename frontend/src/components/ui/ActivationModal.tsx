import { useEffect, useRef, useState } from "react"
import { ShieldCheck, ArrowRight, Wallet, Spinner } from "@phosphor-icons/react"
import { doContractBroadcast, networkGasPriceFresh } from "../../lib/grc20"
import { ACTIVATION_MEMO, ACTIVATION_NOT_SEEN, ACTIVATION_SEND_UGNOT, activationCosts, activationMsgs, activationOnChain } from "../../lib/activation"
import { chainPublicKey } from "../../lib/account"
import { formatUgnotExact } from "../../lib/dao/v2Budget"
import { isUserCancellation } from "../../lib/userCancellation"
import "./ActivationModal.css"

interface ActivationModalProps {
    address: string
    rawUgnot?: bigint
    balanceLoading?: boolean
    balanceError?: string | null
    onRetryBalance?: () => void
    faucetUrl: string
    onSuccess: () => void
    /** When set, renders a "Not now" escape hatch. Passed ONLY from the
     *  signed-out entry point (login refused with AUTH-ACTIVATE-01) — a failed
     *  sign-in must never lock the user out of read-only browsing. The
     *  authenticated address-only flow omits it and stays forced. */
    onDismiss?: () => void
}

export function ActivationModal({ address, rawUgnot, balanceLoading, balanceError, onRetryBalance, faucetUrl, onSuccess, onDismiss }: ActivationModalProps) {
    const [activating, setActivating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // The balance hook retains its last value during refresh. That value must
    // not authorize a new transaction until the current check succeeds.
    const checkedUgnot = balanceLoading || balanceError ? undefined : rawUgnot
    // Aborted when the dialog goes away: a wait still running must not reload the page after that.
    const shown = useRef<AbortController | null>(null)
    useEffect(() => {
        const current = new AbortController()
        shown.current = current
        return () => current.abort()
    }, [])

    const handleActivate = async () => {
        if (checkedUgnot === undefined || checkedUgnot <= 0n) return
        const gone = shown.current?.signal
        setActivating(true)
        setError(null)
        try {
            // Already active on chain (an activation that landed after the last wait gave up): nothing to send.
            if (await chainPublicKey(address).then(Boolean, () => false)) {
                if (!gone?.aborted) onSuccess()
                return
            }
            // W2.1: the guarded broadcaster, so RPC trust, the chain check and
            // the confirmation dialog apply as to any write. The fee is read at
            // the network's price now; the balance must hold it and the 1 ugnot.
            let price
            try { price = await networkGasPriceFresh() } catch { throw new Error("Couldn't read the network fee. Nothing was sent; try again in a moment.") }
            const { gasWanted, feeUgnot } = activationCosts(price)
            const needed = BigInt(feeUgnot) + ACTIVATION_SEND_UGNOT
            if (checkedUgnot < needed) throw new Error(`Activation needs at least ${formatUgnotExact(Number(needed))}: the network fee and the 1 ugnot sent to yourself. Add GNOT to this address, then activate.`)
            await doContractBroadcast(activationMsgs(address), ACTIVATION_MEMO, { gasWanted, gasFee: feeUgnot })
            // Adena answers at broadcast: the reload that follows must find the key on chain.
            const visible = await activationOnChain(address, gone)
            if (gone?.aborted) return
            if (!visible) throw new Error(`${ACTIVATION_NOT_SEEN} Select Activate My Wallet again in a few seconds: Memba checks the network first, and sends nothing if it already shows your address as active.`)
            onSuccess()
        } catch (err: unknown) {
            // A cancel in the confirmation dialog or a reject in Adena sends nothing.
            setError(isUserCancellation(err) ? "Activation cancelled. Nothing was sent." : err instanceof Error ? err.message : String(err))
        } finally {
            setActivating(false)
        }
    }

    return (
        <div className="activation-modal-overlay">
            <div className="activation-modal">
                <div className="activation-modal-header">
                    <div className="activation-icon-ring">
                        <ShieldCheck size={32} weight="duotone" className="text-accent" />
                    </div>
                    <h2>Secure Network Activation</h2>
                </div>

                <div className="activation-modal-body">
                    <p className="activation-desc">
                        Welcome to Memba! Your wallet has received tokens but hasn't fully
                        activated on the Gno network yet.
                    </p>

                    <div className="activation-steps">
                        <div className="activation-step">
                            <div className="step-number">1</div>
                            <div className="step-text">
                                <strong>Why is this needed?</strong>
                                <span>Adena requires a public key to sign in securely. One tiny on-chain transaction registers your key.</span>
                            </div>
                        </div>
                        <div className="activation-step">
                            <div className="step-number">2</div>
                            <div className="step-text">
                                <strong>What happens?</strong>
                                <span>Memba sends 1 ugnot from your address to itself. Only the network fee is spent, and nothing is written to any realm or profile. Adena shows it as a Transfer without its recipient or amount. Memba signs you in right after.</span>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="activation-error">
                            <span className="error-text">{error}</span>
                        </div>
                    )}
                </div>

                <div className="activation-modal-footer">
                    {checkedUgnot === undefined ? (
                        <div role="status">
                            <p>{balanceError ? "Could not check your GNOT balance. Try again before activating." : balanceLoading ? "Checking your GNOT balance before activation…" : "Your GNOT balance is unavailable. Check it before activating."}</p>
                            {onRetryBalance && <button type="button" className="k-button k-button-outline" onClick={onRetryBalance} disabled={balanceLoading}>Retry balance check</button>}
                        </div>
                    ) : checkedUgnot > 0n ? (
                        <button
                            className="k-button k-button-primary activation-btn"
                            onClick={handleActivate}
                            disabled={activating}
                        >
                            {activating ? (
                                <>
                                    <Spinner size={18} className="spin" />
                                    <span>Activating...</span>
                                </>
                            ) : (
                                <>
                                    <Wallet size={18} weight="bold" />
                                    <span>Activate My Wallet</span>
                                    <ArrowRight size={16} weight="bold" />
                                </>
                            )}
                        </button>
                    ) : (
                        <div className="activation-faucet-nudge">
                            <p>You need a tiny amount of GNOT to activate.</p>
                            <a
                                href={faucetUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="k-button k-button-outline"
                            >
                                Get GNOT from Faucet
                            </a>
                        </div>
                    )}
                    {onDismiss && (
                        <button
                            type="button"
                            className="activation-dismiss"
                            onClick={onDismiss}
                            disabled={activating}
                        >
                            Not now — keep browsing
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

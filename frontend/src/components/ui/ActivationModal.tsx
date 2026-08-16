import { useState } from "react"
import { ShieldCheck, ArrowRight, Wallet, Spinner } from "@phosphor-icons/react"
import { doContractBroadcast } from "../../lib/grc20"
import { ACTIVATION_PROFILE_REALM } from "../../lib/config"
import "./ActivationModal.css"

interface ActivationModalProps {
    address: string
    rawUgnot: bigint
    faucetUrl: string
    onSuccess: () => void
    /** When set, renders a "Not now" escape hatch. Passed ONLY from the
     *  signed-out entry point (login refused with AUTH-ACTIVATE-01) — a failed
     *  sign-in must never lock the user out of read-only browsing. The
     *  authenticated address-only flow omits it and stays forced. */
    onDismiss?: () => void
}

export function ActivationModal({ address, rawUgnot, faucetUrl, onSuccess, onDismiss }: ActivationModalProps) {
    const [activating, setActivating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleActivate = async () => {
        setActivating(true)
        setError(null)
        try {
            // W2.1: ride the guarded broadcaster — RPC-trust, wrong-chain and
            // A6 confirmation apply to activation like any write. The tx is a
            // MsgCall, NOT a bank send: Adena's DoContract rejects the
            // bank/MsgSend TYPE outright (#1078), and any first transaction
            // registers the key — this one writes a per-caller breadcrumb on
            // the vendored profile realm and touches nothing else.
            await doContractBroadcast(
                [{
                    type: "vm/MsgCall",
                    value: {
                        caller: address,
                        send: "",
                        pkg_path: ACTIVATION_PROFILE_REALM,
                        func: "SetStringField",
                        args: ["memba:activated", "1"],
                    },
                }],
                "Memba Network Activation",
            )

            onSuccess()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err))
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
                                <span>A small note is written to your own on-chain profile — nothing is sent anywhere. Memba will automatically sign you in right after.</span>
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
                    {rawUgnot > 0 ? (
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

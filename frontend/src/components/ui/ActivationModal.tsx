import { useState } from "react"
import { ShieldCheck, ArrowRight, Wallet, Spinner } from "@phosphor-icons/react"
import { doContractBroadcast } from "../../lib/grc20"
import "./ActivationModal.css"

interface ActivationModalProps {
    address: string
    rawUgnot: bigint
    faucetUrl: string
    onSuccess: () => void
}

export function ActivationModal({ address, rawUgnot, faucetUrl, onSuccess }: ActivationModalProps) {
    const [activating, setActivating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleActivate = async () => {
        setActivating(true)
        setError(null)
        try {
            // W2.1: ride the guarded broadcaster — RPC-trust, wrong-chain and
            // A6 confirmation apply to the activation self-send like any write.
            await doContractBroadcast(
                [{
                    type: "bank/MsgSend",
                    value: {
                        from_address: address,
                        to_address: address,
                        amount: [{ denom: "ugnot", amount: "1" }],
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
            <div className="activation-modal k-modal-glass">
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
                                <span>Adena requires a public key to sign in securely. A free, 1-ugnot self-send registers your key.</span>
                            </div>
                        </div>
                        <div className="activation-step">
                            <div className="step-number">2</div>
                            <div className="step-text">
                                <strong>What happens?</strong>
                                <span>You will send 1 ugnot to your own address. Memba will automatically sign you in right after.</span>
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
                </div>
            </div>
        </div>
    )
}

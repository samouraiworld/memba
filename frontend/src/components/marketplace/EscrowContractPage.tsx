/**
 * EscrowContractPage — the shareable page of one escrow contract:
 * /:network/marketplace/services/contract/:contractId.
 *
 * escrow_v4 lists contracts by client only, so this link is how a freelancer
 * reaches a contract: the client shares it after creating the contract (the
 * hire flow lands here with `state.created`). Anyone can open it; the actions
 * offered depend on the connected wallet (EscrowContractDetail). The route is
 * registered only while the Services lane is live on the network.
 */
import { Link, useLocation, useParams } from "react-router-dom"
import { useAdena } from "../../hooks/useAdena"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { escrowContractPath } from "../../lib/marketplace/escrowActions"
import { EscrowContractDetail } from "./EscrowContractDetail"
import "./escrow.css"

const CONTRACT_ID = /^(0|[1-9]\d{0,8})$/

export default function EscrowContractPage() {
    const { contractId = "" } = useParams<{ contractId: string }>()
    const { state } = useLocation()
    const adena = useAdena()
    const np = useNetworkPath()
    const valid = CONTRACT_ID.test(contractId)
    const justCreated = (state as { created?: unknown } | null)?.created === true
    const shareUrl = valid ? `${window.location.origin}${np(escrowContractPath(contractId))}` : ""

    return (
        <section className="k-card" data-testid="escrow-contract-page" style={{ padding: "20px" }}>
            <Link to={np("marketplace/services")} className="escrow-muted">← Services</Link>
            <h2 style={{ margin: "8px 0 0", fontSize: "20px", color: "var(--color-text)" }}>
                {valid ? `Escrow contract ${contractId}` : "Escrow contract"}
            </h2>
            {valid ? (
                <EscrowContractDetail
                    id={contractId}
                    caller={adena.connected ? adena.address : ""}
                    shareUrl={shareUrl}
                    justCreated={justCreated}
                />
            ) : (
                <p className="escrow-muted" role="alert">This link does not name a contract: a contract id is a whole number such as 0, 1 or 42.</p>
            )}
        </section>
    )
}

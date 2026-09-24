import { useEffect, useState } from "react"
import { useAdena } from "../../hooks/useAdena"
import { useNetworkNav } from "../../hooks/useNetworkNav"
import { MEMBA_DAO, isEscrowValid, isServicesEnabled } from "../../lib/config"
import { getCurrentBlock } from "../../lib/dao/proposalDates"
import { hireAvailability, readEscrowPauseState } from "../../lib/marketplace/escrowState"
import { EmptyState } from "../ui/EmptyState"
import { formatGnotCompact } from "../../lib/formatGnot"
import { nftFallbackUri } from "../../lib/nftFallbackArt"
import { HireServiceModal, type Service } from "./HireServiceModal"
import { EscrowContractPanel } from "./EscrowContractPanel"
import { HireByAddressForm } from "./HireByAddressForm"
import { escrowContractPath } from "../../lib/marketplace/escrowActions"
import { ErrorToast } from "../ui/ErrorToast"

// Real service listings will come from the on-chain services engine once the lane is
// production-ready. Until then the lane renders an honest empty state — never fake
// listings with placeholder addresses (W0.2).
const SERVICES: Service[] = []

/**
 * Whether the escrow realm takes new contracts, from its on-chain pause state.
 * "off" when the lane is gated here (no read then: the realm may not exist).
 * Anything but "open" keeps hiring shut; a failed read shuts it too.
 */
type Hiring = { state: "off" } | { state: "loading" } | { state: "open" } | { state: "closed"; reason: string }

function useEscrowHiring(): Hiring {
    const live = isServicesEnabled() && isEscrowValid()
    const [hiring, setHiring] = useState<Hiring>({ state: "loading" })
    useEffect(() => {
        if (!live) return
        let cancelled = false
        Promise.all([readEscrowPauseState(MEMBA_DAO.escrowPath), getCurrentBlock()])
            .then(([pause, height]): Hiring => {
                // Pause only: the per-client cap is checked in the hire dialog, for the connected wallet.
                const a = hireAvailability(pause, 0, height)
                return a.available ? { state: "open" } : { state: "closed", reason: a.reason }
            })
            .catch((err: unknown): Hiring => ({
                state: "closed",
                reason: `Could not read the escrow contract's pause state (${err instanceof Error ? err.message : String(err)}). Hiring is unavailable until it can be read.`,
            }))
            .then((h) => { if (!cancelled) setHiring(h) })
        return () => { cancelled = true }
    }, [live])
    return live ? hiring : { state: "off" }
}

export default function ServiceLane() {
    const adena = useAdena()
    const hiring = useEscrowHiring()
    const nav = useNetworkNav()
    
    const [hiringService, setHiringService] = useState<Service | null>(null)
    const [byAddress, setByAddress] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)
    const [toast, setToast] = useState<string | null>(null)
    // Bumped after a hire lands, so the contract panel re-reads "My contracts" and opens the new one.
    const [created, setCreated] = useState<{ id: string | null; n: number }>({ id: null, n: 0 })

    const handleHireClick = (service: Service) => {
        if (hiring.state !== "open") return
        if (!adena.connected || !adena.address) {
            setToast("Please connect your wallet first.")
            return
        }
        setHiringService(service)
    }

    const openHireByAddress = () => {
        if (hiring.state !== "open") return
        if (!adena.connected || !adena.address) {
            setToast("Please connect your wallet first.")
            return
        }
        setNotice(null)
        setByAddress(true)
    }

    return (
        <div className="animate-fade-in">
            <div className="um-lane-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <h2 className="um-lane-title">Verified Services</h2>
                {hiring.state !== "off" && !byAddress && (
                    <button className="k-btn-primary" onClick={openHireByAddress} disabled={hiring.state !== "open"} data-testid="hire-by-address-open">
                        Hire by address
                    </button>
                )}
            </div>

            {hiring.state === "closed" && (
                <div className="k-error-banner" role="alert" data-testid="escrow-hiring-closed" style={{ marginBottom: "16px" }}>
                    {hiring.reason}
                </div>
            )}
            
            {notice && <p role="status" data-testid="hire-notice" style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>{notice}</p>}

            {byAddress && (
                <HireByAddressForm
                    caller={adena.connected ? adena.address : ""}
                    closedReason={hiring.state === "open" ? null : hiring.state === "closed" ? hiring.reason : "Checking whether escrow takes new contracts..."}
                    onCancel={() => setByAddress(false)}
                    onReview={(svc, totalUgnot) => setHiringService({
                        id: "by-address",
                        title: svc.title,
                        freelancer: svc.freelancer,
                        description: svc.description,
                        priceUgnot: Number(totalUgnot),
                        milestones: svc.milestones,
                        category: "",
                        image: "",
                    })}
                />
            )}

            {SERVICES.length === 0 && !byAddress && (
                <EmptyState
                    icon="ti-briefcase"
                    title="No services yet"
                    body={hiring.state === "off"
                        ? "The Services lane is coming soon — real on-chain listings will appear here."
                        : "No public listings yet. To work with someone you already know, hire them by address."}
                />
            )}

            <div className="um-grid">
                {SERVICES.map(svc => (
                    <div key={svc.id} className="k-card" style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", border: "1px solid var(--color-border)" }}>
                        <div style={{ width: "100%", height: "140px", position: "relative", backgroundColor: "var(--color-bg-tertiary)", overflow: "hidden" }}>
                            <img src={nftFallbackUri(svc.id)} alt={svc.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "64px", background: "rgba(0,0,0,0.4)" }}>
                                {svc.image}
                            </div>
                        </div>
                        <div style={{ padding: "20px", flex: 1, display: "flex", flexDirection: "column" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                                <h3 style={{ margin: 0, fontSize: "18px", color: "var(--color-text)" }}>{svc.title}</h3>
                                <span style={{ fontSize: "12px", background: "var(--color-bg-tertiary)", padding: "4px 8px", borderRadius: "12px", color: "var(--color-text-muted)" }}>
                                    {svc.category}
                                </span>
                            </div>
                            <p style={{ fontSize: "14px", color: "var(--color-text-muted)", marginBottom: "20px", flex: 1, lineHeight: 1.5 }}>
                                {svc.description}
                            </p>
                            
                            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "16px", marginBottom: "16px" }}>
                                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "4px" }}>Starting at</div>
                                <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-primary)" }}>
                                    {formatGnotCompact(svc.priceUgnot)} GNOT
                                </div>
                            </div>

                            <button className="k-btn-secondary" style={{ width: "100%" }} onClick={() => handleHireClick(svc)} disabled={hiring.state !== "open"}>
                                Hire Freelancer
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <EscrowContractPanel caller={adena.connected ? adena.address : ""} createdContract={created} />

            {hiringService && (
                <HireServiceModal 
                    service={hiringService}
                    caller={adena.address}
                    onClose={() => setHiringService(null)}
                    onSuccess={(contractId) => {
                        setHiringService(null)
                        setByAddress(false)
                        if (contractId) {
                            // The contract's own page: its link is what the freelancer needs.
                            nav(escrowContractPath(contractId), { state: { created: true } })
                            return
                        }
                        setCreated((c) => ({ id: contractId, n: c.n + 1 }))
                        setNotice("The escrow contract was created, but it could not be read back yet. It will appear under My contracts below: open it there to get the link for your freelancer.")
                    }}
                />
            )}
            <ErrorToast message={toast} onDismiss={() => setToast(null)} />
        </div>
    )
}

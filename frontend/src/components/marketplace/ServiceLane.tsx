import { useEffect, useState } from "react"
import { useAdena } from "../../hooks/useAdena"
import { useNetworkNav } from "../../hooks/useNetworkNav"
import { MEMBA_DAO, isEscrowValid, isServicesEnabled } from "../../lib/config"
import { getCurrentBlock } from "../../lib/dao/proposalDates"
import { hireAvailability, readEscrowPauseState } from "../../lib/marketplace/escrowState"
import { EmptyState } from "../ui/EmptyState"
import { HireServiceModal, type Service } from "./HireServiceModal"
import { EscrowContractPanel } from "./EscrowContractPanel"
import { HireByAddressForm } from "./HireByAddressForm"
import { escrowContractPath } from "../../lib/marketplace/escrowActions"
import { CURATED_SERVICES, type CuratedService } from "../../lib/marketplace/curatedServices"
import type { HireDraft } from "../../lib/marketplace/hireByAddress"
import { CuratedServiceCard } from "./CuratedServiceCard"
import { ErrorToast } from "../ui/ErrorToast"

// Listings are the reviewed curated entries in lib/marketplace/curatedServices.ts only:
// never fake listings with placeholder addresses (W0.2). There is no on-chain services
// registry; anyone else is hired by address.

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
    // The open Hire by address form: free-form, or a curated listing's (freelancer locked).
    const [byAddress, setByAddress] = useState<{ key: string; initial?: Partial<HireDraft>; locked?: string; heading?: string } | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [toast, setToast] = useState<string | null>(null)
    // Bumped after a hire lands, so the contract panel re-reads "My contracts" and opens the new one.
    const [created, setCreated] = useState<{ id: string | null; n: number }>({ id: null, n: 0 })

    const openHireByAddress = (curated?: CuratedService) => {
        if (hiring.state !== "open") return
        if (!adena.connected || !adena.address) {
            setToast("Please connect your wallet first.")
            return
        }
        setNotice(null)
        setByAddress(curated
            ? { key: curated.id, initial: { title: curated.titlePrefix }, locked: curated.freelancer, heading: `Hire ${curated.title}` }
            : { key: "free" })
    }
    // Curated listings follow the lane's own gate: none unless the lane is live on this network.
    const curated = hiring.state === "off" ? [] : CURATED_SERVICES

    return (
        <div className="animate-fade-in">
            <div className="um-lane-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <h2 className="um-lane-title">Verified Services</h2>
                {hiring.state !== "off" && !byAddress && (
                    <button className="k-btn-primary" onClick={() => openHireByAddress()} disabled={hiring.state !== "open"} data-testid="hire-by-address-open">
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
                    key={byAddress.key}
                    initial={byAddress.initial}
                    lockedFreelancer={byAddress.locked}
                    heading={byAddress.heading}
                    caller={adena.connected ? adena.address : ""}
                    closedReason={hiring.state === "open" ? null : hiring.state === "closed" ? hiring.reason : "Checking whether escrow takes new contracts..."}
                    onCancel={() => setByAddress(null)}
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

            {curated.length === 0 && !byAddress && (
                <EmptyState
                    icon="ti-briefcase"
                    title="No services yet"
                    body={hiring.state === "off"
                        ? "The Services lane is coming soon — real on-chain listings will appear here."
                        : "No listings yet. To work with someone you already know, hire them by address."}
                />
            )}

            {curated.length > 0 && !byAddress && (
                <div className="um-grid" data-testid="curated-services">
                    {curated.map((svc) => (
                        <CuratedServiceCard key={svc.id} service={svc} disabled={hiring.state !== "open"} onHire={() => openHireByAddress(svc)} />
                    ))}
                </div>
            )}

            <EscrowContractPanel caller={adena.connected ? adena.address : ""} createdContract={created} />

            {hiringService && (
                <HireServiceModal 
                    service={hiringService}
                    caller={adena.address}
                    onClose={() => setHiringService(null)}
                    onSuccess={(contractId) => {
                        setHiringService(null)
                        setByAddress(null)
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

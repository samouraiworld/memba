import { useState } from "react"
import { useAdena } from "../../hooks/useAdena"
import { EmptyState } from "../ui/EmptyState"
import { formatGnotCompact } from "../../lib/formatGnot"
import { nftFallbackUri } from "../../lib/nftFallbackArt"
import { HireServiceModal, type Service } from "./HireServiceModal"
import { ErrorToast } from "../ui/ErrorToast"

// Real service listings will come from the on-chain services engine once the lane is
// production-ready. Until then the lane renders an honest empty state — never fake
// listings with placeholder addresses (W0.2).
const SERVICES: Service[] = []

export default function ServiceLane() {
    const adena = useAdena()
    
    const [hiringService, setHiringService] = useState<Service | null>(null)
    const [toast, setToast] = useState<string | null>(null)

    const handleHireClick = (service: Service) => {
        if (!adena.connected || !adena.address) {
            setToast("Please connect your wallet first.")
            return
        }
        setHiringService(service)
    }

    return (
        <div className="animate-fade-in">
            <div className="um-lane-header">
                <h2 className="um-lane-title">Verified Services</h2>
            </div>
            
            {SERVICES.length === 0 && (
                <EmptyState
                    icon="ti-briefcase"
                    title="No services yet"
                    body="The Services lane is coming soon — real on-chain listings will appear here."
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

                            <button className="k-btn-secondary" style={{ width: "100%" }} onClick={() => handleHireClick(svc)}>
                                Hire Freelancer
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {hiringService && (
                <HireServiceModal 
                    service={hiringService} 
                    onClose={() => setHiringService(null)}
                    onSuccess={() => {
                        setHiringService(null)
                        alert(`Success! Escrow contract created for ${hiringService.title}.`)
                    }}
                />
            )}
            <ErrorToast message={toast} onDismiss={() => setToast(null)} />
        </div>
    )
}

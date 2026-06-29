import { useState } from "react"
import { useAdena } from "../../hooks/useAdena"
import { formatGnotCompact } from "../../lib/formatGnot"
import { nftFallbackUri } from "../../lib/nftFallbackArt"
import { HireServiceModal, type Service } from "./HireServiceModal"

// Mock services for MVP
const MOCK_SERVICES: Service[] = [
    {
        id: "svc-1",
        title: "Smart Contract Audit",
        freelancer: "g1samouraicoop", // Dummy address
        description: "Full security audit of your Gno.land smart contract by the Samouraï Coop experts. Includes a detailed report and fix recommendations.",
        priceUgnot: 500000000, // 500 GNOT
        milestones: "Deposit:250000000,Final Delivery:250000000",
        category: "Security",
        image: "🛡️"
    },
    {
        id: "svc-2",
        title: "DApp Frontend Development",
        freelancer: "g1frontenddev",
        description: "Complete React/TypeScript frontend development for your DAO or marketplace, wired up to Adena and Gno.land.",
        priceUgnot: 1000000000, // 1000 GNOT
        milestones: "Design:300000000,Development:500000000,Launch:200000000",
        category: "Development",
        image: "💻"
    },
    {
        id: "svc-3",
        title: "UI/UX Design System",
        freelancer: "g1designmaster",
        description: "Premium Figma design system and component library tailored to your brand, ready for implementation.",
        priceUgnot: 300000000, // 300 GNOT
        milestones: "Wireframes:100000000,Final UI:200000000",
        category: "Design",
        image: "🎨"
    }
]

export default function ServiceLane() {
    const adena = useAdena()
    
    const [hiringService, setHiringService] = useState<Service | null>(null)

    const handleHireClick = (service: Service) => {
        if (!adena.connected || !adena.address) {
            alert("Please connect your wallet first.")
            return
        }
        setHiringService(service)
    }

    return (
        <div className="animate-fade-in">
            <div className="um-lane-header">
                <h2 className="um-lane-title">Verified Services</h2>
            </div>
            
            <div className="um-grid">
                {MOCK_SERVICES.map(svc => (
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
        </div>
    )
}

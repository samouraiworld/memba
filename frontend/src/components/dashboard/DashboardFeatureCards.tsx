/**
 * DashboardFeatureCards — Grid of navigation cards (Multisig, DAO, Tokens).
 * Extracted from Dashboard.tsx for maintainability.
 */
import { useNavigate } from "react-router-dom"

interface FeatureCardData {
    icon: string
    title: string
    count: number | null
    unit: string
    cta: string
    path: string
    alt: string
    altPath: string
    showAlt: boolean
}

interface Props {
    joinedMultisigCount: number
    firstMultisigAddress: string | null
    savedDAOsCount: number
}

export function DashboardFeatureCards({ joinedMultisigCount, firstMultisigAddress, savedDAOsCount }: Props) {
    const navigate = useNavigate()

    const cards: FeatureCardData[] = [
        {
            icon: "🔐", title: "Multisig",
            count: joinedMultisigCount, unit: "wallet",
            cta: joinedMultisigCount > 0 ? "Manage" : "Get Started",
            path: joinedMultisigCount > 0 && firstMultisigAddress ? `/multisig/${firstMultisigAddress}` : "/create",
            alt: "+ Create", altPath: "/create",
            showAlt: joinedMultisigCount > 0,
        },
        {
            icon: "🏛️", title: "DAO Governance",
            count: savedDAOsCount, unit: "DAO",
            cta: "Explore", path: "/dao",
            alt: "+ Create", altPath: "/dao/create",
            showAlt: true,
        },
        {
            icon: "🪙", title: "Token Factory",
            count: null, unit: "",
            cta: "Browse Tokens", path: "/tokens",
            alt: "+ Create", altPath: "/create-token",
            showAlt: true,
        },
    ]

    return (
        <div className="k-feature-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {cards.map(f => (
                <div
                    key={f.title}
                    className="k-card"
                    style={{
                        padding: "20px 18px", display: "flex", flexDirection: "column", gap: 12,
                        cursor: "pointer", transition: "border-color 0.2s, transform 0.2s",
                    }}
                    onClick={() => navigate(f.path)}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)"; e.currentTarget.style.transform = "translateY(-2px)" }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.transform = "" }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 22 }}>{f.icon}</span>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{f.title}</span>
                        {f.count !== null && (
                            <span style={{
                                marginLeft: "auto", fontSize: 11, fontFamily: "JetBrains Mono, monospace",
                                color: "#00d4aa", background: "rgba(0,212,170,0.08)",
                                padding: "2px 8px", borderRadius: 4,
                            }}>
                                {f.count} {f.unit}{f.count !== 1 ? "s" : ""}
                            </span>
                        )}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                        <button className="k-btn-primary" style={{ fontSize: 11, padding: "6px 14px" }} onClick={(e) => { e.stopPropagation(); navigate(f.path) }}>
                            {f.cta} →
                        </button>
                        {f.showAlt && (
                            <button className="k-btn-secondary" style={{ fontSize: 11, padding: "6px 14px" }} onClick={(e) => { e.stopPropagation(); navigate(f.altPath) }}>
                                {f.alt}
                            </button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    )
}

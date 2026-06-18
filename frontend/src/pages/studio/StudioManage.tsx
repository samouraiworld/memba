import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { useCollectionAdmin } from "./useCollectionAdmin"

// ── Phase labels ────────────────────────────────────────────────────────

const PHASE_LABELS: Record<number, string> = {
    0: "Draft",
    1: "Allowlist",
    2: "Public",
    3: "Closed",
}

function phaseLabel(phase: number): string {
    return PHASE_LABELS[phase] ?? `Phase ${phase}`
}

// ── Section definitions (Tasks 6–10 replace the placeholder bodies) ─────

const SECTIONS = [
    { key: "mint", label: "Mint" },
    { key: "phases", label: "Phases" },
    { key: "allowlist", label: "Allowlist" },
    { key: "withdraw", label: "Withdraw" },
    { key: "settings", label: "Settings" },
] as const

type SectionKey = (typeof SECTIONS)[number]["key"]

// ── Component ───────────────────────────────────────────────────────────

export function StudioManage() {
    const { creator, slug } = useParams<{ creator: string; slug: string }>()
    const id = creator && slug ? `${creator}/${slug}` : ""
    const np = useNetworkPath()

    const { col, isAdmin, loading } = useCollectionAdmin(id)

    const [section, setSection] = useState<SectionKey>("mint")

    if (loading) {
        return (
            <div className="studio-page">
                <p className="studio-loading">Loading…</p>
            </div>
        )
    }

    if (!loading && !col) {
        return (
            <div className="studio-page">
                <p>Collection not found.</p>
            </div>
        )
    }

    if (!isAdmin) {
        return (
            <div className="studio-page">
                <p>Only the collection owner can manage this.</p>
                <Link to={np(`nft/collection/${id}`)}>View public page →</Link>
            </div>
        )
    }

    // Narrow: col is non-null here (isAdmin implies col exists)
    const activeSection = SECTIONS.find((s) => s.key === section)!

    return (
        <div className="studio-page">
            <header className="studio-manage-header">
                <div className="studio-manage-title">
                    <h1>{col!.name}</h1>
                    <span className="studio-phase-label">{phaseLabel(col!.phase)}</span>
                </div>
                <Link to={np(`nft/collection/${id}`)} className="studio-public-link">
                    View public page →
                </Link>
            </header>

            <nav className="studio-section-nav" aria-label="Manage sections">
                {SECTIONS.map(({ key, label }) => (
                    <button
                        key={key}
                        type="button"
                        aria-current={section === key ? "true" : undefined}
                        className={section === key ? "studio-nav-btn active" : "studio-nav-btn"}
                        onClick={() => setSection(key)}
                    >
                        {label}
                    </button>
                ))}
            </nav>

            <div className="studio-section" data-section={section}>
                {activeSection.label} — coming soon
            </div>
        </div>
    )
}

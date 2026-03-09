/**
 * DAOCard — Rich DAO card for the Organization Directory.
 *
 * Displays DAO name, realm path, category badge, metadata (members, proposals),
 * save button, and status badges.
 */

import { Buildings, BookmarkSimple, ArrowRight } from "@phosphor-icons/react"
import { addSavedDAO } from "../../lib/daoSlug"
import type { DAOMetadata } from "../../lib/daoMetadata"
import type { DAOCategory } from "../../lib/directory"

const CATEGORY_CONFIG: Record<DAOCategory, { label: string; color: string }> = {
    governance: { label: "Governance", color: "hsl(210, 80%, 60%)" },
    community: { label: "Community", color: "hsl(150, 60%, 50%)" },
    treasury: { label: "Treasury", color: "hsl(45, 85%, 55%)" },
    defi: { label: "DeFi", color: "hsl(280, 65%, 60%)" },
    infrastructure: { label: "Infra", color: "hsl(0, 60%, 55%)" },
    unknown: { label: "", color: "" },
}

interface DAOCardProps {
    name: string
    path: string
    isSaved: boolean
    category?: DAOCategory
    metadata?: DAOMetadata
    onClick: () => void
    onSave?: () => void
}

export function DAOCard({ name, path, isSaved, category, metadata, onClick, onSave }: DAOCardProps) {
    const handleSave = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (isSaved) return
        addSavedDAO(path, name)
        onSave?.()
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onClick()
        }
    }

    const cat = category && category !== "unknown" ? CATEGORY_CONFIG[category] : null

    return (
        // I4 audit fix: div[role=button] instead of <button> to avoid
        // invalid nested <button> with the inner save button
        <div
            className="dir-card"
            onClick={onClick}
            onKeyDown={handleKeyDown}
            role="button"
            tabIndex={0}
            data-testid="dao-card"
        >
            <div className="dir-card-main">
                <div className="dir-card-name">
                    <Buildings size={14} weight="duotone" style={{ marginRight: 6, verticalAlign: -2 }} />
                    {name}
                    {cat && (
                        <span
                            className="dir-inline-badge dir-category-badge"
                            style={{ backgroundColor: `${cat.color}22`, color: cat.color, borderColor: `${cat.color}44` }}
                            data-testid="dao-category"
                        >
                            {cat.label}
                        </span>
                    )}
                </div>
                <div className="dir-card-path">{path}</div>
                {metadata && (metadata.memberCount > 0 || metadata.proposalCount > 0) && (
                    <div className="dir-card-meta">
                        {metadata.memberCount > 0 && (
                            <span className="dir-card-stat">
                                <span className="stat-value">{metadata.memberCount}</span> members
                            </span>
                        )}
                        {metadata.proposalCount > 0 && (
                            <span className="dir-card-stat">
                                <span className="stat-value">{metadata.proposalCount}</span> proposals
                            </span>
                        )}
                    </div>
                )}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                {isSaved ? (
                    <span className="dir-badge dir-badge-saved">SAVED</span>
                ) : (
                    <button
                        className="dir-save-btn"
                        onClick={handleSave}
                        data-testid="dao-save-btn"
                        aria-label={`Save ${name} to Memba`}
                    >
                        <BookmarkSimple size={10} weight="bold" style={{ marginRight: 3, verticalAlign: -1 }} />
                        Save
                    </button>
                )}
                <ArrowRight size={14} className="dir-arrow" />
            </div>
        </div>
    )
}

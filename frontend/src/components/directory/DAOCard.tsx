/**
 * DAOCard — Rich DAO card for the Organization Directory.
 *
 * Displays DAO name, realm path, metadata (members, proposals),
 * save button, and status badges.
 */

import { Buildings, BookmarkSimple, ArrowRight } from "@phosphor-icons/react"
import { addSavedDAO } from "../../lib/daoSlug"
import type { DAOMetadata } from "../../lib/daoMetadata"

interface DAOCardProps {
    name: string
    path: string
    isSaved: boolean
    metadata?: DAOMetadata
    onClick: () => void
    onSave?: () => void
}

export function DAOCard({ name, path, isSaved, metadata, onClick, onSave }: DAOCardProps) {
    const handleSave = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (isSaved) return
        addSavedDAO(path, name)
        onSave?.()
    }

    return (
        <button className="dir-card" onClick={onClick} data-testid="dao-card">
            <div className="dir-card-main">
                <div className="dir-card-name">
                    <Buildings size={14} weight="duotone" style={{ marginRight: 6, verticalAlign: -2 }} />
                    {name}
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
        </button>
    )
}

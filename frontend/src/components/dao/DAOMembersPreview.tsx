import { Link } from "react-router-dom"
import { useNetworkPath, useNetworkNav } from "../../hooks/useNetworkNav"
import { UsersThree } from "@phosphor-icons/react"
import { SkeletonCard } from "../ui/LoadingSkeleton"
import { MemberCard } from "./MemberCard"
import type { DAOMember } from "../../lib/dao"
import { revealInvisibleFormatting } from "../../lib/dao/v2Text"

interface DAOMembersPreviewProps {
    professional?: boolean
    encodedSlug: string
    members: DAOMember[]
    memberCount: number
    membersLoading: boolean
    currentUserAddress: string
}

export function DAOMembersPreview({ encodedSlug, members, memberCount, membersLoading, currentUserAddress, professional = false }: DAOMembersPreviewProps) {
    const navigate = useNetworkNav()
    const path = useNetworkPath()

    return (
        <div id="dao-members-section">
            <div className="dao-section-header">
                <h3 className="dao-section-title--sm">
                    <UsersThree size={16} style={{ display: 'inline' }} /> {professional ? `Members (${memberCount})` : `(${memberCount})`}
                </h3>
                <button
                    onClick={() => navigate(`/dao/${encodedSlug}/members`)}
                    className="dao-view-all-btn"
                >
                    View All →
                </button>
            </div>

            {professional && !membersLoading && members.length === 0 && <p className="gov-member-note">No individual member records were returned. Open the full member view to inspect membership details.</p>}
            {membersLoading ? (
                <div className="dao-members-grid">
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            ) : (
                <div className="dao-members-grid">
                    {members.slice(0, 6).map((m) => (
                        professional ? <Link key={m.address} className="gov-member-link" to={path(`profile/${m.address}`)}>
                            <span><strong>{m.username ? revealInvisibleFormatting(m.username) : `${m.address.slice(0, 8)}…${m.address.slice(-6)}`}</strong><span className="gov-member-address" title={m.address}>{m.address}</span></span>
                            <span className="gov-member-role">{revealInvisibleFormatting(m.tier || m.roles.join(", ") || "Member")}{m.address === currentUserAddress ? " · You" : ""}</span>
                        </Link> : <MemberCard key={m.address} member={m} isCurrentUser={m.address === currentUserAddress} onProfileClick={(addr) => navigate(`/profile/${addr}`)} />
                    ))}
                </div>
            )}
        </div>
    )
}

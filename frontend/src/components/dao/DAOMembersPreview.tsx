import { useNetworkNav } from "../../hooks/useNetworkNav"
import { UsersThree } from "@phosphor-icons/react"
import { SkeletonCard } from "../ui/LoadingSkeleton"
import { MemberCard } from "./MemberCard"
import type { DAOMember } from "../../lib/dao"

interface DAOMembersPreviewProps {
    encodedSlug: string
    members: DAOMember[]
    memberCount: number
    membersLoading: boolean
    currentUserAddress: string
}

export function DAOMembersPreview({ encodedSlug, members, memberCount, membersLoading, currentUserAddress }: DAOMembersPreviewProps) {
    const navigate = useNetworkNav()

    return (
        <div id="dao-members-section">
            <div className="dao-section-header">
                <h3 className="dao-section-title--sm">
                    <UsersThree size={16} style={{ display: 'inline' }} /> ({memberCount})
                </h3>
                <button
                    onClick={() => navigate(`/dao/${encodedSlug}/members`)}
                    className="dao-view-all-btn"
                >
                    View All →
                </button>
            </div>

            {membersLoading ? (
                <div className="dao-members-grid">
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            ) : (
                <div className="dao-members-grid">
                    {members.slice(0, 6).map((m) => (
                        <MemberCard key={m.address} member={m} isCurrentUser={m.address === currentUserAddress} onProfileClick={(addr) => navigate(`/profile/${addr}`)} />
                    ))}
                </div>
            )}
        </div>
    )
}

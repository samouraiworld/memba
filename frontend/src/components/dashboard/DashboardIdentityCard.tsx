/**
 * DashboardIdentityCard — Authenticated user card with avatar, username, balance.
 * Extracted from Dashboard.tsx for maintainability.
 */
import { useNetworkNav } from "../../hooks/useNetworkNav"
import { CopyableAddress } from "../ui/CopyableAddress"

interface Props {
    address: string
    username: string | null
    avatarUrl: string | null
    balance: string
    onAvatarError: () => void
}

export function DashboardIdentityCard({ address, username, avatarUrl, balance, onAvatarError }: Props) {
    const navigate = useNetworkNav()

    return (
        <div className="k-card" style={{
            padding: "20px 24px", display: "flex", alignItems: "center", gap: 16,
            borderColor: "rgba(0,212,170,0.15)",
            background: "linear-gradient(135deg, rgba(0,212,170,0.04), transparent)",
        }}>
            <div
                style={{
                    width: 48, height: 48, borderRadius: "50%",
                    background: avatarUrl ? "none" : "rgba(0,212,170,0.1)",
                    border: "2px solid rgba(0,212,170,0.2)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    overflow: "hidden", cursor: "pointer",
                }}
                onClick={() => navigate(`/profile/${address}`)}
            >
                {avatarUrl ? (
                    <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={onAvatarError} />
                ) : (
                    <span style={{ fontSize: 24 }}>👤</span>
                )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>
                        {username || "Anonymous"}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: balance.startsWith("?") ? "#f5a623" : "#00d4aa" }}>
                        {balance}
                    </span>
                </div>
                <CopyableAddress address={address} fontSize={11} />
            </div>
            <button
                className="k-btn-secondary"
                onClick={() => navigate(`/profile/${address}`)}
                style={{ fontSize: 11, flexShrink: 0 }}
            >
                Edit Profile
            </button>
        </div>
    )
}

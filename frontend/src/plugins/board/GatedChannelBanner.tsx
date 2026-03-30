/**
 * GatedChannelBanner — Shown when a channel requires roles the user doesn't have.
 *
 * Queries the channel's ACL via Render("__acl/{channel}") and compares
 * against the user's DAO membership to determine access.
 *
 * Phase 2 — G1: Token-gated channel UI.
 *
 * @module plugins/board/GatedChannelBanner
 */

import { useState, useEffect } from "react"
import { getChannelACL } from "./parser"
import type { ChannelACLInfo } from "./types"
import { GNO_RPC_URL } from "../../lib/config"

interface GatedChannelBannerProps {
    boardPath: string
    channel: string
    /** User's DAO roles (e.g. ["admin", "member"]). Empty if not a member. */
    userRoles: string[]
    /** Whether the user's wallet is connected. */
    isConnected: boolean
    /** DAO display name for the CTA. */
    daoName: string
}

export function GatedChannelBanner({ boardPath, channel, userRoles, isConnected, daoName }: GatedChannelBannerProps) {
    const [acl, setAcl] = useState<ChannelACLInfo | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        setLoading(true)
        getChannelACL(GNO_RPC_URL, boardPath, channel)
            .then(setAcl)
            .catch(() => setAcl(null))
            .finally(() => setLoading(false))
    }, [boardPath, channel])

    if (loading || !acl) return null

    // Check read access
    const hasReadAccess = acl.readRoles.length === 0 || acl.readRoles.some(r => userRoles.includes(r))
    // Check write access
    const hasWriteAccess = acl.writeRoles.length === 0 || acl.writeRoles.some(r => userRoles.includes(r))

    if (hasReadAccess && hasWriteAccess) return null

    return (
        <div className="gated-channel-banner">
            <span className="gated-channel-banner__icon">🔒</span>
            <div className="gated-channel-banner__text">
                {!isConnected ? (
                    <span>Connect your wallet to access this channel.</span>
                ) : !hasReadAccess ? (
                    <span>This channel is restricted. Join <strong>{daoName}</strong> to view content.</span>
                ) : (
                    <span>This channel is read-only for your role. {acl.writeRoles.length > 0 && (
                        <>Required: <strong>{acl.writeRoles.join(", ")}</strong></>
                    )}</span>
                )}
            </div>
        </div>
    )
}

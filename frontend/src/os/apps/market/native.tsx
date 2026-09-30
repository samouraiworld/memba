/**
 * Market (v1.1) native home: one card per Market lane that is live on the
 * session's network, each opening that lane as a section of this window. The
 * lane registry (build flag plus realm allowlist) decides what is live; with
 * no live lane the home says so and lists nothing. Every section is still the
 * classic page, handed through as `fallback`, under a control that returns to
 * the home: the shell replaces the address when a card opens a lane, so
 * browser Back would skip the home.
 *
 * @module os/apps/market/native
 */
import { useEffect, useRef } from "react"
import type { NativeViewProps } from "../../native/types"
import { GNO_CHAIN_ID, NETWORKS } from "../../../lib/config"
import { getLiveLanes } from "../../../lib/marketplace/lanes"
import type { AssetType } from "../../../lib/marketplace/types"
import { Card, CardGrid, Pill } from "../../kit"
import { sectionForClassic } from "../../page/classicRoute"
import { Icon, type IconName } from "../../shell/icons"
import { specForTarget } from "../../shell/windows"

const LANE_CARDS: Record<AssetType, { icon: IconName; sub: string }> = {
    nft: { icon: "nft", sub: "Collections and listings" },
    service: { icon: "doc", sub: "Hire with milestone escrow" },
    token: { icon: "tok", sub: "Peer-to-peer token trades" },
    agent: { icon: "term", sub: "Agents registered on-chain" },
}

export default function MarketWindow({ section, session, open, fallback }: NativeViewProps) {
    // A card, or the control back to the home, unmounts when it is used and would
    // drop focus on the page body: focus follows into the view it opened instead.
    const moved = useRef(false)
    const heading = useRef<HTMLHeadingElement>(null)
    const back = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        if (!moved.current) return
        moved.current = false
        const landing = section === null ? heading.current : back.current
        landing?.focus({ preventScroll: true })
    }, [section])
    const go = (to: string | null) => {
        moved.current = true
        open(specForTarget({ kind: "app", app: "market", section: to })!)
    }

    if (section !== null) {
        return (
            <>
                <div className="os-row os-tight-row">
                    <button ref={back} type="button" className="os-btn os-quiet" onClick={() => go(null)}><span aria-hidden="true">←</span> Market lanes</button>
                </div>
                {fallback}
            </>
        )
    }

    // The registry reads the network the config was loaded with, which is the session's.
    const lanes = getLiveLanes()
    const chainId = NETWORKS[session.network.key]?.chainId ?? GNO_CHAIN_ID
    return (
        <div className="os-stack">
            <h3 ref={heading} tabIndex={-1} className="os-h os-flush">Market lanes</h3>
            {lanes.length === 0 ? (
                <div className="os-note os-warn" role="note">
                    <Pill tone="neutral">Market unavailable here</Pill>{" "}
                    No Market lane is available here. A lane appears only when it is enabled in this build and its realm is available on {chainId}.
                </div>
            ) : (
                <CardGrid>
                    {lanes.map((lane) => (
                        // The section comes from the lane's classic page: a bare "services" is the legacy /services redirect.
                        <Card key={lane.assetType} onClick={() => go(sectionForClassic("market", `marketplace/${lane.slug}`))}>
                            <Icon name={LANE_CARDS[lane.assetType].icon} />
                            <span className="os-grow"><b>{lane.label}</b><span className="os-sub os-block">{LANE_CARDS[lane.assetType].sub}</span></span>
                        </Card>
                    ))}
                </CardGrid>
            )}
        </div>
    )
}

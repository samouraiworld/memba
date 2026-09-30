/**
 * Market (v1.1) native home: one card per Market lane that is live on the
 * session's network, each opening that lane as a section of this window. The
 * lane registry (build flag plus realm allowlist) decides what is live, except
 * for NFTs: this window's NFT lane reads the launchpad market realm, so it is
 * live where that realm is allowlisted and the NFT flag is on. With no live
 * lane the home says so and lists nothing, and a section of a lane that is not
 * live shows the home with a note naming that lane. The NFT lane's sections
 * are native views; every other section is still the classic page, handed
 * through as `fallback`. Either sits under a control that returns to the home:
 * the shell replaces the address when a card opens a lane, so browser Back
 * would skip the home.
 *
 * @module os/apps/market/native
 */
import { lazy, Suspense, useEffect, useRef } from "react"
import type { NativeViewProps } from "../../native/types"
import { isNftEnabled, isRealmValidOn } from "../../../lib/config"
import { LANES, type LaneDef } from "../../../lib/marketplace/lanes"
import type { AssetType } from "../../../lib/marketplace/types"
import { NFT_MARKET_PATH } from "../../../lib/nft/market"
import { Card, CardGrid, Loading, Pill } from "../../kit"
import { parseMarketNftSection } from "../../nft/routes"
import { sectionForClassic } from "../../page/classicRoute"
import { Icon, type IconName } from "../../shell/icons"
import { specForTarget } from "../../shell/windows"

const NftLane = lazy(() => import("./nft/lane"))

const LANE_CARDS: Record<AssetType, { icon: IconName; sub: string }> = {
    nft: { icon: "nft", sub: "Collections and listings" },
    service: { icon: "doc", sub: "Hire with milestone escrow" },
    token: { icon: "tok", sub: "Peer-to-peer token trades" },
    agent: { icon: "term", sub: "Agents registered on-chain" },
}

/** The section a lane's card opens: its classic page's (a bare "services" is the legacy /services redirect). */
const laneSection = (lane: LaneDef) => sectionForClassic("market", `marketplace/${lane.slug}`)!

/** The lane a section belongs to: its own section, or one below it. */
const laneOf = (section: string) => LANES.find((lane) => section === laneSection(lane) || section.startsWith(`${laneSection(lane)}/`))

export default function MarketWindow({ section, session, active, open, push, fallback }: NativeViewProps) {
    const network = session.network.key
    const lanes = LANES.filter((lane) => lane.assetType === "nft" ? isNftEnabled() && isRealmValidOn(network, NFT_MARKET_PATH) : lane.isLive())
    const lane = section === null ? undefined : laneOf(section)
    // A section no lane names (a lane's own page, the legacy redirect) is the classic page's to route to a live lane.
    const inLane = section !== null && (lane ? lanes.includes(lane) : lanes.length > 0)
    const nft = inLane && lane?.assetType === "nft" ? parseMarketNftSection(section) : null

    // A card, or the control back to the home, unmounts when it is used and would
    // drop focus on the page body: focus follows into the view it opened instead,
    // unless another window came to the front meanwhile, which focus would push back.
    const moved = useRef(false)
    const heading = useRef<HTMLHeadingElement>(null)
    const back = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        if (!moved.current) return
        moved.current = false
        if (active) (inLane ? back.current : heading.current)?.focus({ preventScroll: true })
    }, [section, inLane, active])
    const go = (to: string | null) => {
        moved.current = true
        open(specForTarget({ kind: "app", app: "market", section: to })!)
    }

    if (inLane) {
        return (
            <>
                <div className="os-row os-tight-row">
                    <button ref={back} type="button" className="os-btn os-quiet" onClick={() => go(null)}><span aria-hidden="true">←</span> Market lanes</button>
                </div>
                <Suspense fallback={<Loading />}>
                    {nft ? <NftLane route={nft} session={session} open={open} push={push} /> : fallback}
                </Suspense>
            </>
        )
    }

    // Past the lane branch, a section that names a lane names one that is not live.
    return (
        <div className="os-stack">
            <h3 ref={heading} tabIndex={-1} className="os-h os-flush">Market lanes</h3>
            {lane ? (
                <div className="os-note os-warn" role="note">
                    <Pill tone="neutral">{lane.label} unavailable here</Pill>{" "}
                    The {lane.label} lane is unavailable here. A lane appears only when it is enabled in this build and its realm is available on {session.network.chainId}.
                </div>
            ) : lanes.length === 0 && (
                <div className="os-note os-warn" role="note">
                    <Pill tone="neutral">No Market lane here</Pill>{" "}
                    No Market lane is available here. A lane appears only when it is enabled in this build and its realm is available on {session.network.chainId}.
                </div>
            )}
            {lanes.length > 0 && (
                <CardGrid>
                    {lanes.map((item) => (
                        <Card key={item.assetType} onClick={() => go(laneSection(item))}>
                            <Icon name={LANE_CARDS[item.assetType].icon} />
                            <span className="os-grow"><b>{item.label}</b><span className="os-sub os-block">{LANE_CARDS[item.assetType].sub}</span></span>
                        </Card>
                    ))}
                </CardGrid>
            )}
        </div>
    )
}

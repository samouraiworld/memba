/**
 * NFT native window. Collections live on the NFT ledger realm; buying and
 * selling is Market's (owner decision 09-25). The window is available only
 * when the NFT build flag is on AND the ledger is allowlisted on the session
 * network, which it is on none until the realm is published; otherwise every
 * section it serves says which of the two is missing. When available, the
 * home lists the newest collections, read strictly: a failed read is shown as
 * an error with a retry, a list the ledger refused and data that breaks its
 * rules as errors without one, and none as an empty ledger. Guests browse
 * freely; only My collectibles and minting ask for a wallet. Creating a collection and
 * the studio arrive later and say so. A section this window does not serve is
 * handed through as `fallback`. Moving between sections carries focus to the
 * new view's heading or its control back, as Market's window does.
 *
 * @module os/apps/nft/native
 */
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, type Ref } from "react"
import type { NativeViewProps } from "../../native/types"
import { isNftEnabled, isRealmValidOn } from "../../../lib/config"
import { revealInvisibleFormatting } from "../../../lib/dao/v2Text"
import { NFT_LEDGER_PATH, listNewestCollections, type NftMode } from "../../../lib/nft/ledger"
import { ReadError, RealmRefusedError } from "../../../lib/nft/read"
import { Card, CardGrid, Empty, ErrorState, Loading, Pill } from "../../kit"
import { marketNftSection, nftSection, parseNftSection } from "../../nft/routes"
import { Icon } from "../../shell/icons"
import { specForTarget } from "../../shell/windows"
import type { NftScreen } from "./screen"
import { TokenItem } from "./item"
import { MyCollectibles } from "./mine"
import { CollectionProfile } from "./profile"

const SHOWN = 20
const MODE_LABEL: Record<NftMode, string> = { open: "Transferable", royalty_protected: "Royalty-protected", soulbound: "Soulbound" }

function Collections({ screen, heading }: { screen: NftScreen; heading: Ref<HTMLHeadingElement> }) {
    // The session network is the one the config was loaded with, which is the network the readers query.
    const collections = useQuery({
        queryKey: ["nft", "ledger", NFT_LEDGER_PATH, "newest", screen.chainId],
        queryFn: () => listNewestCollections(SHOWN),
        staleTime: 60_000, retry: false,
    })
    return (
        <section aria-labelledby="nft-collections">
            <h3 ref={heading} tabIndex={-1} className="os-h" id="nft-collections">Collections</h3>
            {collections.isPending ? <Loading label="Reading collections…" />
                : collections.isError ? (collections.error instanceof ReadError
                    ? <ErrorState message="Collections could not be read from this network." onRetry={() => void collections.refetch()} />
                    : collections.error instanceof RealmRefusedError
                        ? <ErrorState message="This network's NFT ledger refused to list its collections." />
                        : <ErrorState message="This network's collection data does not follow the ledger's rules, so it is not shown." />)
                : collections.data.total === 0n ? <Empty title="No collections have been created yet." />
                : <div className="os-stack os-tight">
                    {collections.data.total > BigInt(SHOWN) && <p className="os-sub">The {SHOWN} newest of {collections.data.total.toString()} collections, newest first.</p>}
                    <ul className="os-list os-sgrid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                        {collections.data.collections.map((item) => (
                            <li key={item.id} style={{ display: "flex" }}>
                                <button type="button" className="os-scard os-grow" onClick={() => screen.go({ kind: "collection", collection: item.id })}>
                                    <Icon name="nft" />
                                    <span className="os-grow" style={{ overflowWrap: "anywhere" }}>
                                        <b>{revealInvisibleFormatting(item.name)}</b>
                                        <span className="os-sub os-block">{revealInvisibleFormatting(item.symbol)}</span>
                                        <span className="os-sub os-block">
                                            {item.maxSupply === 0n ? `${item.minted} minted` : `${item.minted} / ${item.maxSupply} minted`}
                                            {item.sealed ? " · closed edition" : item.maxSupply === 0n && " · open edition"}
                                        </span>
                                    </span>
                                    <Pill tone="neutral">{MODE_LABEL[item.mode]}</Pill>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>}
        </section>
    )
}

const LATER = { create: "Creating a collection", studio: "The creator studio", "studio-collection": "The creator studio" } as const

export default function NftWindow({ section, session, push, openApp, fallback }: NativeViewProps) {
    // A card or a control unmounts when it is used and would drop focus on the page
    // body: focus follows into the view it opened instead (see Market's window).
    const moved = useRef(false)
    const heading = useRef<HTMLHeadingElement>(null)
    const back = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        if (!moved.current) return
        moved.current = false
        const landing = section === null ? heading.current : back.current
        landing?.focus({ preventScroll: true })
    }, [section])

    const route = parseNftSection(section)
    if (route === null) return <>{fallback}</>

    const enabled = isNftEnabled()
    const chainId = session.network.chainId
    const ledgerAvailable = isRealmValidOn(session.network.key, NFT_LEDGER_PATH)
    const market = (
        <Card onClick={() => openApp("market")}>
            <Icon name="tag" />
            <span className="os-grow"><b>Open Market</b><span className="os-sub os-block">Browse the available Market lanes</span></span>
        </Card>
    )
    if (!enabled || !ledgerAvailable) {
        return (
            <div className="os-stack">
                <div className="os-note os-warn" role="note">
                    <Pill tone="neutral">NFT unavailable here</Pill>
                    {!ledgerAvailable && (session.network.key === "mainnet"
                        ? ` The NFT ledger is not deployed on ${chainId}.`
                        : " The NFT ledger is not available on this network.")}
                    {!enabled && " NFT features are disabled in this build."}
                </div>
                <CardGrid>{market}</CardGrid>
            </div>
        )
    }

    const screen: NftScreen = {
        chainId,
        network: session.network.key,
        go: (next) => {
            const to = nftSection(next)
            // Going to the view already shown changes nothing, so it moves no focus later.
            moved.current = to !== section
            push(specForTarget({ kind: "app", app: "nft", section: to })!)
        },
        trade: (next) => push(specForTarget({ kind: "app", app: "market", section: marketNftSection(next) })!),
    }
    switch (route.kind) {
        // Keyed, so a collapsed presentation or a loaded page never carries over to another collection.
        case "collection": return <CollectionProfile key={route.collection} screen={screen} session={session} id={route.collection} back={back} />
        case "token": return <TokenItem key={`${route.collection}/${route.number}`} screen={screen} collection={route.collection} number={route.number} back={back} />
        case "mine": return <MyCollectibles screen={screen} session={session} back={back} />
        case "create": case "studio": case "studio-collection":
            return (
                <div className="os-stack">
                    <p className="os-note" role="note">{LATER[route.kind]} arrives in a later version of Memba OS.</p>
                    <div className="os-row"><button ref={back} type="button" className="os-btn os-quiet" onClick={() => screen.go({ kind: "home" })}>Browse collections</button></div>
                </div>
            )
        case "home": return (
            <div className="os-stack">
                <Collections screen={screen} heading={heading} />
                <CardGrid>
                    <Card onClick={() => screen.go({ kind: "mine" })}>
                        <Icon name="wal" />
                        <span className="os-grow"><b>My collectibles</b><span className="os-sub os-block">The tokens your account holds</span></span>
                    </Card>
                    {market}
                </CardGrid>
            </div>
        )
    }
}

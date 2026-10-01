/**
 * A collection's profile: its presentation and people, the Collection
 * Passport, curation marks, mint stages (with minting) and tokens. A
 * collection curators hide keeps every section; its image, banner,
 * description, website and token art stay collapsed until the viewer asks
 * (see useCurationHide). A soulbound collection is never sold, so it has no
 * way to Market.
 *
 * @module os/apps/nft/profile
 */
import { useQuery } from "@tanstack/react-query"
import type { Ref } from "react"
import { revealInvisibleFormatting } from "../../../lib/dao/v2Text"
import type { NftCollection } from "../../../lib/nft/ledger"
import { webUrl } from "../../../lib/nft/metadata"
import { TokenMedia } from "../../nft/TokenMedia"
import type { OsSession } from "../../shell/useOsSession"
import { Loading } from "../../kit"
import { Curation } from "./curation"
import { Back, ReadFailure } from "./parts"
import { collectionQuery, useCurationHide, type NftScreen } from "./screen"
import { Passport } from "./passport"
import { Stages } from "./stages"
import { TokenGrid } from "./tokens"

function People({ collection }: { collection: NftCollection }) {
    const row = (label: string, account: string) => <div className="os-kv-row"><dt>{label}</dt><dd className="os-mono os-break">{account}</dd></div>
    return (
        <dl className="os-kv">
            {row("Creator", collection.creator)}
            {collection.originator !== collection.creator && row("Created by", collection.originator)}
            {collection.pendingCreator !== "" && row("Pending creator", collection.pendingCreator)}
        </dl>
    )
}

function Profile({ screen, session, collection }: { screen: NftScreen; session: OsSession; collection: NftCollection }) {
    const hide = useCurationHide(screen, collection.id)
    const { shown } = hide
    const name = revealInvisibleFormatting(collection.name)
    const website = webUrl(collection.website)
    return (
        <div className="os-stack">
            {shown && collection.banner !== "" && <TokenMedia uri={collection.banner} seed={collection.id} alt="" shape="banner" />}
            <div className="os-row os-nft-head">
                <span className="os-nft-avatar"><TokenMedia uri={shown ? collection.image || null : null} seed={collection.id} alt="" /></span>
                <span className="os-grow">
                    <h2 className="os-nft-title">{name}</h2>
                    <span className="os-sub os-block">{revealInvisibleFormatting(collection.symbol)} · {collection.id}</span>
                </span>
                {collection.mode !== "soulbound" && <button type="button" className="os-btn" onClick={() => screen.trade({ kind: "collection", collection: collection.id })}>Trade on Market</button>}
            </div>
            {shown && collection.description !== "" && <p className="os-break">{revealInvisibleFormatting(collection.description)}</p>}
            {shown && collection.website !== "" && (website
                ? <a className="os-break" href={website} target="_blank" rel="noopener noreferrer">{revealInvisibleFormatting(collection.website)}</a>
                : <span className="os-sub os-break">Website (not a secure link): {revealInvisibleFormatting(collection.website)}</span>)}
            <People collection={collection} />
            <section aria-label="Curation">
                <h3 className="os-h">Curation</h3>
                {hide.curated ? <Curation hide={hide} collapsed="Its image, banner, description, website and token art" /> : <p className="os-sub">Curation is not available on this network.</p>}
            </section>
            <Passport screen={screen} collection={collection} />
            <Stages screen={screen} session={session} collection={collection.id} collectionName={name} />
            <TokenGrid screen={screen} collection={collection.id} showMedia={shown} />
        </div>
    )
}

/** `back` goes on the control back to Collections, which takes focus when this screen is opened from another. */
export function CollectionProfile({ screen, session, id, back }: { screen: NftScreen; session: OsSession; id: string; back: Ref<HTMLButtonElement> }) {
    const collection = useQuery(collectionQuery(screen.chainId, id))
    return (
        <div className="os-stack">
            <Back ref={back} label="Collections" onClick={() => screen.go({ kind: "home" })} />
            {collection.isPending ? <Loading label="Reading the collection…" />
                : collection.isError ? <ReadFailure error={collection.error} what="collection" refused={`There is no collection ${id} on this network.`} retry={() => void collection.refetch()} />
                : <Profile screen={screen} session={session} collection={collection.data} />}
        </div>
    )
}

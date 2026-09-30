/**
 * A collection's profile: its presentation and people, the Collection
 * Passport, curation marks, mint stages and tokens. Curation blocks nothing:
 * a collection curators hide keeps every section, and only what its creator
 * chose to show (image, banner, description, token art) stays collapsed until
 * the viewer asks for it. While the curation record is unknown (being read,
 * or unreadable) it stays collapsed too; where the curation realm is not
 * available there is no record to wait for.
 *
 * @module os/apps/nft/profile
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import { useState } from "react"
import { isRealmValidOn } from "../../../lib/config"
import { revealInvisibleFormatting } from "../../../lib/dao/v2Text"
import { NFT_CURATION_PATH, getCurationRecord, type CurationRecord } from "../../../lib/nft/curation"
import { getCollection, type NftCollection } from "../../../lib/nft/ledger"
import { mediaUrl } from "../../../lib/nft/metadata"
import { ReadError } from "../../../lib/nft/read"
import { TokenMedia } from "../../nft/TokenMedia"
import { ErrorState, Loading, Pill } from "../../kit"
import { Back, ReadFailure } from "./parts"
import type { NftScreen } from "./screen"
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

function Curation({ record, revealed, reveal }: { record: UseQueryResult<CurationRecord>; revealed: boolean; reveal: () => void }) {
    const showAnyway = !revealed && <button type="button" className="os-btn os-quiet" onClick={reveal}>Show anyway</button>
    if (record.isPending) return <Loading label="Reading curation…" />
    if (record.isError) {
        return <>
            <ErrorState message="Curation could not be read. The collection's image, banner, description and token art stay collapsed until it is." onRetry={record.error instanceof ReadError ? () => void record.refetch() : undefined} />
            {showAnyway}
        </>
    }
    const { verified, featured, hidden } = record.data
    return <>
        <div className="os-row">
            {verified && <Pill tone="ok">Verified</Pill>}
            {featured && <Pill tone="ok">Featured</Pill>}
            {hidden && <Pill tone="warn">Hidden by curators</Pill>}
            {!verified && !featured && !hidden && <span className="os-sub">No curation mark.</span>}
        </div>
        {hidden && (
            <div className="os-note os-warn os-row" role="note">
                <span className="os-grow">Curators have hidden this collection for now. {revealed ? "You chose to show it." : "Its image, banner, description and token art are collapsed."}</span>
                {showAnyway}
            </div>
        )}
    </>
}

function Profile({ screen, collection }: { screen: NftScreen; collection: NftCollection }) {
    const curated = isRealmValidOn(screen.network, NFT_CURATION_PATH)
    const [revealed, setRevealed] = useState(false)
    const record = useQuery({
        queryKey: ["nft", "curation", "record", screen.chainId, collection.id],
        queryFn: () => getCurationRecord(collection.id),
        enabled: curated,
        staleTime: 60_000, retry: false,
    })
    const shown = !curated || revealed || record.data?.hidden === false
    const name = revealInvisibleFormatting(collection.name)
    const website = collection.website.startsWith("https://") ? mediaUrl(collection.website) : null
    return (
        <div className="os-stack">
            {shown && collection.banner !== "" && <TokenMedia uri={collection.banner} seed={collection.id} alt="" shape="banner" />}
            <div className="os-row os-nft-head">
                <span className="os-nft-avatar"><TokenMedia uri={shown ? collection.image || null : null} seed={collection.id} alt="" /></span>
                <span className="os-grow">
                    <h2 className="os-nft-title">{name}</h2>
                    <span className="os-sub os-block">{revealInvisibleFormatting(collection.symbol)} · {collection.id}</span>
                </span>
                <button type="button" className="os-btn" onClick={() => screen.trade({ kind: "collection", collection: collection.id })}>Trade on Market</button>
            </div>
            {shown && collection.description !== "" && <p className="os-break">{revealInvisibleFormatting(collection.description)}</p>}
            {collection.website !== "" && (website
                ? <a className="os-break" href={website} target="_blank" rel="noopener noreferrer">{revealInvisibleFormatting(collection.website)}</a>
                : <span className="os-sub os-break">Website (not a secure link): {revealInvisibleFormatting(collection.website)}</span>)}
            <People collection={collection} />
            <section aria-label="Curation">
                <h3 className="os-h">Curation</h3>
                {curated ? <Curation record={record} revealed={revealed} reveal={() => setRevealed(true)} /> : <p className="os-sub">Curation is not available on this network.</p>}
            </section>
            <Passport screen={screen} collection={collection} />
            <Stages screen={screen} collection={collection.id} />
            <TokenGrid screen={screen} collection={collection.id} showMedia={shown} />
        </div>
    )
}

export function CollectionProfile({ screen, id }: { screen: NftScreen; id: string }) {
    const collection = useQuery({
        queryKey: ["nft", "ledger", "collection", screen.chainId, id],
        queryFn: () => getCollection(id),
        staleTime: 60_000, retry: false,
    })
    return (
        <div className="os-stack">
            <Back label="Collections" onClick={() => screen.go({ kind: "home" })} />
            {collection.isPending ? <Loading label="Reading the collection…" />
                : collection.isError ? <ReadFailure error={collection.error} what="collection" refused={`There is no collection ${id} on this network.`} retry={() => void collection.refetch()} />
                : <Profile screen={screen} collection={collection.data} />}
        </div>
    )
}

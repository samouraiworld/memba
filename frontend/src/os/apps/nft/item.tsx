/**
 * One token: what the ledger says about it (owner, status, URI) and what its
 * metadata file shows. The ledger answer is required; the metadata file is
 * the creator's, fetched from the IPFS gateway only, and when it cannot be
 * shown the page says why instead of leaving a blank. While curators hide the
 * collection (or its record is unknown), the file is not read and the page
 * shows the ledger's facts only, until the viewer asks (see useCurationHide).
 *
 * @module os/apps/nft/item
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import { revealInvisibleFormatting } from "../../../lib/dao/v2Text"
import { getToken, type NftToken } from "../../../lib/nft/ledger"
import { TokenMetadataError, type NftTokenMetadata } from "../../../lib/nft/metadata"
import { TokenMedia } from "../../nft/TokenMedia"
import { ErrorState, Loading, Pill } from "../../kit"
import { Curation } from "./curation"
import { Back, ReadFailure } from "./parts"
import { RETIRED, metadataQuery, useCurationHide, type NftScreen } from "./screen"

const NOT_SHOWN: Record<Exclude<TokenMetadataError["reason"], "unavailable">, string> = {
    too_large: "The token's metadata file is larger than this app reads, so it is not shown.",
    not_json: "The token's metadata file is not a metadata file this app can read, so it is not shown.",
    unsupported: "The token's metadata is not on IPFS, so this app does not fetch it.",
}

function MetadataState({ uri, metadata }: { uri: string; metadata: UseQueryResult<NftTokenMetadata> }) {
    if (uri === "") return <p className="os-note" role="note">This token has no metadata address.</p>
    if (metadata.isPending) return <Loading label="Reading the token's metadata…" />
    if (!metadata.isError) return null
    const reason = metadata.error instanceof TokenMetadataError ? metadata.error.reason : null
    return reason !== null && reason !== "unavailable"
        ? <p className="os-note" role="note">{NOT_SHOWN[reason]}</p>
        : <ErrorState message="The token's metadata could not be fetched from the IPFS gateway." onRetry={() => void metadata.refetch()} />
}

function Token({ screen, token }: { screen: NftScreen; token: NftToken }) {
    const hide = useCurationHide(screen, token.collection)
    const metadata = useQuery({ ...metadataQuery(screen.chainId, token.uri), enabled: hide.shown && token.uri !== "" })
    const data = hide.shown ? metadata.data : undefined
    const label = `${token.collection} #${token.number}`
    const name = data?.name ? revealInvisibleFormatting(data.name) : label
    return (
        <div className="os-nft-item">
            <TokenMedia uri={data?.image ?? null} seed={`${token.collection}/${token.number}`} alt={name} />
            <div className="os-stack os-tight">
                <h2 className="os-nft-title">{name}</h2>
                {data?.name && <span className="os-sub">{label}</span>}
                {hide.curated && <Curation hide={hide} collapsed="The token's art and text" />}
                {hide.shown && <MetadataState uri={token.uri} metadata={metadata} />}
                {data?.description && <p className="os-break">{revealInvisibleFormatting(data.description)}</p>}
                {data && data.attributes.length > 0 && (
                    <dl className="os-kv" aria-label="Attributes">
                        {data.attributes.map((trait, index) => (
                            <div key={index} className="os-kv-row">
                                <dt className="os-break">{revealInvisibleFormatting(trait.trait_type)}</dt>
                                <dd className="os-break">{typeof trait.value === "string" ? revealInvisibleFormatting(trait.value) : trait.value}</dd>
                            </div>
                        ))}
                    </dl>
                )}
                <dl className="os-kv">
                    <div className="os-kv-row"><dt>Status</dt><dd>{token.status === "active" ? <Pill tone="ok">Active</Pill> : <Pill tone="neutral">{RETIRED[token.status]}</Pill>}</dd></div>
                    <div className="os-kv-row"><dt>Owner</dt><dd className="os-mono os-break">{token.owner || "None: the token no longer exists"}</dd></div>
                    <div className="os-kv-row"><dt>Token URI</dt><dd className="os-mono os-break">{token.uri || "None"}</dd></div>
                </dl>
                {token.status === "active" && (
                    <div className="os-row">
                        <button type="button" className="os-btn" onClick={() => screen.trade({ kind: "token", collection: token.collection, number: token.number })}>Trade on Market</button>
                    </div>
                )}
            </div>
        </div>
    )
}

export function TokenItem({ screen, collection, number }: { screen: NftScreen; collection: string; number: bigint }) {
    const token = useQuery({
        queryKey: ["nft", "ledger", "token", screen.chainId, collection, number.toString()],
        queryFn: () => getToken(collection, number),
        staleTime: 30_000, retry: false,
    })
    return (
        <div className="os-stack">
            <Back label={`Collection ${collection}`} onClick={() => screen.go({ kind: "collection", collection })} />
            {token.isPending ? <Loading label="Reading the token…" />
                : token.isError ? <ReadFailure error={token.error} what="token" refused={`Collection ${collection} has no token #${number} on this network.`} retry={() => void token.refetch()} />
                : <Token screen={screen} token={token.data} />}
        </div>
    )
}

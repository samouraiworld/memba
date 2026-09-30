/**
 * A collection's mint stages, read-only: when each is open, what it costs and
 * who may mint in it. Minting itself comes in a later version. The drops realm
 * is published on no network yet; where it is not allowlisted the section says
 * so without reading.
 *
 * @module os/apps/nft/stages
 */
import { useQuery } from "@tanstack/react-query"
import { isRealmValidOn } from "../../../lib/config"
import { NFT_DROPS_PATH, listStages, type NftStage, type NftStageKind } from "../../../lib/nft/drops"
import { formatAmount, formatBPS } from "../../../lib/nft/format"
import { Empty, Loading, Pill } from "../../kit"
import { ReadFailure } from "./parts"
import { when, type NftScreen } from "./screen"

const KIND: Record<NftStageKind, string> = { fixed: "Fixed price", allowlist: "Allowlist", holder: "Holders", dutch: "Dutch auction" }

/** `readAt` is when the stages were read (ms): a closed stage starting after it had not opened yet. */
function Stage({ screen, stage, readAt }: { screen: NftScreen; stage: NftStage; readAt: number }) {
    const amount = (value: bigint) => formatAmount(value, stage.currency)
    const status = stage.open ? "Open now" : stage.start * 1000n > BigInt(readAt) ? "Upcoming" : "Ended"
    return (
        <li className="os-card os-stack os-tight">
            <div className="os-row"><b>Stage {stage.index + 1} · {KIND[stage.kind]}</b><Pill tone={stage.open ? "ok" : "neutral"}>{status}</Pill></div>
            <dl className="os-kv">
                <div className="os-kv-row"><dt>Window</dt><dd>{when(stage.start)} to {when(stage.end)}</dd></div>
                <div className="os-kv-row"><dt>Price</dt><dd>{stage.kind === "dutch" ? `${amount(stage.price)}, falling to ${amount(stage.floor)}` : amount(stage.price)}</dd></div>
                {stage.kind === "dutch" && stage.open && <div className="os-kv-row"><dt>Price now</dt><dd>{amount(stage.currentPrice)}</dd></div>}
                <div className="os-kv-row"><dt>Currency</dt><dd className="os-mono os-break">{stage.currency}</dd></div>
                <div className="os-kv-row"><dt>Per wallet</dt><dd>{stage.kind === "allowlist" ? "Each allowed address has its own allowance" : `${stage.perWallet}`}</dd></div>
                <div className="os-kv-row"><dt>Minted</dt><dd>{stage.supplyCap === 0n ? `${stage.minted}, no stage cap` : `${stage.minted} / ${stage.supplyCap}`}</dd></div>
                {stage.kind === "holder" && (
                    <div className="os-kv-row"><dt>Gate</dt><dd>
                        Each token of <button type="button" className="os-btn os-quiet os-inline" onClick={() => screen.go({ kind: "collection", collection: stage.gate })}>{stage.gate}</button> pays for one mint
                    </dd></div>
                )}
                {stage.kind === "allowlist" && <div className="os-kv-row"><dt>Allowlist root</dt><dd className="os-mono" title={stage.root}>{stage.root.slice(0, 12)}…</dd></div>}
            </dl>
            <p className="os-sub">
                {stage.feeBPS === 0n ? "The creator receives the whole price." : `The treasury receives ${formatBPS(stage.feeBPS)} of each mint, the creator the rest.`}
                {" "}This split is fixed for the stage.
            </p>
        </li>
    )
}

export function Stages({ screen, collection }: { screen: NftScreen; collection: string }) {
    const available = isRealmValidOn(screen.network, NFT_DROPS_PATH)
    const stages = useQuery({
        queryKey: ["nft", "drops", "stages", screen.chainId, collection],
        queryFn: () => listStages(collection),
        enabled: available,
        staleTime: 30_000, retry: false,
    })
    return (
        <section aria-label="Mint stages">
            <h3 className="os-h">Mint stages</h3>
            {!available ? <p className="os-sub">Mint stages are not available on this network.</p>
                : stages.isPending ? <Loading label="Reading mint stages…" />
                : stages.isError ? <ReadFailure error={stages.error} what="mint stages" retry={() => void stages.refetch()} />
                : stages.data.length === 0 ? <Empty title="This collection has no mint stage." />
                : <div className="os-stack os-tight">
                    <ul className="os-list os-stack os-tight">{stages.data.map((stage) => <Stage key={stage.index} screen={screen} stage={stage} readAt={stages.dataUpdatedAt} />)}</ul>
                    <p className="os-note" role="note">Minting arrives in a later version of Memba OS.</p>
                </div>}
        </section>
    )
}

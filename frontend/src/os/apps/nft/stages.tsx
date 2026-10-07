/**
 * A collection's mint stages: when each is open, what it costs and who may
 * mint in it, and a Mint button on an open stage Memba can mint in (see
 * lib/nft/mint). Guests read everything and are asked to connect only when
 * they mint. The drops realm is published on no network yet; where it is not
 * allowlisted the section says so without reading.
 *
 * @module os/apps/nft/stages
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { isRealmValidOn } from "../../../lib/config"
import { networkGasPriceFresh } from "../../../lib/grc20"
import { NFT_DROPS_PATH, listStages, mintedBy, type NftStage, type NftStageKind } from "../../../lib/nft/drops"
import { formatAmount, formatBPS, formatTime } from "../../../lib/nft/format"
import { NATIVE_CURRENCY, mintBlocker, supplyBlocker, type MintSupply } from "../../../lib/nft/mint"
import { ReadError, RealmRefusedError } from "../../../lib/nft/read"
import { laneClosedReason, readActionStatus } from "../../../lib/tokenLaunchpadConfigClient"
import { TokenLaunchpadReadError } from "../../../lib/tokenLaunchpadClient"
import { useSigner } from "../../sign/signerContext"
import type { OsSession } from "../../shell/useOsSession"
import { Empty, Loading, Pill } from "../../kit"
import { assertGateToken, mintRequest } from "./mintRequest"
import { ReadFailure } from "./parts"
import { launchpadReadFailure, type NftScreen } from "./screen"

const KIND: Record<NftStageKind, string> = { fixed: "Fixed price", allowlist: "Allowlist", holder: "Holders", dutch: "Dutch auction" }

/** A failed check before the review, in words a member can act on. */
function reason(err: unknown): string {
    if (err instanceof ReadError) return "The network could not be read. Try again in a moment."
    if (err instanceof RealmRefusedError) return "The network refused this read. Refresh the collection."
    if (err instanceof TokenLaunchpadReadError) return launchpadReadFailure(err)
    return err instanceof Error ? err.message : String(err)
}

interface MintTarget { collection: string; collectionName: string; supply: MintSupply }

/**
 * Mint one token: everything the sheet shows is read at this click (fee, the
 * lane, the member's count, the gate token), so a closed lane or a used gate
 * token is said here rather than in the sheet.
 */
function MintAction({ screen, session, target, stage }: { screen: NftScreen; session: OsSession; target: MintTarget; stage: NftStage }) {
    const signer = useSigner()
    const client = useQueryClient()
    const [gate, setGate] = useState("")
    const [busy, setBusy] = useState(false)
    // From the moment a mint is sent until its outcome is known: a second click would sign a second mint.
    const [pending, setPending] = useState(false)
    const [error, setError] = useState("")
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
    const blocker = stage.open ? supplyBlocker(target.supply) || mintBlocker(stage) : mintBlocker(stage)
    if (blocker) return stage.open ? <p className="os-sub">{blocker}</p> : null

    const holder = stage.kind === "holder"
    const mint = async () => {
        if (session.status !== "member") { session.openConnect(); return }
        setError("")
        const gateNumber = holder ? (/^[1-9]\d{0,18}$/.test(gate.trim()) ? BigInt(gate.trim()) : 0n) : 0n
        if (holder && gateNumber === 0n) { setError(`Enter the number of the ${stage.gate} token that allows this mint.`); return }
        setBusy(true)
        try {
            const caller = session.address
            const [price, lane, minted] = await Promise.all([
                networkGasPriceFresh(), readActionStatus(screen.network, "nft_drops", NATIVE_CURRENCY), mintedBy(target.collection, stage.index, caller),
            ])
            if (!lane.open) throw new Error(laneClosedReason(lane, "Minting"))
            // mintRequest refuses a member at the stage's wallet limit, with its reason.
            if (holder) await assertGateToken(target.collection, stage, gateNumber, caller)
            if (!alive.current) return
            const request = mintRequest({
                ...target, stage, gateNumber, mintedSoFar: minted, caller,
                networkKey: screen.network, chainId: screen.chainId, price,
                onSettled: (outcome) => {
                    if (alive.current) setPending(false)
                    if (outcome !== "confirmed" && outcome !== "submitted") return
                    void client.invalidateQueries({ queryKey: ["nft", "drops", "stages", screen.chainId, target.collection] })
                    void client.invalidateQueries({ queryKey: ["nft", "ledger"] })
                },
            })
            signer.sign({
                ...request,
                send: (choice, beforeSign) => { setPending(true); return request.send(choice, beforeSign) },
                // A recheck that refuses, or a wallet cancelled before signing, ends here and is never settled.
                onNothingSent: () => { if (alive.current) setPending(false); request.onNothingSent?.() },
            })
        } catch (err) {
            if (alive.current) setError(reason(err))
        } finally {
            if (alive.current) setBusy(false)
        }
    }
    return (
        <div className="os-stack os-tight">
            <div className="os-row">
                {holder && (
                    <label className="os-row os-tight-row os-nft-gate">
                        <span>{stage.gate} token #</span>
                        <input inputMode="numeric" size={8} value={gate} onChange={(event) => setGate(event.target.value)} aria-label={`Number of the ${stage.gate} token that allows this mint`} />
                    </label>
                )}
                <button type="button" className="os-btn" disabled={busy || pending} onClick={() => void mint()}>
                    {busy ? "Checking…" : pending ? "Minting…" : session.status === "member" ? "Mint" : "Connect to mint"}
                </button>
            </div>
            {error && <p className="os-note os-warn" role="alert">{error}</p>}
        </div>
    )
}

/** `readAt` is when the stages were read (ms): a closed stage starting after it had not opened yet. */
function Stage({ screen, session, target, stage, readAt }: { screen: NftScreen; session: OsSession; target: MintTarget; stage: NftStage; readAt: number }) {
    const amount = (value: bigint) => formatAmount(value, stage.currency)
    const upcoming = !stage.open && stage.start * 1000n > BigInt(readAt)
    const status = stage.open ? "Open now" : upcoming ? "Upcoming" : "Ended"
    const soldOut = stage.supplyCap > 0n && stage.minted >= stage.supplyCap
    return (
        <li className="os-card os-stack os-tight">
            <div className="os-row"><b>Stage {stage.index + 1} · {KIND[stage.kind]}</b><Pill tone={stage.open ? "ok" : "neutral"}>{status}</Pill>{soldOut && <Pill tone="neutral">Sold out</Pill>}</div>
            <dl className="os-kv">
                <div className="os-kv-row"><dt>Window</dt><dd>{formatTime(stage.start)} to {formatTime(stage.end)}</dd></div>
                <div className="os-kv-row"><dt>Price</dt><dd>{stage.kind === "dutch" ? `${amount(stage.price)}, falling to ${amount(stage.floor)}` : amount(stage.price)}</dd></div>
                {stage.kind === "dutch" && stage.open && <div className="os-kv-row"><dt>Price now</dt><dd>{amount(stage.currentPrice)}</dd></div>}
                <div className="os-kv-row"><dt>Currency</dt><dd className="os-mono os-break">{stage.currency}</dd></div>
                <div className="os-kv-row"><dt>Per wallet</dt><dd>{stage.kind === "allowlist" ? "Each allowed address has its own allowance" : `${stage.perWallet}`}</dd></div>
                <div className="os-kv-row"><dt>Minted</dt><dd>{stage.supplyCap === 0n ? `${stage.minted}, no stage cap` : `${stage.minted} / ${stage.supplyCap}`}</dd></div>
                {stage.kind === "holder" && (
                    <div className="os-kv-row"><dt>Gate</dt><dd>
                        Each token of <button type="button" className="os-btn os-quiet os-inline" onClick={() => screen.go({ kind: "collection", collection: stage.gate })}>{stage.gate}</button> allows one mint
                    </dd></div>
                )}
                {stage.kind === "allowlist" && <div className="os-kv-row"><dt>Allowlist root</dt><dd className="os-mono os-break">{stage.root}</dd></div>}
            </dl>
            <p className="os-sub">
                {stage.feeBPS === 0n ? "The creator receives the whole price." : `The treasury receives ${formatBPS(stage.feeBPS)} of each mint, the creator the rest.`}
                {/* EditStage replaces a stage only before it starts. */}
                {upcoming ? " The creator can still change this stage, this split included, until it starts." : " This split is fixed for the stage."}
            </p>
            <MintAction screen={screen} session={session} target={target} stage={stage} />
        </li>
    )
}

/** Read again shortly after the next upcoming stage starts, so its Mint button appears without a refresh. */
function untilNextStart(stages: NftStage[] | undefined): number | false {
    const now = Date.now()
    const next = (stages ?? []).filter((stage) => !stage.open && Number(stage.start) * 1000 > now - 60_000)
        .map((stage) => Number(stage.start) * 1000).sort((a, b) => a - b)[0]
    if (next === undefined || next - now > 10 * 60_000) return false
    return Math.max(next - now + 2_000, 5_000)
}

export function Stages({ screen, session, collection, collectionName, supply }: { screen: NftScreen; session: OsSession; collection: string; collectionName: string; supply: MintSupply }) {
    const available = isRealmValidOn(screen.network, NFT_DROPS_PATH)
    const stages = useQuery({
        queryKey: ["nft", "drops", "stages", screen.chainId, collection],
        queryFn: () => listStages(collection),
        enabled: available,
        staleTime: 30_000, retry: false,
        refetchInterval: (query) => untilNextStart(query.state.data),
    })
    return (
        <section aria-label="Mint stages">
            <h3 className="os-h">Mint stages</h3>
            {!available ? <p className="os-sub">Mint stages are not available on this network.</p>
                : stages.isPending ? <Loading label="Reading mint stages…" />
                : stages.isError ? <ReadFailure error={stages.error} what="mint stages" retry={() => void stages.refetch()} />
                : stages.data.length === 0 ? <Empty title="This collection has no mint stage." />
                : <div className="os-stack os-tight">
                    <ul className="os-list os-stack os-tight">{stages.data.map((stage) => (
                        <Stage key={stage.index} screen={screen} session={session} target={{ collection, collectionName, supply }} stage={stage} readAt={stages.dataUpdatedAt} />
                    ))}</ul>
                </div>}
        </section>
    )
}

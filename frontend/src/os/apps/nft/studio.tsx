/**
 * The creator studio. `studio` lists the collections the connected account
 * created, read from the ledger newest first a page at a time (it keeps no
 * index by creator). `studio/<id>` is one collection's stages: the creator
 * schedules a fixed-price, dutch or holder stage and ends an open one. A guest
 * sees the same controls and connects at the review, which the creator alone
 * can sign; another account reads the stages and is told only the creator
 * manages them.
 *
 * @module os/apps/nft/studio
 */
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState, type Ref } from "react"
import { revealInvisibleFormatting } from "../../../lib/dao/v2Text"
import { networkGasPriceFresh } from "../../../lib/grc20"
import { getDropTerms, listStages, type NftStage } from "../../../lib/nft/drops"
import { formatTime } from "../../../lib/nft/format"
import { countCollections, listCollectionsPage } from "../../../lib/nft/ledger"
import { ReadError, RealmRefusedError } from "../../../lib/nft/read"
import { stageProblem, type StageTerms, type StudioStageKind } from "../../../lib/nft/studio"
import { laneClosedReason, readActionStatus } from "../../../lib/tokenLaunchpadConfigClient"
import { TokenLaunchpadReadError } from "../../../lib/tokenLaunchpadClient"
import type { SignRequest } from "../../sign/signer"
import { useSigner } from "../../sign/signerContext"
import type { OsSession } from "../../shell/useOsSession"
import { parseGnot } from "../../wallet/send"
import { Card, CardGrid, Empty, ErrorState, Gate, Loading } from "../../kit"
import { Back, ReadFailure } from "./parts"
import { collectionQuery, launchpadReadFailure, type NftScreen } from "./screen"
import { addStageRequest, endStageRequest } from "./studioRequest"

const PAGE = 50

function reason(err: unknown): string {
    if (err instanceof ReadError) return "The network could not be read. Try again in a moment."
    if (err instanceof RealmRefusedError) return "The network refused this read. Refresh the collection."
    if (err instanceof TokenLaunchpadReadError) return launchpadReadFailure(err)
    return err instanceof Error ? err.message : String(err)
}

/** One signing control: a member's click reads what the sheet needs and opens it, or keeps why it could not. */
function useStudioAction(session: OsSession, collection: string, chainId: string) {
    const signer = useSigner()
    const client = useQueryClient()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
    const afterSign = (outcome: string) => {
        if (outcome === "confirmed" || outcome === "submitted") void client.invalidateQueries({ queryKey: ["nft", "drops", "stages", chainId, collection] })
    }
    const run = async (open: (caller: string) => Promise<SignRequest>) => {
        if (session.status !== "member") { session.openConnect(); return }
        setError("")
        setBusy(true)
        try {
            const request = await open(session.address)
            if (alive.current) signer.sign(request)
        } catch (err) {
            if (alive.current) setError(reason(err))
        } finally {
            if (alive.current) setBusy(false)
        }
    }
    return { busy, error, setError, run, afterSign }
}

/** The account's collections, newest first, scanning the ledger a page at a time. */
function MyCollections({ screen, creator }: { screen: NftScreen; creator: string }) {
    const count = useQuery({ queryKey: ["nft", "ledger", "count", screen.chainId], queryFn: countCollections, staleTime: 60_000, retry: false })
    const last = count.data === undefined || count.data === 0n ? null : (count.data - 1n) / BigInt(PAGE)
    const pages = useInfiniteQuery({
        queryKey: ["nft", "ledger", "studio-scan", screen.chainId, creator, String(last)],
        queryFn: ({ pageParam }) => listCollectionsPage(pageParam, PAGE),
        initialPageParam: last ?? 0n,
        getNextPageParam: (_page, _all, page) => (page > 0n ? page - 1n : undefined),
        enabled: last !== null,
        staleTime: 60_000, retry: false,
    })
    if (count.isPending || (last !== null && pages.isPending)) return <Loading label="Reading your collections…" />
    if (count.isError) return <ReadFailure error={count.error} what="collections" retry={() => void count.refetch()} />
    if (pages.isError && !pages.isFetchNextPageError) return <ReadFailure error={pages.error} what="collections" retry={() => void pages.refetch()} />
    const mine = (pages.data?.pages ?? []).flatMap((page) => [...page].reverse()).filter((row) => row.creator === creator)
    const scanned = (pages.data?.pages ?? []).reduce((sum, page) => sum + page.length, 0)
    return (
        <div className="os-stack os-tight">
            {mine.length > 0 ? (
                <CardGrid>{mine.map((row) => (
                    <Card key={row.id} onClick={() => screen.go({ kind: "studio-collection", collection: row.id })}>
                        <span className="os-grow" style={{ overflowWrap: "anywhere" }}>
                            <b>{revealInvisibleFormatting(row.name)}</b>
                            <span className="os-sub os-block">{revealInvisibleFormatting(row.symbol)} · {row.id} · {row.minted.toString()} minted</span>
                        </span>
                    </Card>
                ))}</CardGrid>
            ) : !pages.hasNextPage && <Empty title="This account has created no collection yet." />}
            {pages.isFetchNextPageError ? <ErrorState message="More collections could not be read." onRetry={() => void pages.fetchNextPage()} />
                : pages.hasNextPage && (
                    <div className="os-row">
                        <span className="os-sub os-grow">The newest {scanned} of {count.data?.toString()} collections were searched.</span>
                        <button type="button" className="os-btn os-quiet" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>{pages.isFetchingNextPage ? "Searching…" : "Search older collections"}</button>
                    </div>
                )}
        </div>
    )
}

/** `back` goes on the control back to Collections, which takes focus when this screen is opened from another. */
export function Studio({ screen, session, back }: { screen: NftScreen; session: OsSession; back: Ref<HTMLButtonElement> }) {
    return (
        <div className="os-stack">
            <Back ref={back} label="Collections" onClick={() => screen.go({ kind: "home" })} />
            <div className="os-row">
                <h2 className="os-h os-flush os-grow">Creator studio</h2>
                <button type="button" className="os-btn" onClick={() => screen.go({ kind: "create" })}>Create a collection</button>
            </div>
            {session.status === "member" ? <MyCollections screen={screen} creator={session.address} />
                : session.status === "resuming" ? <Loading label="Restoring your session…" />
                : <Gate text="Connect a wallet to manage the collections it created." action={<button type="button" className="os-btn" onClick={session.openConnect}>Connect</button>} />}
        </div>
    )
}

/** A datetime-local value as Unix seconds, or null. */
const seconds = (value: string) => {
    const ms = new Date(value).getTime()
    return value === "" || Number.isNaN(ms) ? null : BigInt(Math.floor(ms / 1000))
}
/** A GNOT amount that may be zero: empty or "0" is a free mint. */
const amount = (text: string) => (text.trim() === "" || /^0+(\.0+)?$/.test(text.trim()) ? 0n : parseGnot(text))
const whole = (text: string, empty: bigint) => (text.trim() === "" ? empty : /^\d{1,19}$/.test(text.trim()) ? BigInt(text.trim()) : null)

function AddStage({ screen, session, collection, stages }: { screen: NftScreen; session: OsSession; collection: string; stages: NftStage[] }) {
    const action = useStudioAction(session, collection, screen.chainId)
    const [form, setForm] = useState({ kind: "fixed" as StudioStageKind, start: "", end: "", price: "", floor: "", perWallet: "1", supplyCap: "", gate: "" })
    const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
    const build = (): StageTerms | string => {
        const start = seconds(form.start), end = seconds(form.end)
        if (start === null || end === null) return "Choose when the stage starts and ends."
        const price = amount(form.price), floor = form.kind === "dutch" ? amount(form.floor) : 0n
        if (price === null || floor === null) return "Write prices in GNOT, such as 12.5."
        const perWallet = whole(form.perWallet, 0n), supplyCap = whole(form.supplyCap, 0n)
        if (perWallet === null || supplyCap === null) return "The wallet limit and the stage cap are whole numbers."
        const terms: StageTerms = { kind: form.kind, start, end, price, floor, perWallet, supplyCap, gate: form.kind === "holder" ? form.gate.trim() : "" }
        return stageProblem(collection, terms, BigInt(Math.floor(Date.now() / 1000)), stages) || terms
    }
    const submit = () => {
        const terms = build()
        if (typeof terms === "string") { action.setError(terms); return }
        void action.run(async (caller) => {
            const [gas, lane, drop] = await Promise.all([networkGasPriceFresh(), readActionStatus(screen.network, "nft_drops", "ugnot"), getDropTerms("ugnot")])
            if (!lane.open) throw new Error(laneClosedReason(lane, "Minting"))
            if (drop.primaryFeeBPS === null) throw new Error("New stages are not open on this network: the protocol fee is not set.")
            return addStageRequest({ collection, terms, feeBPS: drop.primaryFeeBPS, existing: stages, caller, networkKey: screen.network, chainId: screen.chainId, gas, onSettled: action.afterSign })
        })
    }
    const input = (label: string, key: keyof typeof form, type = "text", hint?: string) => (
        <label className="os-stack os-tight"><span>{label}</span><input type={type} inputMode={type === "text" ? "decimal" : undefined} value={form[key]} onChange={(event) => set(key, event.target.value)} />{hint && <span className="os-sub">{hint}</span>}</label>
    )
    return (
        <section aria-label="Schedule a stage" className="os-stack os-tight os-nft-form">
            <h3 className="os-h">Schedule a stage</h3>
            <label className="os-stack os-tight"><span>Kind</span>
                <select value={form.kind} onChange={(event) => set("kind", event.target.value)}>
                    <option value="fixed">Fixed price</option>
                    <option value="dutch">Dutch auction</option>
                    <option value="holder">Holders of another collection</option>
                </select>
            </label>
            {input("Starts", "start", "datetime-local")}
            {input("Ends", "end", "datetime-local")}
            <span className="os-sub">Times are your local time.</span>
            {input(form.kind === "dutch" ? "Starting price in GNOT" : "Price in GNOT", "price")}
            {form.kind === "dutch" && input("Floor price in GNOT", "floor")}
            {input("Per wallet", "perWallet")}
            {input("Stage cap", "supplyCap", "text", "Empty for no cap beyond the collection's.")}
            {form.kind === "holder" && input("Gate collection", "gate", "text", "Each token this collection has minted when the stage is scheduled allows one mint; tokens minted later do not. Such as C1.")}
            <div className="os-row"><button type="button" className="os-btn" disabled={action.busy} onClick={submit}>{action.busy ? "Checking…" : "Review the stage"}</button></div>
            {action.error && <p className="os-note os-warn" role="alert">{action.error}</p>}
        </section>
    )
}

function EndStage({ screen, session, collection, stage }: { screen: NftScreen; session: OsSession; collection: string; stage: NftStage }) {
    const action = useStudioAction(session, collection, screen.chainId)
    const end = () => void action.run(async (caller) => endStageRequest({ collection, stage, caller, networkKey: screen.network, chainId: screen.chainId, gas: await networkGasPriceFresh(), onSettled: action.afterSign }))
    return (
        <div className="os-stack os-tight">
            <div className="os-row"><button type="button" className="os-btn os-quiet" disabled={action.busy} onClick={end}>{action.busy ? "Checking…" : "End this stage now"}</button></div>
            {action.error && <p className="os-note os-warn" role="alert">{action.error}</p>}
        </div>
    )
}

/** `back` goes on the control back to the studio, which takes focus when this screen is opened from another. */
export function CollectionStudio({ screen, session, id, back }: { screen: NftScreen; session: OsSession; id: string; back: Ref<HTMLButtonElement> }) {
    const collection = useQuery(collectionQuery(screen.chainId, id))
    const stages = useQuery({ queryKey: ["nft", "drops", "stages", screen.chainId, id], queryFn: () => listStages(id), staleTime: 30_000, retry: false })
    const member = session.status === "member"
    // A guest may be the creator: it sees what a creator sees and connects at the review.
    const acts = member ? collection.data?.creator === session.address : true
    return (
        <div className="os-stack">
            <Back ref={back} label="Studio" onClick={() => screen.go({ kind: "studio" })} />
            {collection.isPending ? <Loading label="Reading the collection…" />
                : collection.isError ? <ReadFailure error={collection.error} what="collection" refused={`There is no collection ${id} on this network.`} retry={() => void collection.refetch()} />
                : (
                    <>
                        <div className="os-row">
                            <h2 className="os-h os-flush os-grow">{revealInvisibleFormatting(collection.data.name)} · {id}</h2>
                            <button type="button" className="os-btn os-quiet" onClick={() => screen.go({ kind: "collection", collection: id })}>Collection profile</button>
                        </div>
                        {!acts && <p className="os-note" role="note">Only the collection's creator schedules and ends its stages.</p>}
                        {!member && <p className="os-note" role="note">Connect as the collection's creator to schedule or end its stages.</p>}
                        <section aria-label="Stages">
                            <h3 className="os-h">Stages</h3>
                            {stages.isPending ? <Loading label="Reading the stages…" />
                                : stages.isError ? <ReadFailure error={stages.error} what="mint stages" retry={() => void stages.refetch()} />
                                : stages.data.length === 0 ? <Empty title="No stage is scheduled." />
                                : <ul className="os-list os-stack os-tight">{stages.data.map((stage) => (
                                    <li key={stage.index} className="os-card os-stack os-tight">
                                        <b>Stage {stage.index + 1} · {stage.kind} · {stage.open ? "open now" : stage.start * 1000n > BigInt(stages.dataUpdatedAt) ? "upcoming" : "ended"}</b>
                                        <span className="os-sub">{formatTime(stage.start)} to {formatTime(stage.end)} · {stage.minted.toString()} minted</span>
                                        {acts && stage.open && <EndStage screen={screen} session={session} collection={id} stage={stage} />}
                                    </li>
                                ))}</ul>}
                        </section>
                        {acts && stages.isSuccess && (stages.data.length < 10
                            ? <AddStage screen={screen} session={session} collection={id} stages={stages.data} />
                            : <p className="os-sub">This collection has used its 10 stages.</p>)}
                    </>
                )}
        </div>
    )
}

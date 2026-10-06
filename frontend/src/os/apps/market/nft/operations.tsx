/**
 * Market NFT lane, Operations (`nfts/ops`, `nfts/ops/c/<id>`): the curation
 * desk. Anyone reads the seats, the managers and every application with its
 * statement and latest decision, each text shown only when its bytes match the
 * hash on chain. A collection's creator applies (or files again) with a
 * statement; a seated manager with no conflict on the collection decides with
 * a reason. Each text is pinned to IPFS first, so the review sheet shows the
 * exact pair the call commits.
 *
 * @module os/apps/market/nft/operations
 */
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { networkGasPriceFresh } from "../../../../lib/grc20"
import {
    getApplication, getCurationAccess, getCurationManagers, getCurationState, listApplications, type CurationApplication,
} from "../../../../lib/nft/curation"
import { EvidenceError, fetchCommitted, MAX_EVIDENCE_BYTES, pinEvidence } from "../../../../lib/nft/evidence"
import { DECISION_LABEL, REVIEW_DECISIONS, type ReviewDecision } from "../../../../lib/nft/review"
import { Empty, ErrorState, Loading, Pill } from "../../../kit"
import type { OsSession } from "../../../shell/useOsSession"
import { ActionError } from "./actions"
import { CollectionName, ReadFailure } from "./orders"
import { useCollection, utc, type LaneProps } from "./reads"
import { applyRequest, reviewRequest } from "./reviewRequest"
import { useSignAction } from "./signing"

const PAGE = 20
const TONE = { submitted: "neutral", changes_requested: "warn", recommended: "ok", declined: "warn" } as const

const useCurationState = (chainId: string) => useQuery({ queryKey: ["nft", "curation", chainId, "state"], queryFn: getCurationState, staleTime: 60_000, retry: false })
const useManagers = (chainId: string) => useQuery({ queryKey: ["nft", "curation", chainId, "managers"], queryFn: getCurationManagers, staleTime: 60_000, retry: false })

/** The seats, the managers, and every application, newest filing first as the realm lists them. */
export function Operations({ lane }: { lane: LaneProps }) {
    const state = useCurationState(lane.chainId)
    const managers = useManagers(lane.chainId)
    const applications = useInfiniteQuery({
        queryKey: ["nft", "curation", lane.chainId, "applications"],
        queryFn: ({ pageParam }) => listApplications(pageParam, PAGE),
        initialPageParam: 0,
        getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length : undefined),
        staleTime: 60_000, retry: false,
    })
    const rows = applications.data?.pages.flat() ?? []
    return (
        <>
            <p className="os-sub">Managers review the collections their creators submit. A recommendation is advice to the curation admin; marks such as Verified and Featured come from the admin and from two managers together.</p>
            <section aria-label="Managers">
                <h3 className="os-h">Managers</h3>
                {state.isError ? <ReadFailure error={state.error} what="curation seats" retry={() => void state.refetch()} />
                    : state.data && <p className="os-sub">{state.data.activeManagers} of {state.data.maxSeats} seats are filled. Admin: {state.data.admin || "none"}.</p>}
                {managers.isPending ? <Loading label="Reading managers…" />
                    : managers.isError ? <ReadFailure error={managers.error} what="managers" retry={() => void managers.refetch()} />
                    : managers.data.length === 0 ? <Empty title="No manager holds a seat." />
                    : <ul className="os-stack os-tight">{managers.data.map((m) => (
                        <li key={m.account} className="os-row"><span className="os-grow" style={{ overflowWrap: "anywhere" }}>{m.account}</span>{m.lead && <Pill tone="neutral">Lead</Pill>}<span className="os-sub">until {utc(m.until)}</span></li>
                    ))}</ul>}
            </section>
            <section aria-label="Applications">
                <h3 className="os-h">Applications</h3>
                {applications.isPending ? <Loading label="Reading applications…" />
                    : applications.isError && rows.length === 0 ? <ReadFailure error={applications.error} what="applications" retry={() => void applications.refetch()} />
                    : rows.length === 0 ? <Empty title="No collection has applied yet." />
                    : <ul className="os-stack os-tight">{rows.map((a) => (
                        <li key={a.collection}>
                            <button type="button" className="os-btn os-quiet os-row" onClick={() => lane.go({ kind: "application", collection: a.collection })}>
                                <span className="os-grow"><CollectionName chainId={lane.chainId} id={a.collection} /></span>
                                <Pill tone={TONE[a.status]}>{DECISION_LABEL[a.status]}</Pill>
                                <span className="os-sub">filing {a.revision.toString()}</span>
                            </button>
                        </li>
                    ))}</ul>}
                {applications.hasNextPage && <button type="button" className="os-btn os-quiet" disabled={applications.isFetchingNextPage} onClick={() => void applications.fetchNextPage()}>Load more</button>}
            </section>
        </>
    )
}

/** A committed text, shown only once its bytes match the hash on chain. */
function Committed({ chainId, cid, hash, what }: { chainId: string; cid: string; hash: string; what: string }) {
    const text = useQuery({ queryKey: ["nft", "curation", chainId, "text", cid, hash], queryFn: () => fetchCommitted(cid, hash), staleTime: Infinity, retry: false })
    if (text.isPending) return <Loading label={`Reading the ${what}…`} />
    if (text.isError) {
        const retry = text.error instanceof EvidenceError && text.error.reason === "unavailable" ? () => void text.refetch() : undefined
        return <ErrorState message={text.error instanceof EvidenceError && text.error.reason === "mismatch"
            ? `The ${what} fetched from IPFS does not match its hash on chain, so it is not shown.`
            : `The ${what} could not be read from IPFS.`} onRetry={retry} />
    }
    return <p className="os-note" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text.data}</p>
}

/** A text to pin, then a button that pins it and opens the review sheet. */
function TextForm({ label, hint, action, submit, children }: {
    label: string
    hint: string
    action: ReturnType<typeof useSignAction>
    submit: (text: string) => void
    children?: React.ReactNode
}) {
    const [text, setText] = useState("")
    const size = new TextEncoder().encode(text).length
    return (
        <div className="os-stack os-tight">
            {children}
            <label className="os-stack os-tight"><span>{hint}</span>
                <textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} />
            </label>
            <p className="os-sub">{size > MAX_EVIDENCE_BYTES ? "Longer than 16 KB: shorten it." : "Pinned to IPFS before you review the signature: the text is public from then on, even if you do not sign."}</p>
            <div className="os-row"><button type="button" className="os-btn" disabled={action.busy || text.trim() === "" || size > MAX_EVIDENCE_BYTES} onClick={() => submit(text)}>{action.busy ? "Pinning…" : label}</button></div>
            <ActionError error={action.error} />
        </div>
    )
}

function ApplyForm({ lane, session, collection, application }: { lane: LaneProps; session: OsSession; collection: string; application: CurationApplication | null }) {
    const action = useSignAction(session)
    const client = useQueryClient()
    const settled = (outcome: string) => { if (outcome === "confirmed" || outcome === "submitted") void client.invalidateQueries({ queryKey: ["nft", "curation"] }) }
    const submit = (text: string) => void action.run(async (caller) => {
        const gas = await networkGasPriceFresh()
        const commitment = await pinEvidence(text)
        return applyRequest({ collection, text, commitment, application, caller, networkKey: session.network.key, chainId: lane.chainId, gas, onSettled: settled })
    })
    return <TextForm label={application ? "Pin and file again" : "Pin and apply"} hint="Your statement: what the collection is, who made it, and why managers should recommend it." action={action} submit={submit} />
}

function ReviewForm({ lane, session, application }: { lane: LaneProps; session: OsSession; application: CurationApplication }) {
    const action = useSignAction(session)
    const client = useQueryClient()
    const [decision, setDecision] = useState<ReviewDecision>("changes_requested")
    const settled = (outcome: string) => { if (outcome === "confirmed" || outcome === "submitted") void client.invalidateQueries({ queryKey: ["nft", "curation"] }) }
    const submit = (text: string) => void action.run(async (caller) => {
        const gas = await networkGasPriceFresh()
        const commitment = await pinEvidence(text)
        return reviewRequest({ collection: application.collection, text, commitment, application, decision, caller, networkKey: session.network.key, chainId: lane.chainId, gas, onSettled: settled })
    })
    return (
        <TextForm label="Pin and decide" hint="Your reason, shown to the founder and to everyone." action={action} submit={submit}>
            <label className="os-row os-tight-row"><span>Decision on filing {application.revision.toString()}</span>
                <select value={decision} onChange={(event) => setDecision(event.target.value as ReviewDecision)}>
                    {REVIEW_DECISIONS.map((option) => <option key={option} value={option}>{DECISION_LABEL[option]}</option>)}
                </select>
            </label>
        </TextForm>
    )
}

/** What the connected account may do on this application: apply as its creator, or review as an unconflicted manager. */
function Desk({ lane, session, collection, application }: { lane: LaneProps; session: OsSession; collection: string; application: CurationApplication | null }) {
    const address = session.status === "member" ? session.address : ""
    const profile = useCollection(lane.chainId, collection)
    const access = useQuery({
        queryKey: ["nft", "curation", lane.chainId, "access", collection, address],
        queryFn: () => getCurationAccess(collection, address, lane.chainId),
        enabled: address !== "", staleTime: 60_000, retry: false,
    })
    if (address === "") {
        return (
            <div className="os-note os-row" role="note">
                <span className="os-grow">The collection's creator applies here, and seated managers review. Connect to act.</span>
                <button type="button" className="os-btn" onClick={session.openConnect}>Connect</button>
            </div>
        )
    }
    if (profile.data?.creator === address) {
        return application?.status === "recommended"
            ? <p className="os-sub">Your collection is recommended. A new filing is possible only after a manager decides otherwise.</p>
            : <section aria-label="Apply for review"><h4 className="os-h">{application ? "File again" : "Apply for review"}</h4><ApplyForm lane={lane} session={session} collection={collection} application={application} /></section>
    }
    if (access.isError) return <ReadFailure error={access.error} what="curation role" retry={() => void access.refetch()} />
    if (!access.data?.manager || application === null) return null
    if (access.data.conflicted) return <p className="os-sub">You are conflicted on this collection, so you cannot review it.</p>
    return <section aria-label="Review this application"><h4 className="os-h">Review</h4><ReviewForm lane={lane} session={session} application={application} /></section>
}

/** One collection's application: its latest filing, the decision on it, and what the viewer may do. */
export function Application({ lane, session, collection }: { lane: LaneProps; session: OsSession; collection: string }) {
    const application = useQuery({ queryKey: ["nft", "curation", lane.chainId, "application", collection], queryFn: () => getApplication(collection), staleTime: 60_000, retry: false })
    const a = application.data
    return (
        <>
            <div className="os-row">
                <h3 className="os-h os-flush os-grow" style={{ overflowWrap: "anywhere" }}><CollectionName chainId={lane.chainId} id={collection} /></h3>
                <button type="button" className="os-btn os-quiet" onClick={() => lane.go({ kind: "collection", collection })}>Listings and offers</button>
            </div>
            {application.isPending ? <Loading label="Reading the application…" />
                : application.isError ? <ReadFailure error={application.error} what="application" refused={`There is no collection ${collection} on this network.`} retry={() => void application.refetch()} />
                : a === null || a === undefined ? <p className="os-sub">This collection has not applied for review.</p>
                : <section aria-label="Latest filing" className="os-stack os-tight">
                    <div className="os-row"><Pill tone={TONE[a.status]}>{DECISION_LABEL[a.status]}</Pill><span className="os-sub">Filing {a.revision.toString()} by {a.founder}, updated {utc(a.updatedAt)}</span></div>
                    <h4 className="os-h">Statement</h4>
                    <Committed chainId={lane.chainId} cid={a.statementCID} hash={a.statementHash} what="statement" />
                    {a.reviewer !== "" && <>
                        <h4 className="os-h">{DECISION_LABEL[a.status]} by {a.reviewer}</h4>
                        <Committed chainId={lane.chainId} cid={a.reasonCID} hash={a.reasonHash} what="reason" />
                    </>}
                </section>}
            {application.isSuccess && <Desk lane={lane} session={session} collection={collection} application={application.data} />}
        </>
    )
}

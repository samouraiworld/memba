/**
 * Quests (v1.1) native home: the quest hub. A signed-in address gets the rank
 * and XP the Memba server recorded for it; a guest browses every quest and
 * sees what this browser saved. Filters live in the window's query. A quest's
 * own page, quest admin, reputation and the leaderboard stay the classic pages,
 * handed through as `fallback`. This window only reads the server: completing,
 * claiming and self-reporting are done on the quest's page. Opening it counts
 * as a page visit, as the classic hub does.
 *
 * @module os/apps/quests/native
 */
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react"
import { useQuery } from "@tanstack/react-query"
import { isPointsEnabled } from "../../../lib/config"
import { calculateRank, getComingSoonQuests, getLiveQuests, getQuestById, xpToNextRank, type GnoQuest } from "../../../lib/gnobuilders"
import { QUEST_NOT_ON_NETWORK_LABEL, isQuestAvailableOnNetwork, questHubStatus } from "../../../lib/questNetwork"
import { completedQuestIds, fetchUserQuests, hasUnsyncedQuests, loadQuestProgress, trackPageVisit, type UserQuestState } from "../../../lib/quests"
import { AttestationPanel } from "../../../components/quests/AttestationPanel"
import { Card, CardGrid, Chips, Empty, ErrorState, Gate, Loading, NotOnMainnet, Pill, StatGrid, type PillTone } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { classicForSection, classicHome, sectionForClassic } from "../../page/classicRoute"
import { specForTarget } from "../../shell/windows"
import "./native.css"

const CATEGORIES = [
    { id: "all", name: "All" },
    { id: "developer", name: "Developers" },
    { id: "everyone", name: "Everyone" },
    { id: "champion", name: "Champion" },
] as const
const DIFFICULTIES = [
    { id: "all", name: "Any difficulty" },
    { id: "beginner", name: "Beginner" },
    { id: "intermediate", name: "Intermediate" },
    { id: "advanced", name: "Advanced" },
    { id: "expert", name: "Expert" },
] as const
const STATUSES = [
    { id: "all", name: "Any state" },
    { id: "available", name: "Available" },
    { id: "completed", name: "Completed" },
    { id: "locked", name: "Locked" },
] as const
type QuestStatus = ReturnType<typeof questHubStatus>
const STATUS_PILL: Record<QuestStatus, { tone?: PillTone; name: string }> = {
    completed: { tone: "ok", name: "Completed" },
    available: { name: "Available" },
    locked: { tone: "neutral", name: "Locked" },
}

function pick<Id extends string>(value: string | null, options: readonly { id: Id }[]): Id {
    return options.find((o) => o.id === value)?.id ?? options[0].id
}

/** Why a locked quest is locked, in the words the quest's own page uses. */
function lockReason(quest: GnoQuest, network: string): string {
    if (!isQuestAvailableOnNetwork(quest.id, network)) return QUEST_NOT_ON_NETWORK_LABEL
    return quest.prerequisite ? `Requires ${getQuestById(quest.prerequisite)?.title ?? quest.prerequisite}` : ""
}

function Progress({ state, source, done, total }: { state: UserQuestState; source: string; done: number; total: number }) {
    const xp = state.totalXP
    const rank = calculateRank(xp)
    const toNext = xpToNextRank(xp)
    const next = toNext > 0 ? calculateRank(xp + toNext) : null
    return (
        <>
            <StatGrid stats={[
                { label: "Rank", value: rank.name, hint: next ? `${toNext} XP to ${next.name}` : "The highest rank" },
                { label: "XP", value: xp, hint: source },
                { label: "Quests completed", value: `${done} / ${total}` },
            ]} />
            {next && (
                <div className="os-bar" role="progressbar" aria-label={`XP toward ${next.name}`} aria-valuemin={rank.xpRequired} aria-valuemax={next.xpRequired} aria-valuenow={xp}>
                    <i style={{ width: `${((xp - rank.xpRequired) / (next.xpRequired - rank.xpRequired)) * 100}%` }} />
                </div>
            )}
        </>
    )
}

function Hub({ query, session, open, push, returnedRef }: Pick<NativeViewProps, "query" | "session" | "open" | "push"> & { returnedRef: RefObject<boolean> }) {
    const network = session.network.key
    const address = session.address
    // This browser's progress is kept per connected wallet, signed in or not (lib/quests scopes it so).
    const wallet = session.walletAddress
    // The one switch for the server read.
    const enabled = address !== ""
    const [local, setLocal] = useState(() => loadQuestProgress(wallet || null))
    const server = useQuery({
        queryKey: ["quests", "native-progress", session.network.chainId, address],
        // fetchUserQuests answers null when the server can't be reached: that is an error here, never "0 XP".
        queryFn: async () => {
            const state = await fetchUserQuests(address)
            if (!state) throw new Error("quest progress unavailable")
            return state
        },
        enabled,
        retry: false,
    })
    const { refetch } = server
    // Counts toward the quest for visiting five pages.
    useEffect(() => { trackPageVisit("quests") }, [])
    useEffect(() => {
        // A quest completed elsewhere in Memba (another window, the sign-in sync) shows here at once.
        const refresh = () => {
            setLocal(loadQuestProgress(wallet || null))
            if (enabled) void refetch()
        }
        window.addEventListener("quest-completed", refresh)
        window.addEventListener("quest-progress-updated", refresh)
        return () => {
            window.removeEventListener("quest-completed", refresh)
            window.removeEventListener("quest-progress-updated", refresh)
        }
    }, [wallet, enabled, refetch])

    // Coming back from a quest's page unmounts the link that had focus: land on the heading.
    const heading = useRef<HTMLHeadingElement>(null)
    useEffect(() => {
        if (!returnedRef.current) return
        returnedRef.current = false
        heading.current?.focus({ preventScroll: true })
    }, [returnedRef])

    const params = new URLSearchParams(query)
    const category = pick(params.get("category"), CATEGORIES)
    const difficulty = pick(params.get("difficulty"), DIFFICULTIES)
    const status = pick(params.get("status"), STATUSES)
    const q = params.get("q") ?? ""
    const [draft, setDraft] = useState(q)
    const [searched, setSearched] = useState(q)
    if (searched !== q) {
        setSearched(q)
        setDraft(q)
    }

    const spec = (section: string | null, nextQuery = "") => specForTarget({ kind: "app", app: "quests", section, query: nextQuery })!
    const filterQuery = (patch: { category?: string; difficulty?: string; status?: string; q?: string } = {}) => {
        const next = new URLSearchParams()
        for (const [key, value] of Object.entries({ category, difficulty, status, q, ...patch })) if (value && value !== "all") next.set(key, value)
        return next.toString()
    }
    // A filter refines this page: it replaces the address. A classic page is somewhere
    // else: a history entry, so Back returns to the hub.
    const filter = (patch: Parameters<typeof filterQuery>[0]) => open(spec(null, filterQuery(patch)))
    const openClassic = (page: string, nextQuery = "") => push(spec(sectionForClassic("quests", page), nextQuery))
    const search = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        filter({ q: draft.trim() })
    }
    // The quest's page returns to the hub with the same filters.
    const openQuest = (quest: GnoQuest) => {
        const from = filterQuery()
        openClassic(`quests/${quest.id}`, from ? new URLSearchParams({ from }).toString() : "")
    }

    const serverState = enabled && !server.isError ? server.data ?? null : null
    const completed = completedQuestIds(local, serverState)
    const live = getLiveQuests()
    const closed = getComingSoonQuests()
    const offNetwork = live.filter((quest) => !isQuestAvailableOnNetwork(quest.id, network))
    const done = live.filter((quest) => completed.has(quest.id)).length
    const term = q.trim().toLowerCase()
    const shown = live.filter((quest) => (category === "all" || quest.category === category)
        && (difficulty === "all" || quest.difficulty === difficulty)
        && (status === "all" || questHubStatus(quest.id, completed, network) === status)
        && (!term || quest.title.toLowerCase().includes(term) || quest.description.toLowerCase().includes(term) || quest.id.includes(term)))

    return (
        <div className="os-quests">
            <header className="os-quests-head">
                <div>
                    <h1 ref={heading} tabIndex={-1}>Quests</h1>
                    <p className="os-sub">Complete quests to earn XP and move up the ranks.</p>
                </div>
                <div className="os-row">
                    <button type="button" className="os-btn os-quiet" onClick={() => openClassic("leaderboard")}>Leaderboard</button>
                    {isPointsEnabled() && <button type="button" className="os-btn os-quiet" onClick={() => openClassic("points")}>Reputation</button>}
                </div>
            </header>

            {session.status === "resuming" && <Loading label="Restoring your session…" />}
            {session.status === "guest" && (
                <>
                    {local.completed.length > 0 && <Progress state={local} source="Saved in this browser" done={done} total={live.length} />}
                    <Gate text="Connect a wallet to see the rank, XP and completed quests recorded for your address. Every quest stays open to browse without one."
                        action={<button type="button" className="os-btn" onClick={session.openConnect}>Connect</button>} />
                </>
            )}
            {enabled && server.isPending && <Loading label="Reading your XP from the Memba server…" />}
            {enabled && server.isError && (
                <ErrorState message="Your XP and completed quests could not be read from the Memba server. The quest states below come from this browser only."
                    onRetry={() => void refetch()} />
            )}
            {serverState && (
                <>
                    <Progress state={serverState} source="Recorded by the Memba server" done={done} total={live.length} />
                    {hasUnsyncedQuests(local, serverState) && <p className="os-sub">This browser holds completed quests that are not in the server&rsquo;s record.</p>}
                </>
            )}

            {/* The panel the classic hub carries, as it is: it signs through the wallet itself and shows
                nothing until the Memba server issues attestation vouchers for this address. */}
            {wallet !== "" && <div className="os-quests-attest"><AttestationPanel address={wallet} /></div>}

            <div className="os-quests-filters">
                <Chips label="Category" value={category} onChange={(id) => filter({ category: id })}
                    options={CATEGORIES.map((c) => ({ ...c, count: c.id === "all" ? live.length : live.filter((quest) => quest.category === c.id).length }))} />
                <Chips label="Difficulty" options={DIFFICULTIES} value={difficulty} onChange={(id) => filter({ difficulty: id })} />
                <Chips label="State" options={STATUSES} value={status} onChange={(id) => filter({ status: id })} />
                <form className="os-quests-search" role="search" onSubmit={search}>
                    <input className="os-in" type="search" aria-label="Search quests" placeholder="Search quests" maxLength={100} value={draft} onChange={(event) => setDraft(event.target.value)} />
                    <button type="submit" className="os-btn os-quiet">Search</button>
                </form>
            </div>

            {offNetwork.length > 0 && (
                <NotOnMainnet network={session.network.chainId}
                    what={`Completing ${new Intl.ListFormat("en", { type: "conjunction" }).format(offNetwork.map((quest) => quest.title))}`} />
            )}

            <h2 className="os-h os-flush">{shown.length === live.length ? `${live.length} quests` : `${shown.length} of ${live.length} quests`}</h2>
            {shown.length === 0 ? (
                <Empty title="No quests match these filters." action={<button type="button" className="os-btn os-quiet" onClick={() => open(spec(null))}>Clear filters</button>} />
            ) : (
                <CardGrid>
                    {shown.map((quest) => {
                        const state = questHubStatus(quest.id, completed, network)
                        const reason = state === "locked" ? lockReason(quest, network) : ""
                        return (
                            <Card key={quest.id} onClick={() => openQuest(quest)}>
                                {/* The spaces keep the button's name in words: "First Package +20 XP Deploy…", not "XPDeploy". */}
                                <span className="os-grow os-quests-card">
                                    <span className="os-quests-title"><b>{quest.title}</b> <span className="os-quests-xp">+{quest.xp} XP</span></span>{" "}
                                    <span className="os-sub os-block">{quest.description}</span>{" "}
                                    <span className="os-quests-meta">
                                        <Pill tone={STATUS_PILL[state].tone}>{STATUS_PILL[state].name}</Pill>{" "}
                                        <span className="os-sub">{quest.difficulty[0].toUpperCase()}{quest.difficulty.slice(1)}{reason && ` · ${reason}`}</span>
                                    </span>
                                </span>
                            </Card>
                        )
                    })}
                </CardGrid>
            )}

            {closed.length > 0 && (
                <details className="os-quests-closed">
                    <summary>{closed.length} more quests cannot be completed yet</summary>
                    <p className="os-sub">No completion check exists for these quests yet, so their XP cannot be earned.</p>
                    <ul>
                        {closed.map((quest) => <li key={quest.id}><span>{quest.title}</span> <span className="os-quests-xp">+{quest.xp} XP</span></li>)}
                    </ul>
                </details>
            )}
        </div>
    )
}

export default function QuestsWindow({ section, query, session, open, push, fallback }: NativeViewProps) {
    const home = classicForSection("quests", section) === classicHome("quests")
    const returnedRef = useRef(false)
    useEffect(() => {
        if (!home) returnedRef.current = true
    }, [home])
    if (!home) return <>{fallback}</>
    // Keyed by wallet: another wallet starts from its own saved progress.
    return <Hub key={session.walletAddress} query={query} session={session} open={open} push={push} returnedRef={returnedRef} />
}

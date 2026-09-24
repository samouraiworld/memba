/**
 * V2ProposalView — one proposal of a version-2 DAO: its action, lifecycle
 * dates, voting power against the threshold and quorum, and the vote and
 * execute actions a member can take right now.
 *
 * All data comes from the realm's JSON reads. User text (title, description)
 * is rendered escaped, with invisible formatting characters made visible.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useOutletContext } from "react-router-dom"
import { sanitizeMarkdownHtml } from "../../lib/sanitizeMarkdownHtml"
import { GNO_CHAIN_ID, GNO_RPC_URL, getExplorerBaseUrl } from "../../lib/config"
import { getDAOConfig, getDAOMembers, invalidateProposalCache, type VoteChoice } from "../../lib/dao"
import { readV2Proposal, readV2Votes, type MembaV2Proposal } from "../../lib/dao/membaV2"
import { hasVotedOnV2, v2Context } from "../../lib/dao/membaV2Shell"
import { broadcastDaoTx, planDaoTx, planNeedsDepositOverride, type DaoTxPlan } from "../../lib/dao/daoTx"
import { WalletNetworkError } from "../../lib/walletNetworkGuard"
import { DepositOverride } from "./DepositOverride"
import { formatUgnot } from "../../lib/dao/v2Budget"
import { friendlyDaoError } from "../../lib/dao/errors"
import { hasInvisibleFormatting, revealInvisibleFormatting } from "../../lib/dao/v2Text"
import {
    V2_STATUS_EXPLANATIONS, V2_STATUS_LABELS, VOTES_ARE_FINAL,
    canVoteNow, executionState, formatChainTime, powerPercent, relativeTime,
} from "../../lib/dao/v2Lifecycle"
import { clearVoteCache } from "../../lib/dao/voteScanner"
import { renderMarkdown } from "../../lib/markdownLite"
import { logChainError } from "../../lib/errorLog"
import { useNetworkNav } from "../../hooks/useNetworkNav"
import { DAOIdentityLabel } from "../dao/DAOIdentityLabel"
import { CopyableAddress } from "../ui/CopyableAddress"
import { SkeletonCard } from "../ui/LoadingSkeleton"
import type { LayoutContext } from "../../types/layout"
import { TxStatus, type TxState } from "./TxStatus"
import { useCurrentRequest } from "../../hooks/useCurrentRequest"
import { beginGovernanceRequest, governanceRequestActive, clearGovernanceReceipt, readGovernanceReceipt, saveGovernanceReceipt } from "../../lib/dao/governanceRecovery"
import "../../pages/proposalview.css"
import "../dao/dao-shell.css"
import "./v2-proposal.css"

type Intent = { kind: "vote"; choice: VoteChoice } | { kind: "execute" }
/** `depositApproved`: the member allowed this plan's above-ceiling deposit cap in this dialog. */
type Pending = (Intent & { plan: DaoTxPlan; electorateVersion: number; needsDepositOverride: boolean; depositApproved: boolean }) | null

const ACTION_LABELS: Record<MembaV2Proposal["action"]["kind"], string> = {
    text: "Text proposal",
    add_member: "Add member",
    remove_member: "Remove member",
    set_roles: "Change roles",
    archive: "Archive the DAO",
}

function useNowSeconds(): number {
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
    useEffect(() => {
        const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000)
        return () => clearInterval(t)
    }, [])
    return now
}

function ActionDetails({ proposal }: { proposal: MembaV2Proposal }) {
    const a = proposal.action
    return (
        <dl className="v2p-facts">
            <dt>Action</dt>
            <dd>{ACTION_LABELS[a.kind]}</dd>
            {a.target && (<><dt>Member</dt><dd className="v2p-address">{a.target}</dd></>)}
            {a.kind === "add_member" && (<><dt>Voting power</dt><dd>{a.power.toLocaleString("en-US")}</dd></>)}
            {(a.kind === "add_member" || a.kind === "set_roles") && (<><dt>Roles</dt><dd>{a.roles.length > 0 ? a.roles.join(", ") : "No roles"}</dd></>)}
            {a.kind === "text" && (<><dt>Effect</dt><dd>None on chain; the decision is recorded.</dd></>)}
            {a.kind === "archive" && (<><dt>Effect</dt><dd>Permanent: no more proposals, votes or executions.</dd></>)}
        </dl>
    )
}

type Props = { realmPath: string; encodedSlug: string; proposalId: number }
export function V2ProposalView(props: Props) {
    const { auth, adena } = useOutletContext<LayoutContext>()
    return <ScopedV2ProposalView key={`${GNO_CHAIN_ID}:${props.realmPath}:${props.proposalId}:${adena.address}:${auth.isAuthenticated}`} {...props} />
}
function ScopedV2ProposalView({ realmPath, encodedSlug, proposalId }: Props) {
    const navigate = useNetworkNav()
    const queryClient = useQueryClient()
    const { auth, adena } = useOutletContext<LayoutContext>()
    const { isCurrent, assertCurrent } = useCurrentRequest()
    const scopes = useMemo(() => {
        const base = { chainId: GNO_CHAIN_ID, realmPath, caller: adena.address || "" }
        return { vote: { ...base, operation: `vote:${proposalId}` }, execute: { ...base, operation: `execute:${proposalId}` } }
    }, [realmPath, proposalId, adena.address])
    const [receipts, setReceipts] = useState(() => ({ vote: readGovernanceReceipt(scopes.vote), execute: readGovernanceReceipt(scopes.execute) }))
    const [acknowledged, setAcknowledged] = useState(false)
    const [recoveryMessage, setRecoveryMessage] = useState("")
    const now = useNowSeconds()
    const [pending, setPending] = useState<Pending>(null)
    const [tx, setTx] = useState<TxState>({ phase: "idle" })
    const confirmRef = useRef<HTMLButtonElement>(null)
    const address = adena.address || ""
    const ctx = v2Context(GNO_RPC_URL, realmPath)
    const validId = Number.isSafeInteger(proposalId) && proposalId > 0

    const proposalQuery = useQuery({
        queryKey: ["dao", "v2", "proposal", GNO_CHAIN_ID, realmPath, proposalId],
        enabled: validId,
        // A proposal created a moment ago can reach this page before the node serving reads has its block.
        retry: 3,
        retryDelay: 1500,
        queryFn: ({ signal }) => readV2Proposal(ctx, proposalId, signal),
        refetchInterval: (query) => (query.state.data?.status === "ACTIVE" || query.state.data?.status === "ACCEPTED" ? 30_000 : false),
    })
    const configQuery = useQuery({
        queryKey: ["dao", "config", realmPath],
        queryFn: () => getDAOConfig(GNO_RPC_URL, realmPath, true),
    })
    const membersQuery = useQuery({
        queryKey: ["dao", "members-list", realmPath, ""],
        queryFn: () => getDAOMembers(GNO_RPC_URL, realmPath, undefined, true),
    })
    const votesQuery = useQuery({
        queryKey: ["dao", "v2", "votes", GNO_CHAIN_ID, realmPath, proposalId],
        enabled: validId,
        queryFn: ({ signal }) => readV2Votes(ctx, proposalId, { offset: 0, limit: 50 }, signal),
    })
    const hasVotedQuery = useQuery({
        queryKey: ["dao", "v2", "hasVoted", GNO_CHAIN_ID, realmPath, proposalId, address],
        enabled: validId && !!address,
        queryFn: () => hasVotedOnV2(GNO_RPC_URL, realmPath, proposalId, address),
    })

    useEffect(() => {
        if (pending) confirmRef.current?.focus()
    }, [pending])

    const proposal = proposalQuery.data
    const config = configQuery.data?.v2
    const members = membersQuery.data ?? null

    if (proposalQuery.isPending && validId) {
        return <div className="animate-fade-in proposal-skeleton-col"><SkeletonCard /><SkeletonCard /></div>
    }
    if (!proposal) {
        return (
            <div className="animate-fade-in proposal-notfound" role="status">
                <p>Proposal #{validId ? proposalId : "?"} could not be read.</p>
                <p>It may not exist yet, or the network could not return it.</p>
                <button className="k-btn-secondary" onClick={() => { void proposalQuery.refetch() }}>Retry</button>
                <button className="proposal-notfound-back" onClick={() => navigate(`/dao/${encodedSlug}`)}>Back to DAO</button>
            </div>
        )
    }

    const member = members?.find((m) => m.address === address) ?? null
    const archived = config?.archived ?? proposal.status === "ARCHIVED"
    const voted = hasVotedQuery.data === true
    const myVote = votesQuery.data?.votes.find((v) => v.voter === address)?.choice
    const execState = executionState(proposal, now)
    const threshold = config?.threshold
    const quorum = config?.quorum ?? 0
    const cast = proposal.yes + proposal.no + proposal.abstain
    const ep = proposal.electorate_power
    const yesPct = powerPercent(proposal.yes, ep)
    const noPct = powerPercent(proposal.no, ep)
    const abstainPct = powerPercent(proposal.abstain, ep)
    const busy = tx.phase === "wallet" || tx.phase === "block"
    const description = proposal.description
    const invisible = hasInvisibleFormatting(proposal.title) || hasInvisibleFormatting(description)

    const plan = (next: Intent): DaoTxPlan | null => {
        if (!address) return null
        try {
            return next.kind === "vote"
                ? planDaoTx("memba-v2", realmPath, { type: "vote", id: proposal.id, vote: next.choice }, address)
                : planDaoTx("memba-v2", realmPath, { type: "execute", id: proposal.id }, address, { kind: proposal.action.kind, roles: proposal.action.roles })
        } catch {
            return null
        }
    }
    const pendingPlan = pending?.plan ?? null
    const openConfirmation = (next: Intent) => {
        const prepared = plan(next)
        if (!prepared || receipts[next.kind]) return
        let needsDepositOverride: boolean
        try { needsDepositOverride = planNeedsDepositOverride(prepared) } catch { return }
        setPending({ ...next, plan: prepared, electorateVersion: config?.electorate_version ?? -1, needsDepositOverride, depositApproved: false })
    }

    const run = async (next: Exclude<Pending, null>) => {
        setPending(null)
        // Sign the plan the dialog showed, so what was reviewed is what is signed.
        const p = next.plan
        if (!p || receipts[next.kind] || busy || (next.needsDepositOverride && !next.depositApproved)) return
        const action = next.kind === "vote" ? { type: "vote" as const, id: proposal.id, vote: next.choice } : { type: "execute" as const, id: proposal.id }
        const scope = scopes[next.kind]
        if (governanceRequestActive(scope)) return
        let finish = () => {}
        let walletStarted = false
        let knownHash = ""
        setTx({ phase: "wallet" })
        try {
            finish = beginGovernanceRequest(scope)
            const memo = next.kind === "vote" ? `Vote ${next.choice} on proposal #${proposal.id}` : `Execute proposal #${proposal.id}`
            saveGovernanceReceipt(scope, { phase: "intent", hash: "", label: memo })
            const res = await broadcastDaoTx(p, action, memo, async () => {
                assertCurrent()
                const [freshConfig, freshMembers, freshProposal, freshVoted] = await Promise.all([
                    getDAOConfig(GNO_RPC_URL, realmPath, true), getDAOMembers(GNO_RPC_URL, realmPath, undefined, true),
                    readV2Proposal(ctx, proposalId), hasVotedOnV2(GNO_RPC_URL, realmPath, proposalId, address),
                ])
                assertCurrent()
                if (!freshConfig?.v2 || freshConfig.v2.archived || !freshMembers.some(m => m.address === address)) throw new Error("DAO membership or availability changed. Review the action again.")
                if (freshConfig.v2.electorate_version !== next.electorateVersion || (next.kind === "vote" && freshProposal.electorate_version !== freshConfig.v2.electorate_version)) throw new Error("The proposal electorate changed. Refresh before signing.")
                const currentTime = Math.floor(Date.now() / 1000)
                if (next.kind === "vote" && (freshVoted !== false || !canVoteNow(freshProposal, currentTime))) throw new Error("This vote is no longer available. Refresh the proposal.")
                if (next.kind === "execute" && executionState(freshProposal, currentTime) !== "open") throw new Error("This proposal cannot be executed now. Refresh its status.")
                walletStarted = true
            }, { approvedDepositUgnot: next.needsDepositOverride && next.depositApproved ? p.maxDepositUgnot : undefined })
            knownHash = res.hash
            const saved = { phase: "submitted" as const, hash: res.hash, label: memo }
            try { saveGovernanceReceipt(scope, saved) } catch { if (isCurrent()) setRecoveryMessage("The receipt is kept in this tab only. Copy its hash before leaving.") }
            if (!isCurrent()) return
            setReceipts(current => ({ ...current, [next.kind]: saved }))
            setTx({ phase: "block", hash: res.hash })
            clearVoteCache()
            invalidateProposalCache(realmPath)
            const [readProposal, readVotes, readHasVoted] = await Promise.all([
                proposalQuery.refetch(),
                votesQuery.refetch(),
                hasVotedQuery.refetch(),
                queryClient.invalidateQueries({ queryKey: ["dao", "proposals", realmPath] }),
                next.kind === "execute" ? queryClient.invalidateQueries({ queryKey: ["dao", "config", realmPath] }) : Promise.resolve(),
                next.kind === "execute" ? queryClient.invalidateQueries({ queryKey: ["dao", "members-list", realmPath] }) : Promise.resolve(),
            ])
            if (!isCurrent()) return
            const verified = next.kind === "vote"
                ? readHasVoted.isSuccess && readHasVoted.data === true && readVotes.isSuccess && readVotes.data?.votes.some(v => v.voter === address && v.choice === next.choice)
                : readProposal.isSuccess && readProposal.data?.status === "EXECUTED"
            setTx(verified
                ? { phase: "confirmed", hash: res.hash, message: next.kind === "vote" ? `Your ${next.choice} vote is recorded.` : `Proposal #${proposal.id} executed.` }
                : { phase: "submitted", hash: res.hash, message: "Transaction submitted. The network has not yet confirmed the updated proposal state. Refresh to check; do not submit again." })
        } catch (err) {
            // A wallet-network refusal is thrown before the wallet is asked to sign.
            if (err instanceof WalletNetworkError) walletStarted = false
            if (!walletStarted && !knownHash) {
                finish()
                try { clearGovernanceReceipt(scope) } catch { /* Retain conservative recovery state. */ }
            } else if (isCurrent()) setReceipts(current => ({ ...current, [next.kind]: readGovernanceReceipt(scope) }))
            if (!isCurrent()) return
            logChainError(`proposal:${next.kind}:${realmPath}#${proposal.id}`, err, "critical", address)
            setTx({ phase: walletStarted ? "unknown" : "failed", message: walletStarted ? "Submission outcome unknown. Check the transaction before trying again." : friendlyDaoError(err), hash: knownHash })
        } finally { finish() }
    }

    const daoName = config?.name
    const sourceUrl = `${getExplorerBaseUrl()}/r/${realmPath.replace("gno.land/r/", "")}$source`

    return (
        <div className="animate-fade-in proposal-container v2p">
            <nav className="proposal-breadcrumb" aria-label="Breadcrumb">
                <button className="proposal-breadcrumb-btn" onClick={() => navigate("/dao")}>DAOs</button>
                <span className="proposal-breadcrumb-sep" aria-hidden="true">›</span>
                <button className="proposal-breadcrumb-btn proposal-breadcrumb-btn--active" onClick={() => navigate(`/dao/${encodedSlug}`)} aria-label={`Back to ${daoName ?? realmPath}`}>
                    <span className="v2p-path">{realmPath}</span>
                    {daoName && <span> · {revealInvisibleFormatting(daoName)}</span>}
                </button>
                {daoName && <DAOIdentityLabel realmPath={realmPath} name={daoName} />}
                <span className="proposal-breadcrumb-sep" aria-hidden="true">›</span>
                <span className="proposal-breadcrumb-current">Proposal #{proposal.id}</span>
            </nav>

            <header>
                <div className="proposal-meta-row">
                    <span className="proposal-id-label">Proposal #{proposal.id}</span>
                    <span className="proposal-status-badge v2p-status" data-status={proposal.status}>{V2_STATUS_LABELS[proposal.status]}</span>
                    <span className="proposal-category-badge">{proposal.category}</span>
                    <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="proposal-source-link">View source</a>
                </div>
                <h2 className="proposal-title v2p-text">{revealInvisibleFormatting(proposal.title)}</h2>
                <p className="v2p-muted">{V2_STATUS_EXPLANATIONS[proposal.status]}</p>
            </header>

            {invisible && (
                <p className="dao-shell-banner" role="alert">
                    This proposal contains invisible formatting characters, shown here as [U+XXXX]. They can make text read differently from what it says.
                </p>
            )}

            <div className="gov-reading-layout">
                <div className="gov-reading-body">
                    <section className="k-card v2p-card" aria-labelledby="v2p-action">
                        <h3 id="v2p-action" className="v2p-heading">What it does</h3>
                        <ActionDetails proposal={proposal} />
                    </section>

                    <section className="k-card v2p-card" aria-labelledby="v2p-timeline">
                        <h3 id="v2p-timeline" className="v2p-heading">Timeline</h3>
                        <dl className="v2p-facts">
                            <dt>Proposed by</dt>
                            <dd><CopyableAddress address={proposal.author} /></dd>
                            <dt>Created</dt>
                            <dd>{formatChainTime(proposal.created_at)}</dd>
                            <dt>{now < proposal.voting_ends_at && proposal.status === "ACTIVE" ? "Voting ends" : "Voting period ended"}</dt>
                            <dd>{formatChainTime(proposal.voting_ends_at)} ({relativeTime(proposal.voting_ends_at, now)})</dd>
                            {proposal.accepted_at > 0 && (
                                <>
                                    <dt>Accepted</dt>
                                    <dd>{formatChainTime(proposal.accepted_at)}</dd>
                                    <dt>Executable from</dt>
                                    <dd>{formatChainTime(proposal.executable_at)} ({relativeTime(proposal.executable_at, now)})</dd>
                                    <dt>Must be executed before</dt>
                                    <dd>{formatChainTime(proposal.execute_by)} ({relativeTime(proposal.execute_by, now)})</dd>
                                </>
                            )}
                        </dl>
                    </section>

                    {description !== "" && (
                        <section className="k-card proposal-desc-card" aria-labelledby="v2p-description">
                            <h3 id="v2p-description" className="v2p-heading">Description</h3>
                            <div
                                className="proposal-desc-text v2p-text"
                                dir="auto"
                                dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(renderMarkdown(revealInvisibleFormatting(description))) }}
                            />
                        </section>
                    )}
                </div>

                <div className="gov-reading-votes">
                    <section className="k-card v2p-card" aria-labelledby="v2p-votes">
                        <h3 id="v2p-votes" className="v2p-heading">Voting power</h3>
                        <div
                            className="v2p-bar"
                            role="img"
                            aria-label={`Yes ${yesPct}%, No ${noPct}%, Abstain ${abstainPct}% of all voting power${threshold !== undefined ? `; threshold ${threshold}%` : ""}${quorum > 0 ? `; quorum ${quorum}%` : ""}`}
                        >
                            <span className="v2p-bar__yes" style={{ width: `${yesPct}%` }} />
                            <span className="v2p-bar__no" style={{ width: `${noPct}%` }} />
                            <span className="v2p-bar__abstain" style={{ width: `${abstainPct}%` }} />
                            {threshold !== undefined && <span className="v2p-bar__marker" style={{ left: `${threshold}%` }} title={`Threshold ${threshold}%`} />}
                            {quorum > 0 && <span className="v2p-bar__marker v2p-bar__marker--quorum" style={{ left: `${quorum}%` }} title={`Quorum ${quorum}%`} />}
                        </div>
                        <dl className="v2p-facts">
                            <dt>Yes</dt><dd>{proposal.yes.toLocaleString("en-US")} ({yesPct}%)</dd>
                            <dt>No</dt><dd>{proposal.no.toLocaleString("en-US")} ({noPct}%)</dd>
                            <dt>Abstain</dt><dd>{proposal.abstain.toLocaleString("en-US")} ({abstainPct}%)</dd>
                            <dt>All voting power</dt><dd>{ep.toLocaleString("en-US")}</dd>
                            {threshold !== undefined && (<><dt>Threshold</dt><dd>Yes must reach {threshold}% of all voting power</dd></>)}
                            <dt>Quorum</dt><dd>{quorum > 0 ? `${powerPercent(cast, ep)}% voted, ${quorum}% needed` : "None"}</dd>
                        </dl>
                        <p className="v2p-muted">{VOTES_ARE_FINAL}</p>
                        {votesQuery.data && votesQuery.data.total > 0 && (
                            <details>
                                <summary>{votesQuery.data.total} {votesQuery.data.total === 1 ? "vote" : "votes"}</summary>
                                <ul className="v2p-votes">
                                    {votesQuery.data.votes.map((v) => (
                                        <li key={v.voter}><span className="v2p-address">{v.voter}</span> {v.choice} ({v.power.toLocaleString("en-US")})</li>
                                    ))}
                                </ul>
                                {votesQuery.data.total > votesQuery.data.votes.length && <p className="v2p-muted">Showing the first {votesQuery.data.votes.length}.</p>}
                            </details>
                        )}
                    </section>

                    <section className="v2p-actions" aria-label="Actions">
                        {archived && <p className="dao-shell-banner" role="status">This DAO is archived. Voting and execution are closed.</p>}
                        {!auth.isAuthenticated && !archived && <p className="k-dashed proposal-connect-cta">Connect your wallet to vote or execute.</p>}
                        {auth.isAuthenticated && !archived && members !== null && !member && (canVoteNow(proposal, now) || proposal.status === "ACCEPTED") && (
                            <p className="dao-shell-banner" role="status">Your connected wallet is not a member of this DAO. Only members can vote and execute.</p>
                        )}

                        {auth.isAuthenticated && !archived && member && canVoteNow(proposal, now) && (
                            voted ? (
                                <p className="dao-shell-banner" role="status">You voted{myVote ? ` ${myVote}` : ""} on this proposal. Votes are final.</p>
                            ) : (
                                <div className="v2p-vote-buttons">
                                    {(["YES", "NO", "ABSTAIN"] as const).map((choice) => (
                                        <button key={choice} className={choice === "YES" ? "k-btn-primary" : "k-btn-secondary"} disabled={busy || hasVotedQuery.isPending || !!receipts.vote} onClick={() => openConfirmation({ kind: "vote", choice })}>
                                            {choice === "YES" ? "Vote yes" : choice === "NO" ? "Vote no" : "Abstain"}
                                        </button>
                                    ))}
                                </div>
                            )
                        )}

                        {auth.isAuthenticated && !archived && member && proposal.status === "ACCEPTED" && (
                            <div>
                                <button className="k-btn-primary" disabled={busy || execState !== "open" || !!receipts.execute} onClick={() => openConfirmation({ kind: "execute" })} aria-describedby="v2p-execute-hint">
                                    Execute proposal
                                </button>
                                <p id="v2p-execute-hint" className="v2p-muted">
                                    {execState === "too-early" ? `Executable from ${formatChainTime(proposal.executable_at)} (${relativeTime(proposal.executable_at, now)}).`
                                        : execState === "closed" ? "The execution window has closed."
                                            : `Any member can execute it until ${formatChainTime(proposal.execute_by)}.`}
                                </p>
                            </div>
                        )}

                        {recoveryMessage && <p role="status">{recoveryMessage}</p>}
                        {(["vote", "execute"] as const).map(kind => receipts[kind] && <div className="dao-shell-banner" role="status" key={kind}>
                            <p>A previous {kind} attempt is saved. Check its outcome before another submission.</p>
                            {receipts[kind]?.hash && <code>Transaction {receipts[kind]!.hash}</code>}
                            <label><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /> I checked the transaction and want to review this action again.</label>
                            <button className="k-btn-secondary" disabled={busy || !acknowledged} onClick={() => {
                                try { clearGovernanceReceipt(scopes[kind]); setReceipts(current => ({ ...current, [kind]: null })); setAcknowledged(false); setTx({ phase: "idle" }); void proposalQuery.refetch(); void hasVotedQuery.refetch() }
                                catch (error) { setRecoveryMessage(error instanceof Error ? error.message : "Could not clear the saved attempt.") }
                            }}>Review {kind} again</button>
                        </div>)}
                        <TxStatus state={tx} />
                    </section>
                </div>
            </div>

            {pending && (
                <div className="v2p-overlay" onClick={() => setPending(null)} onKeyDown={(e) => { if (e.key === "Escape") setPending(null) }}>
                    <div className="v2p-dialog" role="alertdialog" aria-modal="true" aria-labelledby="v2p-confirm-title" onClick={(e) => e.stopPropagation()}>
                        <h3 id="v2p-confirm-title" className="v2p-dialog__title">
                            {pending.kind === "vote" ? `Vote ${pending.choice} on proposal #${proposal.id}?` : `Execute proposal #${proposal.id}?`}
                        </h3>
                        {pending.kind === "vote" ? (
                            <p className="v2p-dialog__message">
                                Your vote counts {member ? member.votingPower.toLocaleString("en-US") : "your"} voting power and cannot be changed. {VOTES_ARE_FINAL}
                            </p>
                        ) : (
                            <>
                                <p className="v2p-dialog__message">This applies the following change now:</p>
                                <ActionDetails proposal={proposal} />
                                {(proposal.action.kind === "add_member" || proposal.action.kind === "remove_member") && (
                                    <p className="v2p-dialog__message">Changing membership closes every proposal still open for voting: they become invalidated.</p>
                                )}
                                {proposal.action.kind === "remove_member" && (
                                    <p className="v2p-dialog__message">The storage deposit freed by removing this member is refunded to you, as the account that executes the removal.</p>
                                )}
                            </>
                        )}
                        {pendingPlan && (
                            <p className="v2p-muted">Contract {realmPath}. Gas limit {pendingPlan.gasWanted!.toLocaleString("en-US")}; requested storage-deposit cap {formatUgnot(pendingPlan.maxDepositUgnot!)}.</p>
                        )}
                        {pendingPlan && pending.needsDepositOverride && (
                            <DepositOverride
                                maxDepositUgnot={pendingPlan.maxDepositUgnot!}
                                approved={pending.depositApproved}
                                onApprovedChange={(approved) => setPending(current => current && current.plan === pendingPlan ? { ...current, depositApproved: approved } : current)}
                            />
                        )}
                        <div className="v2p-dialog__actions">
                            <button className="k-btn-secondary" onClick={() => setPending(null)}>Cancel</button>
                            <button ref={confirmRef} className="k-btn-primary" disabled={pending.needsDepositOverride && !pending.depositApproved} onClick={() => { void run(pending) }}>
                                {pending.kind === "vote" ? `Confirm ${pending.choice}` : "Confirm execution"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

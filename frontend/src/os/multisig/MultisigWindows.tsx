/**
 * The Multisig app and a multisig window (mockup v4 multisig, msigBody): your
 * multisigs and invitations, then one account with its members, balance and
 * transactions with signature dots. Creating, importing, proposing, signing
 * and broadcasting open Memba's reviewed pages inside the window: the native
 * wizards follow the multisig signing-path review (D20). Guests and non-members see
 * the app and an account's public face (address, balance, and what the chain says
 * it is); what needs their wallet asks for it where it appears.
 *
 * @module os/multisig/MultisigWindows
 */
import { useState, type ReactNode } from "react"
import { Code, ConnectError } from "@connectrpc/connect"
import { GNO_CHAIN_ID } from "../../lib/config"
import { parseMsgs } from "../../lib/parseMsgs"
import { useBalance } from "../../hooks/useBalance"
import { useJoinMultisig } from "../../hooks/useJoinMultisig"
import { ADDRESS_ACTIVITY_LIMIT, useAddressActivity } from "../../hooks/useAddressActivity"
import { ADDRESS_WINDOW_BLOCKS, formatActivityTime } from "../../lib/activity"
import { normalizeTxHashHex, txExplorerUrl } from "../../lib/txExplorerUrl"
import { StatusBadge } from "../../components/ui/StatusBadge"
import { getMultisigStatus } from "../../components/ui/txStatus"
import { ENABLE_NATIVE_GNO_MULTISIG } from "../../lib/config"
import { isNativeMultisig } from "../../lib/nativeMultisig"
import { revealInvisibleFormatting } from "../../lib/dao/v2Text"
import type { Multisig, Transaction } from "../../gen/memba/v1/memba_pb"
import { shortAddr } from "../shell/format"
import type { OsSession } from "../shell/useOsSession"
import { specForTarget, type WindowSpec } from "../shell/windows"
import { formatUgnot } from "../wallet/send"
import { awaitingText, useAwaitingSignature, useChainAccountKind, useMultisigDetail, useMyMultisigs } from "./useOsMultisig"

/** Where a guest's own data would be: why it is not shown, and the way to show it. */
function ConnectHere({ session, text }: { session: OsSession; text: string }) {
    if (session.status === "resuming") return <Loading what="your wallet" />
    return (
        <p className="os-sub" role="status">
            {text} <button type="button" className="os-btn os-quiet os-inline" onClick={session.openConnect}>Connect</button>
        </p>
    )
}

function Loading({ what }: { what: string }) {
    return <div className="os-row" role="status"><span className="os-spin" aria-hidden="true" /><span className="os-sub">Loading {what}…</span></div>
}

/** What a multisig is, for a guest and for a member with none yet. */
const ABOUT = "A multisig is a shared account: a transaction leaves it only when enough of its members sign, for example 2 of 3. Memba keeps the members' public keys and their signatures until the transaction is sent."

/** Never "Unnamed": an account shared with you says so; its address is always shown beside it. */
function multisigTitle(m: Multisig): string {
    return m.name ? revealInvisibleFormatting(m.name) : m.joined ? "Multisig" : "Multisig shared with you"
}

const page = (section: string): WindowSpec => specForTarget({ kind: "app", app: "multisig", section })!
const accountSpec = (address: string): WindowSpec => specForTarget({ kind: "multisig", address })!

export function MultisigApp({ session, open }: { session: OsSession; open: (spec: WindowSpec) => void }) {
    const list = useMyMultisigs(session.layout.auth)
    const awaiting = useAwaitingSignature(session.layout.auth, session.address)
    const { join, joining, error } = useJoinMultisig(session.layout.auth.token)

    const all = list.data ?? []
    const joined = all.filter((m) => m.joined)
    const invited = all.filter((m) => !m.joined)
    const row = (m: Multisig, action?: ReactNode) => (
        <li key={m.address} className="os-row os-nowrap">
            <button type="button" className="os-it os-click os-grow" onClick={() => open(accountSpec(m.address))}>
                <span className="os-av os-av-lg" aria-hidden="true">{m.threshold}/{m.membersCount}</span>
                <span className="os-grow"><b>{multisigTitle(m)}</b><span className="os-sub os-block os-mono">{shortAddr(m.address)} · Requires {m.threshold} of {m.membersCount} members</span>{(awaiting.data?.get(m.address) ?? 0) > 0 && <span className="os-sub os-block os-strong">{awaitingText(awaiting.data!.get(m.address)!)}</span>}</span>
            </button>
            {action}
        </li>
    )
    return (
        <div className="os-stack">
            <div className="os-row">
                <button type="button" className="os-btn" disabled={!ENABLE_NATIVE_GNO_MULTISIG} onClick={() => open(page("create"))}>New multisig</button>
                <button type="button" className="os-btn os-quiet" onClick={() => open(page("import"))}>Import</button>
            </div>
            {!ENABLE_NATIVE_GNO_MULTISIG && <p className="os-sub" role="status">Native multisig registration is on hold pending release approval. Existing accounts can still be imported for read-only history.</p>}
            {session.status !== "member" ? <><p className="os-sub">{ABOUT}</p><ConnectHere session={session} text="Connect a wallet to see the multisigs you sign for." /></> : list.isPending ? <Loading what="your multisigs" /> : list.isError ? (
                <p className="os-note os-err" role="alert">Couldn't load your multisigs. <button type="button" className="os-btn os-quiet os-inline" onClick={() => void list.refetch()}>Try again</button></p>
            ) : (
                <>
                    <section>
                        <h3 className="os-h">Your multisigs</h3>
                        {joined.length ? <ul className="os-list">{joined.map((m) => row(m))}</ul> : <><p className="os-sub">{ABOUT}</p><p className="os-sub">None yet. Create one, or import one by address.</p></>}
                    </section>
                    {all.length === 50 && <p className="os-sub" role="status">Showing the newest 50 accounts. Older accounts may not appear here.</p>}
                    {invited.length > 0 && (
                        <section>
                            <h3 className="os-h">Shared with you</h3>
                            <p className="os-sub">Your key is a member of these accounts: open them to see and sign their transactions. Join to keep one in your accounts.</p>
                            <ul className="os-list">{invited.map((m) => row(m, (
                                <button type="button" className="os-btn os-quiet" title="Join to keep it in your accounts" aria-label={`Join ${shortAddr(m.address)} to keep it in your accounts`} disabled={joining !== null || !m.pubkeyJson} onClick={() => { void join(m) }}>{joining === m.address ? "Joining…" : "Join"}</button>
                            )))}</ul>
                        </section>
                    )}
                </>
            )}
            {error && <p className="os-note os-err" role="alert">{error}</p>}
        </div>
    )
}

function txTitle(tx: Transaction): { title: string; detail: string } {
    const [first, ...rest] = parseMsgs(tx.msgsJson)
    const detail = first?.fields.map((f) => `${f.key} ${f.value}`).join(" · ") ?? ""
    return { title: `${first?.label ?? "Transaction"}${rest.length ? ` + ${rest.length} more` : ""}`, detail: tx.memo ? `${detail} · “${tx.memo}”` : detail }
}

/**
 * Transfers to and from the account, from the gno.land indexer: public chain data,
 * so guests see them too. Only recent blocks are read (the indexer has no paging).
 * A send whose hash a recorded proposal carries names that proposal.
 */
function Transfers({ address, executed = [], open }: { address: string; executed?: readonly Transaction[]; open: (spec: WindowSpec) => void }) {
    const activity = useAddressActivity(address, { transfersOnly: true })
    if (!activity.available) return null
    const proposalOf = new Map(executed.flatMap((tx) => {
        const hex = normalizeTxHashHex(tx.finalHash)
        return hex ? [[hex, tx.id] as const] : []
    }))
    const transfers = activity.items.filter((item) => item.kind === "transfer")
    const capped = activity.items.length >= ADDRESS_ACTIVITY_LIMIT
    return (
        <section aria-label="Received and sent">
            <h3 className="os-h">Received and sent</h3>
            <p className="os-sub">Transfers in the last {ADDRESS_WINDOW_BLOCKS.toLocaleString("en-US")} blocks, from the gno.land indexer.</p>
            {activity.loading ? <Loading what="transfers" />
                : activity.error ? <p className="os-note os-err" role="alert">Couldn't read this account's transfers: the indexer did not answer, or this account moved more than it returns at once. <button type="button" className="os-btn os-quiet os-inline" onClick={() => activity.refetch()}>Try again</button></p>
                : transfers.length === 0 ? <p className="os-sub">No transfers in recent blocks.</p>
                : <>{capped && <p className="os-sub" role="status">Showing the {ADDRESS_ACTIVITY_LIMIT} newest transfers: older ones in that range may not appear.</p>}<ul className="os-list">{transfers.map((item) => {
                    const received = item.direction === "received"
                    const hex = normalizeTxHashHex(item.txHash)
                    const proposal = hex ? proposalOf.get(hex) : undefined
                    const link = txExplorerUrl(item.txHash, GNO_CHAIN_ID)
                    const when = formatActivityTime(item.time)
                    return (
                        <li key={`${item.txHash}:${item.msgIndex}`} className="os-it os-top">
                            <div className="os-grow">
                                <b>{item.title}</b>
                                <div className="os-sub os-mono os-break">{received ? `from ${item.actor}` : `to ${item.to ?? ""}`}</div>
                                <div className="os-sub">Block {item.blockHeight.toLocaleString("en-US")}{when ? ` · ${when}` : ""}{link ? <> · <a href={link} target="_blank" rel="noreferrer">Transaction</a></> : null}</div>
                            </div>
                            {proposal !== undefined && <button type="button" className="os-btn os-quiet" aria-label={`View proposal #${proposal}`} onClick={() => open(specForTarget({ kind: "app", app: "wallet", section: `tx/${proposal}` })!)}>Proposal #{proposal}</button>}
                        </li>
                    )
                })}</ul></>}
        </section>
    )
}

export function MultisigWindow({ address, session, open }: { address: string; session: OsSession; open: (spec: WindowSpec) => void }) {
    const detail = useMultisigDetail(session.layout.auth, address)
    const adding = useJoinMultisig(session.layout.auth.token)
    const balance = useBalance(address)
    const [copied, setCopied] = useState(false)
    const copy = async () => {
        try { await navigator.clipboard.writeText(address); setCopied(true) } catch { /* the address stays visible */ }
    }
    const funds = (
        <div className="os-right"><div className="os-big">{balance.error ? "Balance unavailable" : balance.rawUgnot === undefined ? balance.balance : formatUgnot(balance.rawUgnot)}</div>{balance.error && <button type="button" className="os-btn os-quiet" onClick={() => void balance.refetch()}>Retry balance</button>}</div>
    )
    const copyButton = <button type="button" className="os-btn os-quiet" onClick={() => { void copy() }}>{copied ? "Address copied" : `Copy ${GNO_CHAIN_ID} deposit address`}</button>
    // Memba answers for its members only. Anyone else sees the public face, named by the chain alone:
    // a link can carry any address, and only the chain says it is a multisig.
    const notMember = detail.isError && ConnectError.from(detail.error).code === Code.PermissionDenied
    const unregistered = detail.isSuccess && !detail.data.multisig
    const outside = session.status !== "member" || notMember || unregistered
    const kind = useChainAccountKind(address, outside)
    if (outside) return (
        <div className="os-stack os-msig">
            <div className="os-row os-nowrap os-msig-head">
                <div className="os-grow"><b>{kind.data === "multisig" ? "Multisig account" : "Account"}</b><div className="os-sub os-mono os-break">{address}</div></div>
                {funds}
            </div>
            {kind.isPending ? <Loading what="what the chain says about this address" />
                : kind.isError ? <p className="os-sub" role="status">Couldn't check this address on chain. <button type="button" className="os-btn os-quiet os-inline" onClick={() => void kind.refetch()}>Try again</button></p>
                : kind.data === "multisig" ? <div className="os-row">{copyButton}</div>
                : <p className="os-sub" role="status">{kind.data === "unused" ? "Not yet confirmed as a multisig on chain: nothing has been signed from this address." : "This address is a single-key account, not a multisig."}</p>}
            {kind.data === "single" ? null
                : session.status !== "member" ? <ConnectHere session={session} text="A multisig's members see its members, threshold and transactions here. Connect a wallet to see them." />
                : notMember ? <p className="os-sub" role="status">You are not a member of this multisig.</p>
                : <p className="os-sub" role="status">This multisig is not registered in Memba for your account. <button type="button" className="os-btn os-quiet os-inline" onClick={() => open(page("import"))}>Import it</button></p>}
            {(kind.data === "multisig" || kind.data === "unused") && <Transfers address={address} open={open} />}
        </div>
    )
    if (detail.isPending) return <Loading what="this multisig" />
    if (detail.isError) return <p className="os-note os-err" role="alert">Couldn't load this multisig. <button type="button" className="os-btn os-quiet os-inline" onClick={() => void detail.refetch()}>Try again</button></p>
    if (!detail.data.multisig) return null
    const m = detail.data.multisig
    const nativeEnabled = ENABLE_NATIVE_GNO_MULTISIG && isNativeMultisig(m.pubkeyJson)
    const me = session.address
    const txs = [...detail.data.pending, ...detail.data.executed].sort((a, b) => b.id - a.id)
    return (
        <div className="os-stack os-msig">
            <div className="os-row os-nowrap os-msig-head">
                <span className="os-av os-av-lg" aria-hidden="true">{m.threshold}/{m.membersCount}</span>
                <div className="os-grow">
                    <b>{multisigTitle(m)}</b>
                    <div className="os-sub">Requires {m.threshold} of {m.membersCount} members · <span className="os-mono">{shortAddr(address)}</span></div>
                </div>
                {funds}
            </div>
            {!m.joined && <div className="os-row os-note" role="status">
                <span className="os-grow">Shared with you: your key is a member, so you can see and sign its transactions.</span>
                <button type="button" className="os-btn os-quiet" disabled={adding.joining !== null || !m.pubkeyJson} onClick={() => { void adding.join(m) }}>{adding.joining ? "Joining…" : "Join to keep it in your accounts"}</button>
            </div>}
            {adding.error && <p className="os-note os-err" role="alert">{adding.error}</p>}
            <div className="os-chipset" aria-label="Members">{m.usersAddresses.map((a) => <span key={a} className="os-pill os-mono" title={a}>{a === me ? "You" : shortAddr(a)}</span>)}</div>
            <div className="os-row">
                <button type="button" className="os-btn" disabled={!nativeEnabled} onClick={() => open(page(`${address}/propose`))}>Propose transaction</button>
                {copyButton}
            </div>
            {!nativeEnabled && <p className="os-sub" role="status">{isNativeMultisig(m.pubkeyJson) ? "Native signing and broadcasting are on hold pending release approval." : "Legacy multisig records are read-only history. They cannot be executed on Gno from Memba."}</p>}
            <section>
                <div className="os-row os-between"><h3 className="os-h">Transactions</h3><button type="button" className="os-btn os-quiet" onClick={() => void detail.refetch()}>Refresh</button></div>
                {(detail.data.pendingError || detail.data.executedError) && <p className="os-note os-err" role="alert">{detail.data.pendingError && detail.data.executedError ? "Pending and completed transactions couldn't be loaded." : detail.data.pendingError ? "Pending transactions couldn't be loaded." : "Completed transactions couldn't be loaded."} Try Refresh.</p>}
                {(detail.data.pending.length === 50 || detail.data.executed.length === 50) && <p className="os-sub" role="status">Showing up to 50 pending and 50 completed transactions. Older records may not appear here.</p>}
                {txs.length === 0 ? (detail.data.pendingError || detail.data.executedError ? null : <p className="os-sub">No proposals yet. When available, propose a transaction for members to review. Fund this wallet before any transfer is broadcast.</p>) : (
                    <ul className="os-list">{txs.map((tx) => {
                        const { title, detail: what } = txTitle(tx)
                        const signed = new Set(tx.signatures.map((s) => s.userAddress))
                        const verified = new Set(tx.signatures.filter((s) => s.verified).map((s) => s.userAddress))
                        return (
                            <li key={tx.id} className="os-it os-top">
                                <div className="os-grow">
                                    <b>#{tx.id} {title}</b>
                                    <div className="os-sub os-break">{what}</div>
                                    <div className="os-row os-tight">
                                        <span className="os-sigdots" aria-label={`${signed.size} submitted, ${verified.size} verified, threshold ${tx.threshold}`}>
                                            {m.usersAddresses.map((a) => <span key={a} className={verified.has(a) ? "os-on" : undefined} title={`${a}${signed.has(a) ? verified.has(a) ? ": verified" : ": submitted, unverified" : ": not signed"}`}>{a.slice(2, 3).toUpperCase()}</span>)}
                                        </span>
                                        <span className="os-sub">{signed.size} submitted · {verified.size} verified · threshold {tx.threshold}</span>
                                    </div>
                                </div>
                                <div className="os-stack os-tight os-right">
                                    <StatusBadge status={getMultisigStatus(tx)} sigCount={signed.size} threshold={tx.threshold} />
                                    <button type="button" className="os-btn os-quiet" aria-label={`View transaction #${tx.id}: ${title}`} onClick={() => open(specForTarget({ kind: "app", app: "wallet", section: `tx/${tx.id}` })!)}>View details</button>
                                </div>
                            </li>
                        )
                    })}</ul>
                )}
            </section>
            <Transfers address={address} executed={detail.data.executed} open={open} />
        </div>
    )
}
